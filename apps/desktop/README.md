# apps/desktop — 客户端

Electron 桌面端：主进程（双窗口 / 热键 / IPC）+ 渲染层（单文件界面）+ 原生分层窗口气泡。

**完整说明见 [文档/客户端说明.md](../../文档/客户端说明.md)。**

```bash
# 在仓库根目录执行
npm run desktop
```

三条不能破的规矩：不抢焦点（`focusable: false`）、面板用 `showInactive()`、面板热键成对注册/注销。