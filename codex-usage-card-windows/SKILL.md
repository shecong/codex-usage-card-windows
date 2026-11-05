---
name: codex-usage-card-windows
description: Install, repair, or uninstall the Windows Codex desktop sidebar quota card. Use for requests to add the 5-hour and weekly remaining-usage rings to the Windows Codex client, or when the installed sidebar card stops working after a Codex update.
---

# Codex Windows 侧栏额度

在 Windows 上通过本技能自带的 `scripts/Manage.ps1` 管理侧栏卡片。用技能目录内的绝对路径调用脚本，当前工作目录可以是任意项目。

- 安装或修复时执行 `Manage.ps1 Install`。要求 Microsoft Store 版 Codex 和 PATH 上的 Node.js。安装可重复执行。
- 仅在用户要求卸载时执行 `Manage.ps1 Uninstall`。若提示侧栏版 Codex 正在运行，先让用户保存工作并完全退出。
- 安装成功后，请用户保存工作、完全退出 Codex，再从 Windows 开始菜单打开 **Codex（侧栏额度）**。当前会话使用的进程需要退出后才能加载新版启动脚本。安装本身不会验证当前窗口的圆环显示。

启动器每次从当前 OpenAI.Codex 应用包解析客户端及自带 CLI，避免快捷方式在更新后继续引用旧版本目录。安装文件位于用户目录的 `.codex-usage-card-windows`，使从 Codex 内执行安装时也能避开 AppData 应用包重定向。

排查安装后仍无圆环时，先核对快捷方式是否指向已安装的 `Launch-Codex.ps1`，再检查当前 Codex 进程是否由新入口以 `--remote-debugging-pipe` 启动。用 Node.js 执行 `scripts/quota.cjs` 并传入当前应用包下的 `app/resources/codex.exe`，可以单独验证额度读取。若额度读取正常，检查客户端导航栏结构是否已变化。确认到哪一步就报告到哪一步。
