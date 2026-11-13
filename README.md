<div align="center">

<img src="apps/desktop/assets/icon.png" width="96" height="96" alt="城堡助手" />

# 城堡助手 · LC2 Helper

**《失落城堡2》流派速查助手** ｜ 不抢焦点 · 不注入游戏 · 跑在游戏旁边

[![version](https://img.shields.io/github/package-json/v/Shuijiao926/lost_castle_helper?label=version&color=F0C878)](https://github.com/Shuijiao926/lost_castle_helper/releases)
[![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-4B8DFF)](#)
[![electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](#)
[![node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)](#)
[![code license](https://img.shields.io/badge/code%20license-MIT-blue)](./LICENSE)
[![data license](https://img.shields.io/badge/data%20license-CC%20BY--NC--SA%204.0-lightgrey)](./LICENSE-DATA)

[快速开始](#快速开始) · [项目结构](#项目结构) · [开发规范](#开发规范) · [文档](./文档/文档索引.md) · [许可与声明](#许可与声明)

</div>

---

## 简介

打游戏时想确认「这件宝藏要不要拿」「这套玩法该配什么装备」，切屏查攻略会掉焦点、全屏会黑、联机可能掉线。

城堡助手是一个**常驻托盘 + 热键浮窗**的流派速查工具：按一下热键，面板从屏幕边缘浮出，看完再按一下收起——游戏全程不被打断。

```text
Alt + `  →  浮出流派卡片  →  ↑ ↓ 选择  →  Enter 展开 / D 看详情
                                    ↓
                              再按一次收起
```

## 功能

- 🪟 **双窗口**：72×72 圆形气泡 + 440×680 面板，均可拖拽、位置独立记忆
- 🎯 **不抢焦点**：窗口 `focusable: false`，用全局热键驱动，游戏不进后台
- ⌨️ **全键盘操作**：列表 / 详情 / 筛选 / 帮助 / 置顶，全部有快捷键
- 🎮 **游戏风格 UI**：虚空紫 + 金线皮肤、营地篝火底纹、动效节奏统一
- ⭐ **本地互动**：打分、收藏、一句话印象（覆盖更新，本地保存）
- 📦 **数据可更新**：GitHub raw / 自定义数据地址 → 本地缓存 → 内置种子，三级降级
- 🖥️ **原生窗口细节**：Win11 DWM 系统圆角、原生分层气泡（无白角 / 无锯齿）

## 截图

![界面](./文档/界面皮肤预览.png)
![空状态](./文档/空状态预览.png)

## 快速开始

**要求**：Windows 10/11、Node.js ≥ 18（推荐 20+）

```bash
git clone https://github.com/Shuijiao926/lost_castle_helper.git
cd lost_castle_helper
npm install          # 自动启用 git hooks（提交时版本号自动 patch +1）
npm run desktop      # 启动客户端
```

启动后：屏幕右侧出现圆形气泡 → 按 **`Alt + \``** 呼出面板。

| 快捷键 | 作用 |
|---|---|
| `Alt + \`` / `` ` `` | 呼出 / 收起面板 |
| `↑ ↓` | 列表移动 |
| `Enter` / `→` | 展开卡片 |
| `←` | 收起 / 返回 |
| `D` | 打开 / 关闭详情 |
| `F` | 筛选（武器 / 刻印 / 标签 + 排序） |
| `H` | 帮助 |
| `P` | 置顶（点外部不收起） |
| `I` | 投稿入口 |
| `Esc` | 逐级退出 |

> 若 `Alt + \`` 被占用，会依次回退到 `Ctrl+Alt+C` / `Alt+Shift+C` / `Ctrl+Shift+F12`，控制台会打印实际生效的键。
> 游戏内请使用**窗口化 / 无边框窗口**模式（独占全屏盖不住浮窗）。

**服务端（可选，骨架）**

```bash
npm run server       # 默认 http://127.0.0.1:4317
npm run test:server  # 28 个用例
```

**打包**

```bash
npm run dist         # 产物在 apps/desktop/release/
```

## 数据

> **当前状态：流派数据已清空**（`data/builds.json` 为 `builds: []`），客户端显示「数据准备中」空状态，等待真实数据接入。
> 武器 / 刻印 / 标签等参考目录保留，用于筛选与图标。

真实数据接入后仍走同一套流程，代码不需要改：

```text
data/*.json  →  node scripts/validate-data.js  →  客户端拉取（GitHub / 自定义地址 → 本地缓存）
```

- 数据规范：[数据说明](./文档/数据说明.md) · [数据填写指南](./文档/数据填写指南.md)
- 数据来源与许可：[数据源清单](./文档/数据源清单.md)（wiki 内容 CC BY-NC-SA 4.0）
- 客户端缓存位置：`<userData>/data-cache/builds.json`，可用 `LC2_CACHE_DIR` / `LC2_DATA_URL` 覆盖

## 项目结构

```text
lost_castle_helper/
├─ apps/
│  ├─ desktop/          Electron 客户端
│  │  ├─ src/main/      主进程（组合根 + panel/config/geometry/ipc/tray…）
│  │  ├─ src/renderer/  渲染层（data / domain / infra / ui / app 分层 + styles）
│  │  ├─ test/          渲染层 + 主进程单测
│  │  ├─ native/        原生气泡 / 阴影 helper（PowerShell）
│  │  └─ assets/        图标资产
│  ├─ server/           Fastify 数据服务（DDD 模块：builds / catalog / ratings / submissions / publishing）
│  └─ shared/           前后端共用校验层 @lc2/shared
├─ data/                种子数据（builds / weapons / inscriptions / schools）
├─ scripts/             版本、校验、图标生成等脚本
├─ 文档/                 设计文档与可交互原型
├─ AGENTS.md            开发规范（架构约束 / 提交 / 版本 / 质量门）
└─ .github/workflows/   CI（数据校验、测试、版本一致性）
```

## 开发规范

- **架构与约定**：见 [AGENTS.md](./AGENTS.md)（DDD 分层与依赖规则、编码/测试规范、数据规则、UI 约定、Windows 坑）
- **提交规范**：Conventional Commits，如 `feat(desktop): …` / `fix(renderer): …` / `docs: …`
- **版本号（自动化）**：
  - 每次提交 → pre-commit **自动 patch +1**（`0.1.1 → 0.1.2`）
  - 正式发布时 → `npm run release`（语义化 **major +1**，如 `0.9.3 → 1.0.0`），提交并打 tag
  - 版本以**根 `package.json` 为唯一来源**，自动同步到各 workspace 与 lockfile
- **质量门**（提交前全部通过）：

```bash
npm run validate      # 数据校验
npm test              # 数据 + 桌面测试 + 服务端测试
node scripts/check-links.js   # 文档内链
node scripts/version.js check # 版本一致性
```

## 文档

所有设计文档在 [`文档/`](./文档/文档索引.md)，从 [文档索引](./文档/文档索引.md) 开始看：

- [方案总纲](./文档/方案总纲.md) · [需求说明](./文档/需求说明.md) · [技术架构](./文档/技术架构.md)
- [前端架构](./文档/前端架构.md) · [主进程架构](./文档/主进程架构.md) · [服务端说明](./文档/服务端说明.md)
- [数据源清单](./文档/数据源清单.md) · [数据说明](./文档/数据说明.md) · [贡献指南](./文档/贡献指南.md)
- [可交互原型](./文档/原型/index.html)（浏览器直接打开）

## 许可与声明

- **代码**：[MIT License](./LICENSE)
- **数据与文档**：[CC BY-NC-SA 4.0](./LICENSE-DATA)（署名 · 非商业 · 相同方式共享）
- **游戏素材**：`失落城堡2` 商标与游戏内素材版权归 [Hunter Studio](https://store.steampowered.com/app/2445690/) 所有；图标等参考数据来自 [失落城堡2中文维基](https://lc2.huijiwiki.com/)（CC BY-NC-SA 4.0）
- 本项目为**非商业的玩家工具**，与 Hunter Studio 无关联；不会注入游戏、修改游戏文件或读取游戏内存

---

<div align="center"><sub>如果对你有帮助，点个 ⭐ 就好</sub></div>
