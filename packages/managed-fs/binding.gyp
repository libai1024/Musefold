{
  "targets": [{
    "target_name": "managed_fs",
    "sources": ["native/binding.cc"],
    "defines": ["NAPI_VERSION=8"],
    "cflags_cc": ["-std=c++17", "-Wall", "-Wextra"],
    "xcode_settings": {
      "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
      "GCC_GENERATE_DEBUGGING_SYMBOLS": "NO"
    },
    "conditions": [["OS=='win'", {
      "defines": ["WIN32_LEAN_AND_MEAN", "NOMINMAX", "_WIN32_WINNT=0x0A00"],
      "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] } }
    }]]
  }]
}
