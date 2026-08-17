# Musefold / 未像 v0.3 文档入口

> 文档状态：v0.3.0 品牌与产品实现基线
> 当前源码版本：`0.2.2-dev`
> 说明：本目录是 v0.3 的事实源；当前产品已切换到 Musefold 独立品牌与数据域。

## 文档

| 文档 | 用途 |
|---|---|
| [Musefold / 未像 品牌企划](MUSEFOLD-BRAND-PLAN.md) | v0.3 品牌策略、命名、Logo、视觉、文案、迁移和发布验收事实源 |
| [图片编辑 multipart 上传](IMAGE-EDIT-MULTIPART-UPLOAD.md) | TvT image2 图片编辑的本地文件直传契约、错误处理和测试清单 |
| [多图输入与多图微调](MULTI-IMAGE-INPUT-AND-REFINEMENT.md) | 图 1 / 图 2 编号契约、Composer 多图输入、微调继承、Provider 和批量结果验收 |

## v0.3 目标

v0.3 同时推进两条相互支撑的主线：

1. 建立 Musefold / 未像 的品牌基线，把产品从“提示词管理工具”重新表达为“视觉灵感与 AI 生图工作台”。
2. 建立“本地图片 → 主进程 multipart 上传 → 图像编辑 Provider → 本地历史落盘”的稳定链路，支持参考图上传、图生图和图片编辑，同时不把 Provider API Key 暴露给 renderer 或发布包。

## 开发原则

- TvT image2 图片编辑默认使用 multipart 直接上传本地图片。
- 失败的 `images[].image_url` 路径不作为主链路，不为它引入必选图床。
- Provider API Key 只在主进程安全读取和使用。
- 结果图片优先落盘到本地历史目录。
- 每个功能同步补充接口契约、权限边界、失败处理和测试证据。
