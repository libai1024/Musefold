# v0.3 多图参考输入与多图微调开发说明

> 文档状态：实现基线（2026-08-11）
> 适用范围：Workbench 新对话、图片上传、剪贴板、拖拽、历史恢复、图片微调、OpenAI-compatible Provider

## 1. 目标与结论

Musefold 的参考图输入从“单张替换”扩展为“有序图片集合”。用户可以在输入提示词的同时上传多张图片，模型按照上传顺序识别 `图 1`、`图 2`……；多图结果也可以选择多张作为下一轮微调的输入。

TvT `gpt-image-2` 已通过真实接口验证：`POST /v1/images/edits` 接收重复的 `image[]` multipart 字段，模型能够按提示词中“IMAGE 1 / IMAGE 2”的编号使用对应参考图。实际验证使用了“太空猫 + 苹果”两张图片，返回结果同时保留了两者的主体特征。

## 2. 编号与顺序契约

编号只有一个事实来源：`referenceImages` 数组的顺序。

```text
referenceImages[0] → 图 1 → multipart image[] 第 1 个文件
referenceImages[1] → 图 2 → multipart image[] 第 2 个文件
…
```

约束：

- UI 缩略图必须显示稳定编号 `图 1`、`图 2`，移除中间图片后后续图片重新编号。
- 发送给模型的提示词前置一条短说明：`参考图按上传顺序编号为图 1、图 2……，请按编号理解用户指代。`
- Provider 不得按文件名排序、并发重排或只取第一张图。
- 历史恢复、编辑回填和微调都必须保留数组顺序。
- 统一上限为 16 张；单张图片仍遵守本地校验的 20 MiB、PNG/JPG/WebP 限制。

## 3. 数据与进程边界

```mermaid
flowchart LR
  A[剪贴板 / 拖拽 / 文件选择] --> B[Renderer 有序 referenceImages]
  B --> C[IPC GenerateImageRequest]
  C --> D[主进程逐项授权与读取]
  D --> E[Provider multipart image[]]
  E --> F[b64_json / 本地历史]
  F --> G[Workbench 会话与下一轮微调]
```

共享请求使用 `referenceImages?: LocalImageReference[]`，不再用单数 `referenceImage` 作为新链路字段。Renderer 不接触 API Key；主进程负责路径授权、文件读取、multipart 构造、错误归一化和结果落盘。

`LocalImageReference.source` 仍区分 `upload` 与 `history`：

- `upload` 只能来自系统选择、剪贴板或拖拽暂存目录。
- `history` 必须通过 `historyId + path` 双重校验，防止 renderer 伪造任意路径。

## 4. Composer 交互

### 4.1 参考图条

- 输入框上方显示水平缩略图条，每个缩略图包含编号、预览和移除按钮。
- 缩略图点击打开 Lightbox；移除后重新计算编号。
- 文件选择支持一次选择多张；剪贴板一次粘贴一张，连续粘贴按顺序追加；拖拽可一次加入多张。
- 达到 16 张后，继续添加必须给出明确提示，不静默丢弃。
- 输入提示词时可以直接写“图 1 的主体”“把图 2 的背景换成……”。

### 4.2 微调上下文

- 从单个结果继续微调时，父图作为 `图 1`。
- 在结果多选状态中选择多张后，点击“继续微调”，被选结果按选择顺序成为 `图 1…图 N`。
- 微调上下文中的上传图片可以继续追加；重复图片不重复提交。
- 微调输入区仍保留普通提示词、负面提示词、比例和质量设置。

## 5. Provider 契约

OpenAI-compatible Provider：

```ts
const form = new FormData();
form.append('model', model);
form.append('prompt', promptWithImageIndexHint);
for (const image of referenceImages) {
  form.append('image[]', new Blob([bytes], { type: image.mimeType }), image.name);
}
```

非多图 Provider 必须返回结构化 `IMAGE_EDIT_UNSUPPORTED`，不能静默截断为第一张。Provider 能力由适配器声明或在请求前明确检查；当前 v0.3 首先保证 OpenAI-compatible `gpt-image-2` 多图链路。

## 6. 多图结果选择与批量保存

- 结果卡片长按约 520ms 进入选择状态；桌面端同时提供“选择图片”按钮作为可见和键盘入口。
- 选择状态不再显示图片悬浮操作，选中卡片使用边框和勾选标识。
- “已选择 N 张 / 取消 / 保存所选”工具栏必须位于结果网格下方，与现有底部 `action-button` 风格一致。
- 保存所选只弹一次目录选择框；主进程自动处理同名文件，不覆盖已有文件。
- 取消后清空选择；保存成功后退出选择状态并提示数量。

## 7. 可访问性与 QA 验收

- 每张缩略图和结果卡片都必须有编号、可读的 `aria-label` 和可见 focus 状态。
- 长按必须有显式按钮等价操作；键盘可以进入选择、切换图片、取消和保存。
- 选择状态、加载、错误、无权限和超过上限都必须有明确文本，不依赖颜色单独传达状态。
- 单图请求回归：请求仍只发送一个 `image[]`，生成和历史行为不变。
- 多图请求：断言顺序、数量、文件名不泄露本地路径，且 `image[]` 字段数量与输入数组一致。
- 多图微调：断言父图和追加图片的编号顺序，结果可恢复到下一次编辑。
- 真实 TvT 验收：使用临时 Key，确认 `HTTP 200`、`data[0].b64_json` 可解码，并肉眼确认图 1 / 图 2 内容均出现。

## 8. 禁止事项与迁移说明

- 禁止在 renderer 直接请求 Provider。
- 禁止把 API Key 写入文档、日志、测试快照或 generated 产物说明。
- 禁止用文件名代替编号；文件名仅用于 multipart 的展示元数据。
- 禁止在 UI 隐藏多图能力却在请求层静默发送多张图。
- 旧的单图字段只允许在一次性数据读取迁移中被识别，写入和新请求统一使用 `referenceImages`。
