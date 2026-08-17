# 04 · 组合引擎规格

> MVP 第二段核心。Fragment / Template / Composition 三层 + 自实现轻量插值引擎 + 按 target 序列化权重（差异化壁垒）。

---

## 1. 三层数据模型

```
Fragment(片段)      —— 原子级素材，如 "cinematic lighting", "8k, sharp focus"
   ↓
Template(模板)      —— 带变量槽位的骨架，如 "{{subject}}, {{style}}, {{lighting}}"
   ↓
Composition(组合)   —— 一次具体的填充实例 + 权重 + 参数
```

字段定义见 [02-data-model.md](02-data-model.md) §3。

**设计意图**：
- Fragment 可复用于多个 Template
- Template 定义骨架与槽位约束
- Composition 是一次"使用"，渲染出最终正/负面文本 + 参数，可"另存为 Prompt"进库

---

## 2. 插值语法（自实现，不用 Handlebars）

**为什么不用 Handlebars**：它对 SD 的 `(word:1.5)`、`<lora:name:1>` 等特殊字符会错误转义。自实现轻量插值器（<200 行 TS），完全掌控字符处理。

### 2.1 语法表

| 语法 | 含义 | 示例 |
|---|---|---|
| `{{slot}}` | 简单替换 | `{{subject}}` → `a young woman` |
| `{{slot:weight}}` | 带权重 | `{{subject:1.3}}` → `(a young woman:1.3)` |
| `{{?slot}}` | 条件插入（空则整段删除，含前导逗号/空格） | `{{?style}}, {{?lighting}}` |
| `{{#if slot}}A{{else}}B{{/if}}` | 条件块 | 有 lighting 用 A，否则用 B |
| `{{slot\|fallback}}` | 默认值 | `{{subject\|a person}}` |
| `{{#each fragments}}...{{/each}}` | 循环 | 拼接多个片段 |

### 2.2 解析与渲染流程

```
Template.body (字符串)
  → parser.parse() → AST（节点数组：Text / Slot / Conditional / Each）
  → renderer.render(ast, slotFills, target) → 渲染后字符串
```

**AST 节点类型**：
```ts
type AstNode =
  | { type: 'text'; value: string }
  | { type: 'slot'; key: string; weight?: number; conditional?: boolean; fallback?: string }
  | { type: 'if'; key: string; then: AstNode[]; else: AstNode[] }
  | { type: 'each'; key: string; body: AstNode[] };
```

**AST 中间表示的价值**：渲染过程保留每个输出片段的来源 slot，支持"点击预览文本 → 高亮来源 slot"反查（差异化功能）。

### 2.3 模块拆分（纯逻辑，可独立单测）

| 文件 | 职责 |
|---|---|
| `src/features/composer/engine/parser.ts` | `parse(body: string): AstNode[]` |
| `src/features/composer/engine/renderer.ts` | `render(ast, slotFills, target): { text, segments }` |
| `src/features/composer/engine/serializer.ts` | `serializeWeight(text, weight, target): string` |
| `src/features/composer/engine/tokenizer.ts` | `countTokens(text): number`（gpt-tokenizer） |

> 这四个文件是纯 TS，**不依赖 Electron / React**，最易交给子代理开发并单测。

---

## 3. 权重序列化（按 target 分发 —— 核心差异化）

同一份 Composition 可对不同模型输出不同语法：

```ts
function serializeWeight(text: string, weight: number, target: PromptTarget): string {
  if (Math.abs(weight - 1.0) < 0.01) return text;
  switch (target) {
    case 'a1111':
    case 'comfyui':
      return `(${text}:${weight.toFixed(2)})`;        // (word:1.5)
    case 'midjourney':
      return `${text}::${Math.round(weight * 10)}`;    // word::15
    case 'flux':
    case 'sd3':
      return weight > 1 ? `very ${text}` : `subtle ${text}`;  // 纯自然语言
    case 'openai':
      return text;  // gpt-image 不用权重，自然语言描述
    default:
      return `(${text}:${weight.toFixed(2)})`;
  }
}
```

**target 取值**：`a1111 | comfyui | midjourney | flux | sd3 | openai | generic`（见 `shared/types/enums.ts`）

---

## 4. 拼接策略

### 4.1 统一分隔
- 全局默认 `, ` 分隔
- 每个 Fragment 可声明 `joinBy` 覆盖（如换行 `\n`）

### 4.2 段落分组
按"主体/风格/光照/构图/画质/LoRA"分组，组内顺序固定，组间换行。
- 理由：SD 的 CLIP 对前文权重略高，顺序影响出图

### 4.3 去重 normalize
- 去多余空白
- 合并重复词（`8k, 8k` → `8k`）
- 合并重复权重括号（`((word:1.5))` → `(word:1.5)`）

---

## 5. 负面提示词管理

- `Fragment.type = "negative"` 的片段专门用于负面
- 模板的 `negativeBody` 复用同一套插值引擎
- 内置高质量预设：人像通用负面、SDXL 推荐负面、Flux 不需要负面等
- **target 适配**：
  - A1111：有独立负面字段
  - Midjourney：用 `--no item1, item2`
  - Flux/SD3：隐藏负面 UI
  - gpt-image：无负面概念

---

## 6. 三栏 UI

```
┌──────────────┬────────────────────┬──────────────────┐
│  左栏         │  中栏               │  右栏             │
│  Fragment 库 │  组合画布           │  实时预览         │
│              │                    │                  │
│ 树形分类+搜索│ Template 槽位       │ 渲染后正文       │
│ + 收藏       │ 拖拽填入 slot      │ + 负面文本       │
│              │ 权重滑块           │ + Token 计数条   │
│              │                    │ + 参数面板       │
└──────────────┴────────────────────┴──────────────────┘
```

### 6.1 左栏：Fragment 库
- 树形分类（按 `type` 一级、`category` 二级），react-arborist
- 搜索（fuse.js 模糊匹配 content/tags）
- 收藏快速访问
- 拖拽源（@dnd-kit Draggable）

### 6.2 中栏：组合画布
- Template 的 slot 列表，每个 slot 一个放置区
- 从左栏拖 Fragment 到 slot：替换（默认）/追加（按住修饰键）
- 每个 slot 旁有权重滑块（0.1-1.9），实时反映到右栏预览
- 顶部选 Template、选 target（a1111/mj/flux/openai）

### 6.3 右栏：实时预览
- 渲染后正/负面文本（随 slot 填充与权重变化实时更新）
- Token 计数进度条：0-75 绿 / 75-150 黄 / >150 红（gpt-tokenizer）
- 参数面板：size/quality/n/background 等（按 target 显隐不同字段）
- "另存为 Prompt"按钮 → 调 `window.api.prompt.createFromComposition`

---

## 7. 拖拽填入规格

- 库：`@dnd-kit/core`
- 从 Fragment 库拖到 slot：
  - 默认替换 slot 现有内容
  - 按住 Shift/Alt = 追加
- slot 内 Fragment 可拖出删除
- 视觉反馈：拖拽时 slot 高亮、放置区放大

---

## 8. "另存为 Prompt"流程

```
右栏"另存为 Prompt"按钮
  → window.api.prompt.createFromComposition(compositionId)
  → 主进程：
      读 Composition + Template
      插入 prompts 表：
        title = 用户输入或 Template.name + 时间戳
        content = composition.rendered_positive
        content_negative = composition.rendered_negative
        params = composition.params
        model_id = template.target 对应模型
        source = 'composition'
        composition_id = composition.id
  → 返回新 Prompt id
  → 跳转到 LibraryPage 并高亮新 Prompt
```

**原则**：单向提升，Prompt 与 Composition 后续独立，编辑 Prompt 不回写 Composition。

---

## 9. 验收标准

- [ ] 插值引擎单测覆盖全部 6 种语法
- [ ] 权重序列化：a1111/mj/flux/openai 四个 target 输出正确
- [ ] 三栏 UI：Fragment 拖到 slot，预览实时更新
- [ ] 权重滑块拖动，预览文本实时反映权重
- [ ] Token 计数随正文变化更新，颜色阈值正确
- [ ] 另存为 Prompt：Library 出现新条目，`source=composition`，`composition_id` 正确
- [ ] 负面提示词：negativeBody 渲染正确，target 适配（MJ 用 `--no`）
