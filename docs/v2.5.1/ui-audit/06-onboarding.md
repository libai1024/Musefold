# UI 审计:首启引导(OnboardingFlow / BootShield / 跳过确认)

> 只读审议。截图:Windows 真机流程 `01-first-run-onboarding.png`、`02-onboarding-skip-confirm.png`。代码:`OnboardingFlow.tsx`、`onboarding-store.ts`、`OnboardingStepConnect/Validate`(引用)。

## 总体评价

首帧决策(镜像短路 + BootShield)已解决迟到挂载抢点击的核心问题;welcome 步的品牌排版(让灵感/成为图像 + theater reveal)是全应用最精致的瞬间。剩余问题在**跳过入口的形态**与**步骤指示器的信息量**。

## 发现

### O1(中)「跳过引导」是主视觉旁的大号 outline 按钮,与「开始设置」主钮视觉竞争
- 截图:`01-first-run-onboarding.png`。welcome 卡右下:「跳过引导」(outline,较大)+「开始设置 →」(primary)。跳过是低频退出路径,却获得与主钮几乎同级的面积。
- 建议:跳过降级为文字链(`text-muted-foreground` text-sm,hover 下划线)或移到卡片左下角,与主钮拉开方位差。

### O2(中)步骤指示器(右上四段短线)无文字、无当前步名
- 截图:`01` 右上四条小横线,第一条橙色。视觉轻(好),但用户不知道共几步、当前在哪、每步是什么。
- 建议:hover/聚焦时 tooltip 显示「1/4 欢迎」;或短线+微字(`01`);保持无字也可接受(记录为取舍)。

### O3(低)跳过确认对话框「继续设置 / 跳过并完成」按钮语义好,但主次相反于常规
- 截图:`02-onboarding-skip-confirm.png`。`AlertDialogCancel`「继续设置」(左)+ `AlertDialogAction`「跳过并完成」(右,主色)。跳过是本对话框的主意图(用户点了跳过才进来),主色给「跳过并完成」是对的;但色为主橙可能诱导误确认。
- 建议:主色保留但文案强化后果(「跳过并完成(可随时在设置中连接)」过长,则 description 里说明即可——已有说明,维持现状,列低)。

### O4(低)connect 步的轨道选择(官方账号/桌面 BYOK/豆包免费试用)依赖 capability,Web 只有单轨
- 代码:`OnboardingStepConnect` 按 capability 分叉。Web 单轨时无轨道选择直接进入——正确;桌面三轨时轨道卡的视觉差异(截图未覆盖)按规范是三卡并列。记录:三轨卡的选中态与段控件语法是否一致待真机核(本次未截到)。

### O5(信息)BootShield(品牌标+呼吸点)形态达标
- 短暂遮罩不抢戏、fail-closed 不死锁(8s 硬死线已加),记录为达标。

## 汇总

| 编号 | 严重度 | 主题 |
|---|---|---|
| O1 | 中 | 跳过按钮降级为文字链 |
| O2 | 中 | 步骤指示器加步名 tooltip |
| O3 | 低 | 跳过确认主色(维持,记录) |
| O4 | 低 | 桌面三轨卡选中态待核 |
| O5 | 信息 | BootShield 达标 |
