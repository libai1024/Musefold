# Musefold v1.4：视觉切割（Awwwards 级 UI）

> **状态**：方向与选型已冻结（2026-08-22）；Phase 0–4 与 SHOT-01 已完成，Phase 5 REL 待真实构建与发布协调
>
> **对外版本**：0.6.0（用户可见的第一次视觉切割）

v1.4 把「Awwwards 级 UI」简报收成双寄存器体系：Theater 面（官网、引导、空态、生成瞬间）把浏览器当成折页画布，Operate 面（工作台、库、历史、设置）保持精密仪器纪律。全程 Lucide 单一图标源、零 emoji、不改品牌色。

## 文档

| 文档 | 作用 |
|---|---|
| [视觉方向与双寄存器](./V14-UI-DIRECTION.md) | 双寄存器主结构、表面清单、图像策略、排版、动效、签名时刻、反模式与验收标准 |
| [技术选型与决策](./V14-TECHNOLOGY-DECISIONS.md) | D1–D14 冻结结论：寄存器实现、Web 样式统一、GSAP、字体分叉、emoji 门禁、视觉门禁协议、0.6.0 版本口径 |
| [UI 落实计划](./V14-DELIVERY-PLAN.md) | 执行卡片唯一登记处：Phase 0–5 + 截图刷新，GOV / WEB / OPERATE / THEATER / SITE / REL 卡片、发布门禁与风险 |

## 阶段速览

Phase 0 治理与地基（门禁先于外观）→ Phase 1 Web 样式统一（零视觉变更）→ Phase 2 Operate 收口 → Phase 3 Theater 产品内 → Phase 4 官网 Theater → 截图刷新 → Phase 5 0.6.0 切割与收口。

## 上游依据

- [v1.3 迁移计划](../v1.3/V13-MIGRATION-PLAN.md) §8.4 触发条件（Web 手写 CSS 于下次大改样式时统一）在本版本满足。
- [v1.2.1 交付计划](../v1.2.1/V121-DELIVERY-PLAN.md) 的版本口径与内容层发布路径继续有效；本版本默认不抬 `minShellVersion`。
- [v0.2.2 UI 开发约束](../v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md) 对 Operate 全文有效，Theater 例外以其新增 §0.1 为唯一登记处。
