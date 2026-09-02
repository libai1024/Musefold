// providers/sanitize-error.ts
// Provider 错误消息脱敏（core/Desktop 边界唯一出口）。
//
// 主进程收到的是 SDK / 上游的原始错误（可能带 Authorization 头、签名 URL、
// 本地绝对路径、堆栈或原始 JSON body）。这些文本有三个去向——渲染层
// GenerateImageResult.error.message、generation_runs.error_message、连接验证
// ValidationResult.message——全部不可包含敏感内容。所有 Provider /
// GenerationService 在错误跨出 core 前必须经过本模块。
//
// 设计约束：
// 1. 只改 message，不改 code/status——错误分类（AUTH/NO_BALANCE/NETWORK…）
//    一律在脱敏前的原始文本上完成。
// 2. 幂等：同一段文本多次脱敏结果不变（normalizeError 在重试内外会被调用多次）。
// 3. 有界：输出长度受 MAX_PROVIDER_ERROR_MESSAGE_LENGTH 限制（error_message
//    列为无界 TEXT，长度边界在此收口）。

/** 脱敏后错误消息的长度上限。 */
export const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500;

const REDACTED = '[已隐藏]';
const REDACTED_KEY = '[密钥已隐藏]';
const REDACTED_URL = '[链接已隐藏]';
const REDACTED_PATH = '[本地路径]';
const REDACTED_JSON = '[原始响应已隐藏]';
const TRUNCATION_SUFFIX = '…（已截断）';

/**
 * 堆栈帧：行首（可带缩进）的 `at xxx (…)` / `at xxx:1:2` 形态。
 * 要求行内出现 `(` 或 `:数字`，避免误删正文中 "at least" 之类的普通文本。
 */
const STACK_FRAME = /(?:^|\n)[ \t]*at[ \t][^\n]*(?:\(|:\d)[^\n]*/g;

/** URL（排除常见收尾标点，含 CJK 标点，避免把句末符号卷进来）。 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`）)\]}。，；！？、》」』]+/gi;
/** 敏感 query 参数名（签名 / 令牌 / 密钥类）：参数名命中即整条 URL 隐藏。 */
const SECRET_QUERY_PARAM =
  /(?:^|[?&])(?:x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential)|x-oss-signature|(?:access[_-]?key|api[_-]?key|apikey|secret(?:[_-]?key)?|signature|sign|sig|authkey|session[_-]?key|(?:access|refresh|session)[_-]?token|token|auth|credential|expires?|expiry|expires[_-]at))(?:=|&|$)/i;
/** query 值本身是长签名/密钥（≥40 位连续串），参数名未知时兜底。 */
const LONG_QUERY_VALUE = /[?&][^=&]{1,64}=[A-Za-z0-9+/_%=-]{40,}/;

/** Authorization 头 / Bearer 方案。 */
const AUTHORIZATION_HEADER = /\bauthorization[ \t]*[:=][^\n]*/gi;
const BEARER_TOKEN = /\bbearer[ \t]+[A-Za-z0-9\-._~+/=]+/gi;

/** key=value / key: value 形式的密钥字段（值 ≥6 位才视为密钥）。 */
const KEY_ASSIGNMENT =
  /\b(api[_-]?key|apikey|access[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|secret[_-]?key|secret|password|passwd|token)[ \t]*["']?[ \t]*[:=][ \t]*["']?[A-Za-z0-9\-._~+/=]{6,}/gi;

/** OpenAI 风格密钥字面量（sk- / sk-proj-…），中转站错误文案里常见。 */
const SK_KEY = /\bsk-(?:proj-|ant-|admin-|acct-|svcacct-|none-)?[A-Za-z0-9_-]{8,}/g;

/** 长不透明串：≥40 位连续 base64/hex（签名、密钥体）；不含点，避免吞掉域名/路径。 */
const OPAQUE_BLOB = /[A-Za-z0-9+/_=-]{40,}/g;
/** 点分段长串（JWT / base64url 多段签名）：每段 ≥20 位、至少两段。 */
const DOTTED_BLOB = /\b[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{20,})+\b/g;

/**
 * 本地绝对路径（POSIX 常见根 + Windows 盘符），要求路径前是行首或空白/标点，
 * 因此 URL 内部的路径段（前一个字符是域名）不会被命中。
 * 路径体内的空格仅在其后紧跟「段名/」时才纳入，兼容
 * "Application Support" 这类 macOS 目录，同时不吞并后续正文。
 */
const PATH_LEADING_CLASS = String.raw`[\s"'(\[（【,，:：;；>]`;
const PATH_BODY = String.raw`(?:[^\s"',;，；）)\]]| (?=[A-Za-z0-9@._+\-]+[\\/]))*`;
const POSIX_LOCAL_PATH = new RegExp(
  String.raw`(?:^|${PATH_LEADING_CLASS})\/(?:Users|home|root|tmp|var|private|mnt|media|opt|srv|data|Applications|Library|usr|etc)\/${PATH_BODY}`,
  'g',
);
const WINDOWS_LOCAL_PATH = new RegExp(
  String.raw`(?:^|${PATH_LEADING_CLASS})[A-Za-z]:\\${PATH_BODY}`,
  'g',
);

/** JSON body 中优先提取的人类可读错误字段。 */
const MESSAGE_KEYS = ['message', 'msg'] as const;
const NESTED_KEYS = ['error', 'detail', 'details', 'reason', 'response', 'data'] as const;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** 从已解析的 JSON 里找第一条可读错误文本（嵌套 error.message 优先于顶层 message）。 */
function extractJsonMessage(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of MESSAGE_KEYS) {
    const candidate = record[key];
    if (isString(candidate) && candidate.trim()) return candidate;
  }
  for (const key of NESTED_KEYS) {
    const found = extractJsonMessage(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** 找与 text[start] 配对的右花括号（考虑字符串转义）；找不到返回 -1。 */
function findBalancedClose(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 把 JSON 对象字面量替换为其中的可读 message（继续走后续脱敏）或整体隐藏。 */
function redactJsonObject(candidate: string): string {
  // 只有长得像 JSON（含 "key":）才处理，避免误伤正文里的 {占位符}。
  if (!candidate.includes('":') && !candidate.includes('" :')) return candidate;
  try {
    const extracted = extractJsonMessage(JSON.parse(candidate) as unknown);
    return extracted ? extracted : REDACTED_JSON;
  } catch {
    return REDACTED_JSON;
  }
}

/** 移除 / 收敛消息内嵌的原始 JSON body；提取出的 message 仍会走后续脱敏。 */
function redactJsonBodies(text: string): string {
  let previous = text;
  // 有界遍数：提取结果本身再含 JSON 的场景，三轮足够收敛且保证终止。
  for (let pass = 0; pass < 3; pass += 1) {
    if (!previous.includes('":') && !previous.includes('" :')) break;
    let output = '';
    let cursor = 0;
    while (cursor < previous.length) {
      const start = previous.indexOf('{', cursor);
      if (start === -1) {
        output += previous.slice(cursor);
        break;
      }
      const end = findBalancedClose(previous, start);
      if (end === -1) {
        output += previous.slice(cursor);
        break;
      }
      output += previous.slice(cursor, start);
      output += redactJsonObject(previous.slice(start, end + 1));
      cursor = end + 1;
    }
    if (output === previous) break;
    previous = output;
  }
  return previous;
}

/** 带敏感 query 的 URL 整条隐藏；普通 URL 保留（域名/路径便于排查）。 */
function redactUrls(text: string): string {
  return text.replace(URL_PATTERN, (url) => {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return url;
    const query = url.slice(queryIndex);
    if (SECRET_QUERY_PARAM.test(query) || LONG_QUERY_VALUE.test(query)) {
      return REDACTED_URL;
    }
    return url;
  });
}

/**
 * 本地绝对路径 → [本地路径]。匹配可能带一个前导分隔符（空格/引号等），
 * 替换时保留该分隔符；纯 `^` 锚定的匹配（路径即整段开头）直接整体替换。
 */
function redactAbsolutePaths(text: string): string {
  const posix = text.replace(POSIX_LOCAL_PATH, (match) =>
    match.startsWith('/') ? REDACTED_PATH : `${match[0]}${REDACTED_PATH}`,
  );
  // Windows：`match[1] === ':'` 说明首字符是盘符（^ 锚定），否则是前导分隔符。
  return posix.replace(WINDOWS_LOCAL_PATH, (match) =>
    match[1] === ':' ? REDACTED_PATH : `${match[0]}${REDACTED_PATH}`,
  );
}

function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 截断到上限；按码点切，避免劈开代理对。截断后长度恰为上限，保证幂等。 */
function boundLength(text: string): string {
  if (text.length <= MAX_PROVIDER_ERROR_MESSAGE_LENGTH) return text;
  const keep = MAX_PROVIDER_ERROR_MESSAGE_LENGTH - TRUNCATION_SUFFIX.length;
  return `${Array.from(text).slice(0, keep).join('')}${TRUNCATION_SUFFIX}`;
}

/**
 * 把 Provider / 上游错误消息收敛为「有界、用户安全」的文本：
 * 隐藏密钥与凭据、签名 URL、本地绝对路径，剥离堆栈与原始 JSON body。
 *
 * 幂等：已脱敏文本再次传入结果不变。空文本回退为 fallback（默认「生成失败」），
 * 保证 error.message 永远有可展示的内容。
 */
export function sanitizeProviderErrorMessage(message: unknown, fallback = '生成失败'): string {
  const raw = isString(message) ? message : String(message ?? '');
  if (!raw) return fallback;

  let text = raw.replace(STACK_FRAME, '\n');
  text = redactJsonBodies(text);
  text = redactUrls(text);
  text = text
    .replace(AUTHORIZATION_HEADER, `Authorization: ${REDACTED_KEY}`)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED_KEY}`)
    .replace(KEY_ASSIGNMENT, `$1=${REDACTED_KEY}`)
    .replace(SK_KEY, REDACTED_KEY)
    .replace(DOTTED_BLOB, REDACTED)
    .replace(OPAQUE_BLOB, REDACTED);
  text = redactAbsolutePaths(text);
  text = collapseWhitespace(text);
  if (!text) return fallback;
  return boundLength(text);
}
