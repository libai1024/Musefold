# UI 审计:提示词库(PromptLibraryScreen / PromptListRow / Inspector)

> 只读审议。截图:`prompts-list.png`、`prompts-detail.png`、`prompts-empty.png`。代码:`PromptLibraryScreen.tsx`、`PromptListRow.tsx`。

## 总体评价

浮层操作组(2026-09 P1 修复)解决了标题被挤压的核心问题;Inspector 双栏信息架构清晰。当前**最突兀的元素是行内常驻的文字钮「使用」**——它是整行唯一的非 icon 动作,和紧随其后的五枚 icon 钮不在同一语法里。

## 发现

### P1(高)行操作组的文字钮「使用」与 icon 组并排,风格断裂
- 位置:`PromptListRow.tsx:240` 附近(`data-testid="prompt-row-use"`,ghost Button + 文字「使用」)。
- 现象:截图 `prompts-detail.png` 行尾是「使用 | 复制 | 建方案 | 编辑 | 置顶 | 删除」——首钮带字,后五枚纯图标,同一个浮层里两套语法。Inspector 头部还有一个主色「使用」钮,语义重复出现在两处。
- 建议:行内「使用」改 icon(如 `arrow-up-right` 或 `send`),语义「送到工作台」;Inspector 的主色「使用」保留为主动作。文字态只在触屏(<md)保留——这也符合现有「触屏常显、md+ 浮层」的响应式纪律。

### P2(中)列表为单条时标题旁的计数「1 条」过弱且孤立
- 截图:`prompts-list.png`、`prompts-detail.png`。「提示词库 1 条」中计数是小号灰字,与标题基线略脱。
- 建议:计数并入标题行固定间距,或改为「提示词库 · 1」;空态/多条时同样适用。

### P3(中)「使用 0 次」在详情里显示为「使用 0 次」
- 截图:`prompts-detail.png` Inspector 元数据「使用次数 0」;行内空 `usageCount` 不显示(代码 `usageCount > 0` 才渲染)——两处规则不一致。
- 建议:Inspector 也遵循「0 不显示」或统一显示「未使用」,避免两套规则。

### P4(低)删除icon(row-action)与「移入回收站」的破坏性区分不足
- `PromptListRow.tsx` 移入回收站是普通 `row-action` 灰色 Trash2;hover 才 `text-destructive`。在浮层六钮里删除没有特殊地位,误触成本低(有 toast 可挽回,尚可)。
- 建议:删除钮默认即 `text-destructive/70`,hover 全色;或 hover 延迟 300ms 再显(现浮层已有渐隐遮罩,风险可控,故列低)。

### P5(低)空筛选态双按钮(「清除筛选」+「新建提示词」)并排
- `PromptLibraryScreen.tsx:576-590`:空筛选 CTA 行是 outline「清除筛选」+ default「新建提示词」并排。主次正确,但「清除筛选」在只有单一筛选生效时略重。
- 建议:保留(符合 §8-I5 双 CTA 规范),仅建议把「清除筛选」降为 text-link。列为低。

### P6(信息)触屏(<md)行内常显操作组占位合理
- `max-md:shrink-0` 行内占位 + md+ 浮层覆盖,符合 §4.2 规范,记录为达标。

## 汇总

| 编号 | 严重度 | 主题 |
|---|---|---|
| P1 | 高 | 行内「使用」文字钮改 icon,与 Inspector 主动作分工 |
| P2 | 中 | 标题计数排版 |
| P3 | 中 | 使用次数 0 的显示规则不一致 |
| P4 | 低 | 删除钮破坏性色弱 |
| P5 | 低 | 空筛选双 CTA 次级可降级 |
