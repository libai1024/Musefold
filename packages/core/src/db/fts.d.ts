/**
 * 把提示词文本+标签拼成一个分词后的字符串，写入 prompts_fts.tags_index。
 * 对中文按汉字序列做整段、单字和双字片段索引，英文/数字按词索引，统一空格分隔。
 */
export declare function tokenizeForFts(
  title: string,
  description: string | null,
  content: string,
  tags: string[],
): string;
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
export declare function buildMatchQuery(raw: string): string | null;
//# sourceMappingURL=fts.d.ts.map
