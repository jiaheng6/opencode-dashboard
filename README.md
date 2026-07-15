# OpenCode Go 多账号余量看板

这是一个仅在本机运行的 Electron 应用，用于集中展示多个 OpenCode Go 账号的 5 小时、每周和每月余量。

## 工作方式

- 每新增一个账号，创建一个独立的 Electron `WebContentsView`。
- 每个账号使用独立的 `persist:` Session 分区，登录态互不影响。
- 用户在内嵌页面中自行登录，不需要向应用粘贴 API Key 或 Cookie。
- 应用通过 Chrome DevTools Protocol 监听该账号页面的 Network 响应。
- 当响应中出现 `rollingUsage`、`weeklyUsage`、`monthlyUsage` 时，解析使用率和重置时间并更新看板。
- 删除账号时，同时清理该账号对应的本地浏览器存储和缓存。
- 点击窗口右上角关闭按钮时隐藏到系统托盘，不会退出后台刷新。
- 单击托盘图标可以重新显示面板；右键菜单提供“显示面板”和“退出程序”。

## 开发运行

环境要求：Node.js 24 或更高版本。

```powershell
npm install
npm run dev
```

## 检查与构建

```powershell
npm test
npm run typecheck
npm run build
```

构建后的前端文件位于 `dist`，Electron 主进程文件位于 `dist-electron`。

## 桌面安装包

项目使用 `electron-builder` 生成桌面安装包：

```powershell
npm run package:win
npm run package:linux
npm run package:mac
```

推送 `v*` 格式的 Git 标签后，GitHub Actions 会分别在 Windows、Linux 和 macOS 托管环境中构建：

- Windows x64：NSIS 安装程序
- Linux x64：AppImage
- macOS：同时支持 Intel 与 Apple 芯片的通用 DMG

三个平台构建全部成功后，流水线会自动创建 GitHub Release 并上传安装包。

## 使用步骤

1. 点击“添加账号”，填写方便识别的备注名。
2. 在打开的独立内嵌页面中登录对应的 OpenCode 账号。
3. 进入该账号的 OpenCode Go 用量页面，地址形如 `https://opencode.ai/workspace/{workspaceId}/go`。
4. 应用识别三档余量后，点击“返回看板”。
5. 后续应用将根据设置的间隔依次刷新账号页面。

## 隐私与限制

- 应用不主动读取、导出或保存 Cookie；登录态由 Electron 的独立 Session 分区管理。
- 账号名称、工作区 ID 和最近一次余量快照保存在 Electron 的本机 `userData` 目录。
- 当前方案依赖 OpenCode 网页响应结构。页面改版后，解析规则可能需要同步调整。
- 自动化提取网页数据可能受到 OpenCode 服务条款限制。请仅用于你有权访问的账号，并自行评估合规性。
