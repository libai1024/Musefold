// electron/db/fts.ts
// FTS5 中文分词 —— 纯 JS 预分词，写入 tags_index 列供 FTS5 索引
// 详见 docs/02-data-model.md §2.4、docs/03-prompt-library.md §2.1

let segmenter: Intl.Segmenter | null | undefined;

const HAN_SEQUENCE_RE = /\p{Script=Han}+/gu;
const WORD_RE = /[\p{L}\p{N}_]+/gu;
const WORD_CHECK_RE = /[\p{L}\p{N}_]/u;
const HAN_TOKEN_RE = /\p{Script=Han}/u;
const NON_WORD_RE = /^[\p{P}\p{S}\s]+$/u;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    segmenter = null;
    return segmenter;
  }
  segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  return segmenter;
}

function addToken(tokens: Set<string>, raw: string): void {
  const token = raw.normalize('NFKC').trim();
  if (!token || NON_WORD_RE.test(token)) return;
  tokens.add(token);
}

function addHanSequence(tokens: Set<string>, sequence: string): void {
  const normalized = sequence.normalize('NFKC').trim();
  if (!normalized) return;
  addToken(tokens, normalized);
  const chars = Array.from(normalized);
  for (const char of chars) addToken(tokens, char);
  for (let i = 0; i < chars.length - 1; i += 1) {
    addToken(tokens, `${chars[i]}${chars[i + 1]}`);
  }
}

function tokenizeText(text: string): string[] {
  const normalized = text.normalize('NFKC');
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(HAN_SEQUENCE_RE)) {
    addHanSequence(tokens, match[0]);
  }

  const intlSegmenter = getSegmenter();
  if (intlSegmenter) {
    for (const part of intlSegmenter.segment(normalized)) {
      const segment = part.segment.trim();
      if (!segment || HAN_TOKEN_RE.test(segment)) continue;
      if (part.isWordLike ?? WORD_CHECK_RE.test(segment)) addToken(tokens, segment);
    }
  } else {
    for (const match of normalized.matchAll(WORD_RE)) {
      const word = match[0];
      if (!HAN_TOKEN_RE.test(word)) addToken(tokens, word);
    }
  }

  return [...tokens];
}

/**
 * 把提示词文本+标签拼成一个分词后的字符串，写入 prompts_fts.tags_index。
 * 对中文按汉字序列做整段、单字和双字片段索引，英文/数字按词索引，统一空格分隔。
 */
export function tokenizeForFts(
  title: string,
  description: string | null,
  content: string,
  tags: string[]
): string {
  const parts: string[] = [];
  if (title) parts.push(...tokenizeText(title));
  if (description) parts.push(...tokenizeText(description));
  if (content) parts.push(...tokenizeText(content));
  for (const t of tags) parts.push(...tokenizeText(t));
  // 去重 + 去空
  return [...new Set(parts.filter(Boolean))].join(' ');
}

/**
 * 把用户输入的自由文本转成**安全的 FTS5 MATCH 表达式**。
 *
 * 两个必须解决的问题：
 * 1. **语法注入/崩溃**：FTS5 MATCH 是一门查询语言，用户输入里的 `-`、`*`、`"`、
 *    `AND/OR/NOT`、`(`、`:` 都会被当语法解析，`"a cat, cinematic"` 直接抛
 *    `fts5: syntax error`。因此每个 token 都用双引号包成短语，内部引号转义。
 * 2. **中文命中**：unicode61 分词器把「赛博朋克城市」整体当一个 token，
 *    搜「赛博朋克」不会命中 content 列。故对查询串同样做汉字序列 + 词分词，
 *    与写入时 tags_index 的分词结果同源，从而可命中。
 *
 * 结果形如：`"赛博" OR "朋克" OR "赛博朋克" ...`（宽召回），再由 bm25 排序。
 * 返回 null 表示查询为空、调用方应退回非搜索路径。
 */
export function buildMatchQuery(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const tokens = new Set<string>(tokenizeText(text));

  const quoted = [...tokens]
    // 单字符标点无检索价值，剔除
    .filter((t) => t.length > 0 && !/^[\p{P}\p{S}]+$/u.test(t))
    .map((t) => `"${t.replace(/"/g, '""')}"`);

  if (quoted.length === 0) return null;
  // OR 宽召回：任一词命中即入选，bm25 保证多词命中的排前面
  return quoted.join(' OR ');
}
