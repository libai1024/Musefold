# Changesets

v2.5(M5-b)起版本与变更日志由 [Changesets](https://github.com/changesets/changesets) 接管:

- 任何面向用户的改动,提交时附 `pnpm exec changeset` 生成的变更描述;
- 发布前 `pnpm exec changeset version` 汇总 bump 版本与 CHANGELOG;
- 全部包为 private(不发 npm),Changesets 只负责版本记录;桌面 App 的发布
  tag(`v*`)仍由发布流程手动打,驱动 `.github/workflows/release.yml` 矩阵。

App semver 的单一事实源是 `apps/desktop/package.json`(v2.5.0 起)。
