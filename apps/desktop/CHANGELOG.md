# musefold-app

## 2.5.3

### Patch Changes

- 2521661: 修复 Windows 安装包缺失 better-sqlite3 导致异机启动失败；构建时检查原生模块，打包冒烟在仓库外运行。

## 2.5.2

### Patch Changes

- 放宽云生图超时：worker 上游生成上限 120 秒 → 5 分钟（科研类等长提示词不再被提前掐断），CLI/MCP 等待上限同步提至 6 分钟避免终态前放弃。
- 新增外壳自动更新：appUpdate 域 + 自动检查/下载 + ad-hoc 自替换安装器，真实线上 feed 两轮端到端验证通过（详见 docs/v2.5/V25-AUTO-UPDATE-VALIDATION.md）。
