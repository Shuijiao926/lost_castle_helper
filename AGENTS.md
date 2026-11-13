# AGENTS.md · 开发规范

> 面向所有在本仓库工作的人 / AI Agent。
> 目标：**边界清晰、依赖单向、改动可测试、提交可回溯**。
> 具体技术细节见 [文档索引](./文档/文档索引.md)（前端架构 / 主进程架构 / 服务端说明）。

## 1. 项目定位

Windows 桌面小工具：常驻托盘 + 热键浮窗，展示《失落城堡2》流派数据。

**三条不能破的底线**（违反会让工具失去意义）：

1. 面板窗口 `focusable: false` —— 抢焦点 = 把游戏踢出全屏
2. 显示面板用 `showInactive()`，不用 `show()`
3. 面板热键成对注册 / 注销 —— 面板开才注册方向键，关立即注销

## 2. 架构设计思想

本项目采用 **DDD（领域驱动设计）+ 模块化单体**，但按组件规模做**分层裁剪**：
后端完整 DDD 四层；桌面端只保留「领域 / 基础设施 / 表现」三层的核心思想；
**不为模式而模式**——新增抽象必须能带来可测试性或可替换性，否则直接写。

### 2.1 通用分层与依赖规则

```text
接口层（API / IPC / UI 事件）
        ↓ 只传入原始 DTO，不传领域内部对象
应用层（Application：用例 / 编排 / 事务边界）
        ↓
领域层（Domain：实体、值对象、领域规则、仓储接口）   ← 基础设施层实现仓储接口（依赖倒置）
        ↑
基础设施层（Infrastructure：仓储实现、文件/网络、适配器）
```

硬性规则：

- **依赖只能向下**：接口 → 应用 → 领域；基础设施依赖领域，领域**绝不** import 应用 / 接口 / 基础设施
- 领域层是纯逻辑：**不出现 `fs` / `fetch` / DOM / electron / fastify / localStorage**
- 跨模块只通过应用用例或仓储接口通信，不直接 import 别的模块的 domain 内部实现
- 数据出领域必须经过 DTO / 门面转换，**内部字段不外泄**（如宝藏深度 `t`）

### 2.2 服务端：完整 DDD（`apps/server`）

按**限界上下文（Bounded Context）** 拆成 feature 模块，每个模块内部四层：

```text
modules/<feature>/
├─ domain/           实体 / 值对象 / 领域规则 / 仓储接口
├─ application/      用例（操作 domain + repository，返回 DTO）
├─ infrastructure/   仓储实现（JSON → 以后 Prisma 只换这层）
└─ api/              handlers 按 routes.js 路由表注册
```

| 模块 | 领域内容 |
|---|---|
| `builds` | `Build` 聚合根：字段校验、图鉴引用、宝藏顺序、状态机、DTO 剥离 |
| `catalog` | 武器 / 刻印 / 流派标签的 `CatalogSnapshot` |
| `publishing` | `DataPackage` 值对象、版本递增、稳定序列化、sha256 |
| `ratings` | 评分值对象（0–10）、同指纹只保留最后一次 |
| `submissions` | 投稿实体 + 状态机（PENDING → APPROVED/REJECTED）+ 授权校验 |
| `security` | 滑动窗口限流策略（纯函数）+ 指纹 + 计数持久化 |

跨模块共享规则放 `apps/shared`（`@lc2/shared`，**共享内核**，前后端同一份校验）。
`api/routes.js` 是唯一路由声明处，新增接口只改这张表 + handlers。

**通用语言（Ubiquitous Language）**：代码、数据、文档统一使用
「流派 build / 刻印 inscription / 宝藏 treasure / 印象 note / 数据包 package」，
不要混用「套路 / 配置 / 攻略」等口语词当字段名或接口名。

### 2.3 桌面端：简化 DDD（`apps/desktop/src/renderer`）

渲染层没有聚合根、没有多仓储事务，因此只取 DDD 中真正有用的部分：

```text
js/data/catalog.js        数据（静态目录：武器/刻印/标签；流派运行时加载）
        ↓
js/domain/builds.js       ★领域层：纯函数（筛选/搜索/排序/星级/归一化策略）
        ↑
js/infra/repositories.js  ★基础设施：数据源 IPC、印象持久化（可注入、可替换）
        ↓
js/ui/{icons,dom,motion}  表现基础件（图标 / DOM / 动效）
js/app.js                 应用 + 表现：state、用例调用、视图渲染、事件
```

规则：domain 不依赖任何浏览器 API；infra 不碰 DOM；app 只做编排；视图渲染不写业务判断。

### 2.4 主进程：组合根 + 端口适配（`apps/desktop/src/main`）

- `index.js` = **组合根**：只做启动顺序、依赖组装、退出清理，不写业务细节
- `panel.js` = 窗口用例编排（显隐 / 拖拽 / 休眠 / 焦点），依赖注入 `BrowserWindow / screen / panelShadow`
- `config.js` / `notes-store.js` / `data.js` = 仓储/适配器（fs 可注入）
- `nativeBubble.js` / `panelShadow.js` = 原生 helper 适配器（行协议）

新增窗口行为优先改 `panel.js`，不要把状态散回 `index.js`。

### 2.5 其他工程原则

- 单一职责：一个模块/文件只负责一类变化；>500 行考虑拆分
- 配置集中：环境变量只在入口/配置模块读取一次（服务端 `app/config.js`；客户端 env 集中在对应模块）
- 纯函数优先：能在 domain 写纯函数就别放 view / handler
- 显式优于隐式：不搞隐藏全局、不靠 monkey patch；动效走显式 `motion` 调用
- 可替换性：外部依赖（IPC、文件、网络、原生进程）必须可以被 fake 替换（测试依赖此条）

## 3. 目录与常用命令

```text
apps/desktop/src/
├─ main/                 主进程（composite root + 能力模块）
├─ renderer/             渲染层（data / domain / infra / ui / app + styles）
└─ test/                 渲染层 + 主进程单测
apps/server/src/         服务端（DDD 模块化单体）
apps/shared/             共享内核（前后端共用校验）
data/                    种子数据（当前流派已清空，等真实数据接入）
文档/                    设计文档 + 可交互原型
scripts/                 版本 / 校验 / 图标生成 / hooks
.githooks/pre-commit     版本号自动递增
```

```bash
npm install            # 安装依赖 + 自动启用 git hooks
npm run desktop        # 启动客户端（开发）
npm run server         # 启动服务端 http://127.0.0.1:4317
npm run dist           # 打包客户端

npm run validate       # 数据校验
npm test               # 数据 + 桌面测试 + 服务端测试
npm run test:desktop   # 桌面单测（渲染层 + 主进程，无需 Electron）
npm run test:server    # 服务端测试
node scripts/check-links.js    # 文档内链
node scripts/version.js check  # 版本一致性
```

## 4. 如何新增一个功能（端到端）

以「按标签统计流派数量」为例，按依赖顺序做：

1. **通用语言**：新概念先写进 `文档/`，确定中文名 / 字段名
2. **领域层**：在对应 `domain/` 写规则（纯函数 / 实体方法）+ 单测
3. **应用层**：写用例（编排 domain + 仓储），返回 DTO
4. **基础设施**：需要新数据就加仓储方法/适配器；可在测试里用 fake 替换
5. **接口层**：服务端在 `api/routes.js` + handlers 加接口；桌面端在 `main/ipc.js` 加白名单通道
6. **表现层**：渲染层视图调用用例，不写业务判断
7. **文档 + 测试 + 质量门**：更新 `文档/`，跑第 7 节全部检查

## 5. 编码规范

- **JS**：`'use strict'`；2 空格缩进；语句加分号；字符串单引号（HTML 模板除外）
- **命名**：变量/函数 camelCase；类 PascalCase；常量 UPPER_SNAKE；文件 kebab-case；领域术语与数据字段一致
- **模块**：一个文件一个职责；公开 API 集中在 `module.exports`；避免循环依赖
- **配置**：不写死路径 / 端口 / 令牌；服务端只在 `app/config.js` 读 env；客户端 env 只在对应模块读取
- **错误处理**：可预期错误用类型化错误（服务端 `shared/kernel/errors`）；允许的降级必须写注释（如缓存损坏回退空数据）；不要吞掉未知异常
- **异步**：统一 `async/await`；不允许 floating promise（必须 `await` 或 `.catch`）
- **注释**：解释「为什么」，不复述代码；中文注释可以；PowerShell 内嵌 C# 只允许 ASCII
- **依赖**：客户端保持零构建（经典脚本 + `window.LC2`），不引入前端框架 / 打包器；服务端新增依赖需说明理由
- **样式**：新样式写进 `styles/base.css` 或 `styles/skin.css`，不要在渲染逻辑里堆内联样式

## 6. 测试规范

| 层 | 测法 | 位置 |
|---|---|---|
| domain | 纯函数单测，无 mock | `apps/desktop/test/domain.test.js`、`apps/server/test/domain.test.js` |
| infrastructure | 注入 fake fs / IPC / localStorage / HTTP | `repositories.test.js`、`main-stores.test.js` |
| application / 用例 | 假仓储 + 真 domain | `apps/server/test/api.test.js`（fastify.inject） |
| 主进程窗口逻辑 | 假 `BrowserWindow` / `screen` / shadow | `main-panel.test.js` |
| UI | Electron 探针截图 / 交互断言 | 临时探针脚本（不提交），必要时补文档截图 |

要求：一个用例只验证一个行为；测试名用中文描述行为；回归 bug 必须补测试。
**不允许**为了测试在业务代码里加 `if (NODE_ENV==='test')` 分支；用依赖注入解决。

## 7. 质量门（Definition of Done）

提交前全部通过：

1. `npm run validate`（数据）
2. `npm test`（数据 + 桌面 29 + 服务端 28）
3. `node scripts/check-links.js`（文档内链）
4. `node scripts/version.js check`（版本一致性）
5. 改了 UI / 窗口行为 → 实际启动或用 Electron 探针截图确认，不能只看代码
6. 行为变化同步更新 `文档/`

## 8. 数据规则

- **当前状态**：`data/builds.json` 已清空（`builds: []`），客户端显示空状态；**不要再往渲染层塞 mock 示例数据**
- 真实数据只从 `data/*.json`（或数据包）进入：`source.loadBuilds` → `data.js` → IPC → `infra.data` → `domain.normalizeBuilds` → `BUILDS`
- 内部字段（宝藏深度 `t`）绝不能出现在 DTO / 数据包
- 客户端缓存：`<userData>/data-cache/builds.json`（`LC2_CACHE_DIR` / `LC2_DATA_URL` 可配）
- 数据修改必须跑 `npm run validate`

## 9. 版本规范（自动化）

- 版本唯一来源：**根 `package.json`**，自动同步到各 workspace 与 `package-lock.json`
- 预发布期 `0.x.y`：每次提交 pre-commit 自动 `patch +1`；正式发布 `npm run release` 做 `major +1`
- 禁止手改版本号；不要用 `--no-verify` 绕过 hook（排障除外）

## 10. 提交规范

Conventional Commits，一个提交只做一件事：

```text
<type>(<scope>): <summary>
feat(desktop): 支持面板拖出屏幕边界
fix(renderer): 修复 CSS 抽离后背景图相对路径失效
refactor(main): 主进程按职责拆分
docs: 更新数据说明
chore(data): 清空流派数据并准备存储配置
```

type：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf` / `build` / `ci`
scope：`desktop` / `renderer` / `main` / `server` / `shared` / `data` / `docs` / `ui`

## 11. UI / 交互约定

- 皮肤：虚空紫 + 金线 + 暖色底纹，参考 [前端架构](./文档/前端架构.md)
- 文案用用户视角，不出现「根级 / 1 级 / 2 级」等内部术语
- 圆角/阴影走 Win11 DWM；不要用 CSS 阴影模拟窗口阴影
- 弹层层级：`.modal` z-index 30、`.toast` 40；新浮层必须显式设层级
- 空数据 / 无筛选结果给友好空状态，不白屏、不报错
- 动效统一走 `ui/motion.js`（replay / stagger / panelIn / press），不要猴补丁替换业务函数

## 12. Windows 环境坑

- 控制台默认 GBK：脚本 / npm script 需要 `chcp 65001`
- PowerShell 5.1 的 C# 代码块只允许 ASCII（`native/*.ps1`）
- 透明窗口在部分机器失效 → 气泡走原生分层窗口；面板不透明 + DWM 圆角
- 调用 `setOpacity` 会把窗口变 layered，破坏 DWM 圆角 → 系统圆角模式下不要动 opacity
- 打包后 native / assets 走 `extraResources`，PowerShell 读不了 asar 内文件

## 13. 文档与许可

- 行为变化必须同步 `文档/`；新增文档挂到 [文档索引](./文档/文档索引.md)
- 代码 MIT（[LICENSE](./LICENSE)）；数据/文档 CC BY-NC-SA 4.0（[LICENSE-DATA](./LICENSE-DATA)）
- 游戏素材版权归 Hunter Studio；保留 wiki 署名，不删除许可声明

## 14. Agent 行为边界

- 不执行 `git push`、不改写历史；提交 / 推送由维护者完成
- 破坏性操作（清数据、删文件、改协议）先说明影响再执行
- 一次改动保持可 Review：先读后改、小步验证、报告实际运行的命令与结果
- 不伪造验证结果；跑不了的测试要明确说明原因
