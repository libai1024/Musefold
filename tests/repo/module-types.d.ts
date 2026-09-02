// tests/repo 的测试直接导入仓库内无类型声明的 .mjs 脚本(tooling/aliases、scripts/deploy/*)。
// 运行时由 vitest 按真实模块执行;此宽松声明只让 typecheck 通过,不是这些脚本的权威 API 类型。
declare module '*.mjs';
