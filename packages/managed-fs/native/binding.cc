#include <node_api.h>
#include <string>
#include <cstdint>
#include <cerrno>
#include <cstring>
#ifdef _WIN32
#include <windows.h>
#include <winternl.h>
#include <io.h>
#include <fcntl.h>
#else
#include <unistd.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <dirent.h>
#endif

// Internal directory-handle seam. No renderer-facing entry point.
static const napi_type_tag directory_tag = {0x86f3c3de13ae4e05ULL, 0xb92e2b5aa356e390ULL};
#ifdef _WIN32
using NativeHandle = HANDLE;
static const NativeHandle invalid_handle = INVALID_HANDLE_VALUE;
#else
using NativeHandle = int;
static const NativeHandle invalid_handle = -1;
#endif
struct Directory { NativeHandle value; bool closed = false; };

static napi_value undefined(napi_env env) { napi_value result; napi_get_undefined(env, &result); return result; }
static void fail(napi_env env, const char* code) { napi_throw_error(env, code, "Managed filesystem operation failed"); }
static void os_fail(napi_env env) {
#ifdef _WIN32
  DWORD code = GetLastError();
  fail(env, code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND ? "ENOENT" :
    code == ERROR_DIR_NOT_EMPTY ? "ENOTEMPTY" : code == ERROR_ALREADY_EXISTS || code == ERROR_FILE_EXISTS ? "EEXIST" :
    code == ERROR_ACCESS_DENIED || code == ERROR_SHARING_VIOLATION ? "EACCES" : "EIO");
#else
  fail(env, errno == ENOENT ? "ENOENT" : errno == ENOTEMPTY ? "ENOTEMPTY" : errno == EEXIST ? "EEXIST" :
    errno == EACCES || errno == EPERM ? "EACCES" : errno == ELOOP || errno == ENOTDIR ? "UNSAFE_PATH" : "EIO");
#endif
}
static void close_native(NativeHandle value) {
#ifdef _WIN32
  CloseHandle(value);
#else
  close(value);
#endif
}
static void finalize(napi_env, void* data, void*) {
  auto dir = static_cast<Directory*>(data);
  if (!dir->closed) close_native(dir->value);
  delete dir;
}
static napi_value wrap(napi_env env, NativeHandle value) {
  auto dir = new Directory{value};
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok || napi_type_tag_object(env, result, &directory_tag) != napi_ok ||
      napi_wrap(env, result, dir, finalize, nullptr, nullptr) != napi_ok) {
    close_native(value); delete dir; fail(env, "HANDLE_FAILED"); return nullptr;
  }
  return result;
}
static Directory* unwrap(napi_env env, napi_value value, bool allow_closed = false) {
  bool tagged = false;
  void* data = nullptr;
  if (napi_check_object_type_tag(env, value, &directory_tag, &tagged) != napi_ok || !tagged ||
      napi_unwrap(env, value, &data) != napi_ok || !data) { fail(env, "INVALID_HANDLE"); return nullptr; }
  auto dir = static_cast<Directory*>(data);
  if (dir->closed && !allow_closed) { fail(env, "CLOSED_HANDLE"); return nullptr; }
  return dir;
}
static bool arguments(napi_env env, napi_callback_info info, size_t expected, napi_value* argv) {
  size_t count = expected + 1;
  napi_value values[5];
  if (napi_get_cb_info(env, info, &count, values, nullptr, nullptr) != napi_ok || count != expected) {
    fail(env, "INVALID_INPUT"); return false;
  }
  for (size_t index = 0; index < count; index++) argv[index] = values[index];
  return true;
}
static bool text(napi_env env, napi_value value, std::string& out, bool basename) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || length == 0 || length > 32768) {
    fail(env, "INVALID_INPUT"); return false;
  }
  out.resize(length + 1);
  if (napi_get_value_string_utf8(env, value, out.data(), out.size(), &length) != napi_ok) {
    fail(env, "INVALID_INPUT"); return false;
  }
  out.resize(length);
  if (out.find('\0') != std::string::npos || (basename &&
      (length > 255 || out == "." || out == ".." || out.find_first_of("/\\:") != std::string::npos || out.back() == '.' || out.back() == ' '))) {
    fail(env, "INVALID_INPUT"); return false;
  }
  return true;
}
#ifdef _WIN32
static std::wstring wide(const std::string& input) {
  int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(), static_cast<int>(input.size()), nullptr, 0);
  if (size <= 0) return {};
  std::wstring output(size, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.data(), static_cast<int>(input.size()), output.data(), size);
  return output;
}
using NtCreate = NTSTATUS (NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using NtError = ULONG (WINAPI*)(NTSTATUS);
static NativeHandle relative_open(NativeHandle parent, const std::string& name, ACCESS_MASK access, ULONG disposition, bool directory) {
  std::wstring filename = wide(name);
  if (filename.empty()) { SetLastError(ERROR_INVALID_NAME); return invalid_handle; }
  UNICODE_STRING path{static_cast<USHORT>(filename.size() * sizeof(wchar_t)), static_cast<USHORT>(filename.size() * sizeof(wchar_t)), filename.data()};
  OBJECT_ATTRIBUTES attributes{};
  attributes.Length = sizeof(attributes); attributes.RootDirectory = parent; attributes.ObjectName = &path; attributes.Attributes = OBJ_CASE_INSENSITIVE;
  IO_STATUS_BLOCK io{};
  HANDLE handle;
  HMODULE library = GetModuleHandleW(L"ntdll.dll");
  auto create = reinterpret_cast<NtCreate>(GetProcAddress(library, "NtCreateFile"));
  auto convert = reinterpret_cast<NtError>(GetProcAddress(library, "RtlNtStatusToDosError"));
  if (!create || !convert) { SetLastError(ERROR_NOT_SUPPORTED); return invalid_handle; }
  // OPEN_REPARSE_POINT prevents a leaf link/junction from redirecting this handle.
  ULONG options = 0x00200000 /* FILE_OPEN_REPARSE_POINT */ | 0x20 /* FILE_SYNCHRONOUS_IO_NONALERT */ |
    (directory ? 1 /* FILE_DIRECTORY_FILE */ : 0);
  NTSTATUS status = create(&handle, access | SYNCHRONIZE, &attributes, &io, nullptr, FILE_ATTRIBUTE_NORMAL,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, disposition, options, nullptr, 0);
  if (status < 0) { SetLastError(convert(status)); return invalid_handle; }
  return handle;
}
static bool regular_directory(NativeHandle handle) {
  FILE_ATTRIBUTE_TAG_INFO info{};
  return GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &info, sizeof(info)) &&
    (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) && !(info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT);
}
#else
static bool regular_directory(NativeHandle handle) { struct stat info{}; return fstat(handle, &info) == 0 && S_ISDIR(info.st_mode); }
#endif
static std::string identity_of(NativeHandle value) {
#ifdef _WIN32
  BY_HANDLE_FILE_INFORMATION info{};
  if (!GetFileInformationByHandle(value, &info)) return {};
  uint64_t inode = (static_cast<uint64_t>(info.nFileIndexHigh) << 32) | info.nFileIndexLow;
  return std::to_string(info.dwVolumeSerialNumber) + ":" + std::to_string(inode);
#else
  struct stat info{};
  if (fstat(value, &info) != 0) return {};
  return std::to_string(static_cast<uint64_t>(info.st_dev)) + ":" + std::to_string(static_cast<uint64_t>(info.st_ino));
#endif
}
static napi_value open_root(napi_env env, napi_callback_info info) {
  napi_value argv[2]; std::string path, expected;
  if (!arguments(env, info, 2, argv) || !text(env, argv[0], path, false) || !text(env, argv[1], expected, false)) return nullptr;
#ifdef _WIN32
  auto filename = wide(path);
  NativeHandle handle = CreateFileW(filename.c_str(), FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
#else
  NativeHandle handle = open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
#endif
  if (handle == invalid_handle) { os_fail(env); return nullptr; }
  if (!regular_directory(handle) || identity_of(handle) != expected) {
    close_native(handle); fail(env, "UNSAFE_PATH"); return nullptr;
  }
  return wrap(env, handle);
}
static napi_value open_child(napi_env env, napi_callback_info info) {
  napi_value argv[3]; std::string name; bool create;
  if (!arguments(env, info, 3, argv)) return nullptr;
  Directory* parent = unwrap(env, argv[0]);
  if (!parent || !text(env, argv[1], name, true)) return nullptr;
  if (napi_get_value_bool(env, argv[2], &create) != napi_ok) { fail(env, "INVALID_INPUT"); return nullptr; }
#ifdef _WIN32
  NativeHandle handle = relative_open(parent->value, name, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
    create ? 3 /* FILE_OPEN_IF */ : 1 /* FILE_OPEN */, true);
#else
  if (create && mkdirat(parent->value, name.c_str(), 0700) != 0 && errno != EEXIST) { os_fail(env); return nullptr; }
  NativeHandle handle = openat(parent->value, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
#endif
  if (handle == invalid_handle) { os_fail(env); return nullptr; }
  if (!regular_directory(handle)) { close_native(handle); fail(env, "UNSAFE_PATH"); return nullptr; }
  return wrap(env, handle);
}
static napi_value identity(napi_env env, napi_callback_info info) {
  napi_value argv[1], result;
  if (!arguments(env, info, 1, argv)) return nullptr;
  Directory* dir = unwrap(env, argv[0]); if (!dir) return nullptr;
  auto value = identity_of(dir->value);
  if (value.empty()) { os_fail(env); return nullptr; }
  napi_create_string_utf8(env, value.c_str(), value.size(), &result); return result;
}
static napi_value close_directory(napi_env env, napi_callback_info info) {
  napi_value argv[1]; if (!arguments(env, info, 1, argv)) return nullptr;
  Directory* dir = unwrap(env, argv[0], true); if (!dir) return nullptr;
  if (!dir->closed) { close_native(dir->value); dir->closed = true; }
  return undefined(env);
}
static napi_value open_file(napi_env env, napi_callback_info info) {
  napi_value argv[3], result; std::string name, mode;
  if (!arguments(env, info, 3, argv)) return nullptr;
  Directory* dir = unwrap(env, argv[0]);
  if (!dir || !text(env, argv[1], name, true) || !text(env, argv[2], mode, false)) return nullptr;
  if (mode != "read" && mode != "create") { fail(env, "INVALID_INPUT"); return nullptr; }
  bool create = mode == "create";
#ifdef _WIN32
  // Node fs(libuv)在 Windows 上把 fd 数字直接当 Win32 HANDLE(uv_file)消费;
  // CRT fd(_open_osfhandle)与之不兼容:写入落到无效小整数句柄,目标文件保持 0 字节。
  // 内核句柄仅低 32 位有效,double 可无损承载,fs stream 的 autoClose 走 CloseHandle 语义。
  // FILE_READ_ATTRIBUTES:下方 FileAttributeTagInfo 安全检查需要它,而 FILE_GENERIC_WRITE 不含。
  NativeHandle file = relative_open(dir->value, name, (create ? GENERIC_WRITE : GENERIC_READ) | FILE_READ_ATTRIBUTES, create ? 2 /* FILE_CREATE */ : 1 /* FILE_OPEN */, false);
  if (file == invalid_handle) { os_fail(env); return nullptr; }
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  if (!GetFileInformationByHandleEx(file, FileAttributeTagInfo, &attributes, sizeof(attributes)) ||
      (attributes.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) {
    CloseHandle(file); fail(env, "UNSAFE_PATH"); return nullptr;
  }
  if (napi_create_double(env, static_cast<double>(reinterpret_cast<uintptr_t>(file)), &result) != napi_ok) {
    CloseHandle(file); fail(env, "EIO"); return nullptr;
  }
  return result;
#else
  int fd = openat(dir->value, name.c_str(), O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK | (create ? O_WRONLY | O_CREAT | O_EXCL : O_RDONLY), 0600);
  if (fd < 0) { os_fail(env); return nullptr; }
  struct stat attributes{};
  if (fstat(fd, &attributes) != 0 || !S_ISREG(attributes.st_mode)) { close(fd); fail(env, "UNSAFE_PATH"); return nullptr; }
  napi_create_int32(env, fd, &result); return result;
#endif
}
static napi_value file_identity(napi_env env, napi_callback_info info) {
  napi_value argv[2], result; std::string name, identity;
  if (!arguments(env, info, 2, argv)) return nullptr;
  Directory* dir = unwrap(env, argv[0]);
  if (!dir || !text(env, argv[1], name, true)) return nullptr;
#ifdef _WIN32
  NativeHandle file = relative_open(dir->value, name, FILE_READ_ATTRIBUTES, 1, false);
  if (file == invalid_handle) { os_fail(env); return nullptr; }
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  if (!GetFileInformationByHandleEx(file, FileAttributeTagInfo, &attributes, sizeof(attributes)) ||
      (attributes.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) {
    CloseHandle(file); fail(env, "UNSAFE_PATH"); return nullptr;
  }
  identity = identity_of(file);
  CloseHandle(file);
  if (identity.empty()) { fail(env, "EIO"); return nullptr; }
#else
  struct stat attributes{};
  if (fstatat(dir->value, name.c_str(), &attributes, AT_SYMLINK_NOFOLLOW) != 0) { os_fail(env); return nullptr; }
  if (!S_ISREG(attributes.st_mode)) { fail(env, "UNSAFE_PATH"); return nullptr; }
  identity = std::to_string(static_cast<uint64_t>(attributes.st_dev)) + ":" +
    std::to_string(static_cast<uint64_t>(attributes.st_ino));
#endif
  napi_create_string_utf8(env, identity.c_str(), identity.size(), &result); return result;
}
static napi_value remove_entry(napi_env env, napi_callback_info info, bool directory) {
  napi_value argv[2]; std::string name;
  if (!arguments(env, info, 2, argv)) return nullptr;
  Directory* parent = unwrap(env, argv[0]); if (!parent || !text(env, argv[1], name, true)) return nullptr;
#ifdef _WIN32
  NativeHandle file = relative_open(parent->value, name, DELETE | FILE_READ_ATTRIBUTES, 1 /* FILE_OPEN */, directory);
  if (file == invalid_handle) { os_fail(env); return nullptr; }
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  if (!GetFileInformationByHandleEx(file, FileAttributeTagInfo, &attributes, sizeof(attributes)) ||
      (directory && !regular_directory(file)) || (!directory && (attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY))) {
    CloseHandle(file); fail(env, "UNSAFE_PATH"); return nullptr;
  }
  FILE_DISPOSITION_INFO disposition{TRUE};
  BOOL success = SetFileInformationByHandle(file, FileDispositionInfo, &disposition, sizeof(disposition));
  DWORD error = GetLastError(); CloseHandle(file);
  if (!success) { SetLastError(error); os_fail(env); return nullptr; }
#else
  if (unlinkat(parent->value, name.c_str(), directory ? AT_REMOVEDIR : 0) != 0) { os_fail(env); return nullptr; }
#endif
  return undefined(env);
}
static napi_value unlink_file(napi_env env, napi_callback_info info) { return remove_entry(env, info, false); }
static napi_value remove_directory(napi_env env, napi_callback_info info) { return remove_entry(env, info, true); }

static const napi_type_tag reader_tag = {0x86f3c3de13ae4e06ULL, 0xb92e2b5aa356e391ULL};
struct Reader {
#ifdef _WIN32
  HANDLE handle;
  alignas(8) BYTE buffer[65536];
  DWORD offset = 0;
  bool need_page = true, first_page = true;
#else
  DIR* handle;
#endif
  bool closed = false, ended = false;
};
static void close_reader_handle(Reader* reader) {
  if (reader->closed) return;
#ifdef _WIN32
  CloseHandle(reader->handle);
#else
  closedir(reader->handle);
#endif
  reader->closed = true;
}
static void finalize_reader(napi_env, void* data, void*) { auto reader = static_cast<Reader*>(data); close_reader_handle(reader); delete reader; }
static Reader* unwrap_reader(napi_env env, napi_value value, bool allow_closed = false) {
  bool tagged = false; void* data = nullptr;
  if (napi_check_object_type_tag(env, value, &reader_tag, &tagged) != napi_ok || !tagged ||
      napi_unwrap(env, value, &data) != napi_ok || !data) { fail(env, "INVALID_HANDLE"); return nullptr; }
  auto reader = static_cast<Reader*>(data);
  if (reader->closed && !allow_closed) { fail(env, "CLOSED_HANDLE"); return nullptr; }
  return reader;
}
static napi_value open_reader(napi_env env, napi_callback_info info) {
  napi_value argv[1], result;
  if (!arguments(env, info, 1, argv)) return nullptr;
  Directory* dir = unwrap(env, argv[0]); if (!dir) return nullptr;
#ifdef _WIN32
  HANDLE handle = relative_open(dir->value, ".", FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES, 1, true);
  if (handle == invalid_handle) { os_fail(env); return nullptr; }
#else
  int fd = openat(dir->value, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (fd < 0) { os_fail(env); return nullptr; }
  DIR* handle = fdopendir(fd);
  if (!handle) { int error = errno; close(fd); errno = error; os_fail(env); return nullptr; }
#endif
  auto reader = new Reader{}; reader->handle = handle;
  if (napi_create_object(env, &result) != napi_ok || napi_type_tag_object(env, result, &reader_tag) != napi_ok ||
      napi_wrap(env, result, reader, finalize_reader, nullptr, nullptr) != napi_ok) {
    close_reader_handle(reader); delete reader; fail(env, "HANDLE_FAILED"); return nullptr;
  }
  return result;
}
static napi_value read_reader(napi_env env, napi_callback_info info) {
  napi_value argv[2], result; double requested;
  if (!arguments(env, info, 2, argv)) return nullptr;
  Reader* reader = unwrap_reader(env, argv[0]); if (!reader) return nullptr;
  if (napi_get_value_double(env, argv[1], &requested) != napi_ok || !(requested >= 1 && requested <= 100) ||
      requested != static_cast<int>(requested)) { fail(env, "INVALID_INPUT"); return nullptr; }
  uint32_t maximum = static_cast<uint32_t>(requested), index = 0;
  napi_create_array(env, &result);
  while (index < maximum && !reader->ended) {
    napi_value name, row, kind;
    const char* type;
#ifdef _WIN32
    if (reader->need_page) {
      BOOL ok = GetFileInformationByHandleEx(reader->handle,
        reader->first_page ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo,
        reader->buffer, sizeof(reader->buffer));
      if (!ok) {
        if (GetLastError() == ERROR_NO_MORE_FILES) { reader->ended = true; break; }
        os_fail(env); return nullptr;
      }
      reader->first_page = false; reader->need_page = false; reader->offset = 0;
    }
    const auto* entry = reinterpret_cast<const FILE_ID_BOTH_DIR_INFO*>(reader->buffer + reader->offset);
    size_t length = entry->FileNameLength / sizeof(WCHAR);
    if (entry->NextEntryOffset == 0) reader->need_page = true; else reader->offset += entry->NextEntryOffset;
    if ((length == 1 && entry->FileName[0] == L'.') ||
        (length == 2 && entry->FileName[0] == L'.' && entry->FileName[1] == L'.')) continue;
    napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(entry->FileName), length, &name);
    type = (entry->FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ? "link" :
      (entry->FileAttributes & FILE_ATTRIBUTE_DIRECTORY) ? "directory" : "file";
#else
    errno = 0;
    dirent* entry = readdir(reader->handle);
    if (!entry) { if (errno) { os_fail(env); return nullptr; } reader->ended = true; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    struct stat entry_stat{};
    if (fstatat(dirfd(reader->handle), entry->d_name, &entry_stat, AT_SYMLINK_NOFOLLOW) != 0) {
      if (errno == ENOENT) type = "missing"; else { os_fail(env); return nullptr; }
    } else type = S_ISLNK(entry_stat.st_mode) ? "link" : S_ISDIR(entry_stat.st_mode) ? "directory" : S_ISREG(entry_stat.st_mode) ? "file" : "other";
    napi_create_string_utf8(env, entry->d_name, NAPI_AUTO_LENGTH, &name);
#endif
    napi_create_object(env, &row); napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &kind);
    napi_set_named_property(env, row, "name", name); napi_set_named_property(env, row, "type", kind);
    napi_set_element(env, result, index++, row);
  }
  return result;
}
static napi_value close_reader(napi_env env, napi_callback_info info) {
  napi_value argv[1]; if (!arguments(env, info, 1, argv)) return nullptr;
  Reader* reader = unwrap_reader(env, argv[0], true); if (!reader) return nullptr;
  close_reader_handle(reader); return undefined(env);
}
static napi_value init(napi_env env, napi_value exports) {
  const napi_property_descriptor methods[] = {
    {"openReader", nullptr, open_reader, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readReader", nullptr, read_reader, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeReader", nullptr, close_reader, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openRoot", nullptr, open_root, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openChild", nullptr, open_child, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"identity", nullptr, identity, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"close", nullptr, close_directory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openFile", nullptr, open_file, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"fileIdentity", nullptr, file_identity, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"unlinkFile", nullptr, unlink_file, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"removeDirectory", nullptr, remove_directory, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
