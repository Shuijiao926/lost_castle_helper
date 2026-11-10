# LC2 Helper 代码架构设计 v0.3

> 配套：[总纲](./PROPOSAL.md) · [PRD](./PRD.md) · [原型](../design/index.html)

---

## 1. 技术选型结论

| 项 | 选择 | 理由 |
|---|---|---|
| 运行时 | **Electron**（便携版打包） | 本机已有 Node；透明窗/全局热键/托盘/多显示器 API 齐全；社区可维护 |
| 界面层 | **原生 HTML/CSS/JS，无框架、无打包链** | 界面只有「树 + 详情 + 榜单」，引入 React/Vite 增加配置与体积，收益低。改代码即时生效，贡献门槛低 |
| 数据校验 | **自写轻量 validator**（约 80 行） | 数据字段稳定，不值得引入 ajv |
| 单测 | **Node 内置 `node --test`** | 零额外依赖 |
| 打包 | **electron-builder → portable exe** | 免安装、不写注册表，玩家接受度高 |
| 持久化 | 自写 JSON 到 `app.getPath('userData')` | 无第三方依赖 |

**为什么不用 Tauri**：需要 Rust + MSVC 构建链，本机未安装；M1 目标是当天可跑。后续若内存/体积成为问题再迁移（架构已按"渲染层与主进程解耦"设计，迁移成本可控）。

---

## 2. 进程与窗口模型

```
┌──────────────────────────── Main Process (Node) ────────────────────────────┐
│  bootstrap → singleInstance → tray → windowController                        │
│                                                                              │
│  ┌────────────┐ ┌───────────────┐ ┌──────────────┐ ┌───────────────┐        │
│  │ HotkeyMgr  │ │ WindowCtrl    │ │ DataStore    │ │ ConfigStore   │        │
│  │ 两套注册   │ │ 单窗口双形态  │ │ 加载/校验/热更│ │ 设置/位置持久化│        │
│  └────────────┘ └───────────────┘ └──────────────┘ └───────────────┘        │
│         │              │                  │                                  │
│         └──────IPC─────┴──────────────────┘                                  │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ contextBridge (preload)
┌──────────────────────────────────▼───────────────────────────────────────────┐
│                        Renderer Process (单个 BrowserWindow)                  │
│   UIMachine（状态机）→ View（Bubble / Tree / Detail / Board）+ render 纯函数   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 单窗口双形态

不用「气泡窗口 + 面板窗口」两个 BrowserWindow，而是**一个窗口切换形态**：

| 形态 | 尺寸 | 锚点 |
|---|---|---|
| Bubble | 36×36 | 记住的屏幕位置 |
| Panel | 420×H | 以气泡为锚点向外展开（默认向左/上，越界自动翻转） |

好处：热键、层级、焦点策略只需管理一套；展开动画即窗口 resize，性能好。
风险：Window resize 的圆角/内容重排不够丝滑 → 用 CSS transform 过渡补偿（动画期间先改尺寸再淡入内容）。

> 若实测动画不达标，退化方案：两窗口（bubble 常驻 + panel 独立显示），架构预留 `WindowCtrl` 接口，切换成本低。

### 2.2 窗口参数（关键）

```js
new BrowserWindow({
  width: 36, height: 36,
  transparent: true,
  frame: false,
  resizable: false,
  skipTaskbar: true,
  hasShadow: false,
  focusable: false,            // 永不抢焦点
  backgroundColor: '#00000000',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});

win.setAlwaysOnTop(true, 'screen-saver');
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
```

---

## 3. 目录结构

```
lost_castle_helper/
├─ package.json
├─ README.md
├─ LICENSE                     # CC BY-NC-SA 4.0
├─ data/                       # 数据（玩家可直接改 / 社区 PR 修改）
│  ├─ meta.json
│  ├─ weapons.json
│  ├─ builds.json              # 核心：18 流派 + 四块内容
│  ├─ treasures.json
│  └─ schools.json
├─ src/
│  ├─ main/
│  │  ├─ index.js              # 入口：app ready、单实例、生命周期
│  │  ├─ tray.js
│  │  ├─ window.js             # WindowCtrl：形态切换/锚点/边界/动画
│  │  ├─ hotkeys.js            # HotkeyMgr：两套注册
│  │  ├─ store.js              # ConfigStore：设置 + 位置 + 持久化
│  │  ├─ data.js               # DataStore：加载/校验/热更/降级
│  │  └─ ipc.js                # IPC 路由（channel 白名单）
│  ├─ shared/
│  │  ├─ validate.js           # 轻量 schema 校验
│  │  ├─ recommend.js          # 门槛计算（纯函数，可单测）
│  │  └─ tree.js               # builds.json → 纯树模型的展开
│  ├─ preload.js               # contextBridge 暴露最小 API
│  └─ renderer/
│     ├─ index.html
│     ├─ style.css
│     ├─ app.js                # UIMachine + 事件绑定
│     └─ views/
│        ├─ bubble.js
│        ├─ tree.js
│        ├─ detail.js
│        └─ board.js
├─ design/index.html        # 交互原型（单文件，不参与打包）
├─ tools/
│  └─ fetch_wiki.py            # 抓灰机wiki流派分类 → 生成 treasures.json
└─ test/
   ├─ recommend.test.js
   ├─ tree.test.js
   └─ validate.test.js
```

---

## 4. 数据流

```
[启动]
 main/index.js
   → DataStore.load()       读 data/*.json → validate() → 失败则读内置备份
   → tree.build()           builds/weapons → 纯树模型（只算一次，缓存）
   → WindowCtrl.create()    创建气泡窗口
   → renderer 收到 {tree, meta} → 渲染 Bubble

[呼出面板]
 HotkeyMgr(Alt+`) fired
   → WindowCtrl.expand()    计算锚点 → setBounds → 通知 renderer 切换形态
   → UIMachine → TREE
   → HotkeyMgr.enablePanelKeys()   临时注册导航键

[交互]
 ↑↓→← / Space / Tab
   → renderer 更新本地 UI 状态（不落盘）
   → 需要持久化的（节点、勾选）→ IPC → ConfigStore / SessionStore

[收起]
 HotkeyMgr(Alt+` / Esc)
   → HotkeyMgr.disablePanelKeys()
   → WindowCtrl.collapse() → UIMachine → BUBBLE
   → 持久化当前位置与节点
```

---

## 5. 关键实现

### 5.1 HotkeyMgr：两套注册（全项目最关键 30 行）

```js
const BASE = 'Alt+`';
const PANEL_KEYS = ['Up','Down','Left','Right','Tab','Space','Esc','Enter',
                    '1','2','3','4','5','6','7','8','9'];

class HotkeyMgr {
  registerBase() {
    if (!globalShortcut.register(BASE, () => this.toggle())) {
      this.fallbackBase();     // 依次尝试 Alt+Q、Ctrl+Shift+Space…
    }
  }
  enablePanelKeys() {
    for (const k of PANEL_KEYS) globalShortcut.register(k, e => this.onKey(k));
  }
  disablePanelKeys() {
    for (const k of PANEL_KEYS) globalShortcut.unregister(k);
  }
  toggle() {
    this.panelOpen ? this.closePanel() : this.openPanel();
  }
  openPanel() { this.panelOpen = true;  this.enablePanelKeys();  /* … */ }
  closePanel(){ this.panelOpen = false; this.disablePanelKeys(); /* … */ }
}
```

**纪律**：`enablePanelKeys` / `disablePanelKeys` 必须成对，且放在窗口显隐的 `try/finally` 里，防止异常导致永久占用方向键（那会让玩家游戏内无法移动——最高危 bug）。
**兜底**：进程退出前 `globalShortcut.unregisterAll()`；托盘菜单加"强制释放热键"。

### 5.2 focusable:false 与"输入"的矛盾（重要取舍）

`focusable:false` 意味着**永远不能打字**。所以搜索分两档：

| 方案 | 是否抢焦点 | 说明 |
|---|---|---|
| **筛选器**（默认） | 否 | 按 `F1/F2/F3` 循环切换"武器类型 / 强度档 / 版本"筛选，纯按键，无输入 |
| 高级搜索（`F4`） | **是** | 临时 `setFocusable(true)` 激活窗口并弹出输入框，顶部明确提示"游戏将短暂失去焦点"；`Esc` 关闭后立即 `setFocusable(false)` 并重新置顶 |

这是刻意的设计：**不为了一个搜索框牺牲"永不抢焦点"这条底线**。

### 5.3 面板展开的锚点计算

```js
function computeBounds(bubble, panelW, panelH, workArea) {
  // 默认向左展开，左侧空间不足则向右
  let x = bubble.x - panelW < workArea.x ? bubble.x + bubble.width : bubble.x - panelW;
  // 垂直方向以气泡为中心，越界则夹紧
  let y = clamp(bubble.y + bubble.height/2 - panelH/2, workArea.y, workArea.y + workArea.height - panelH);
  return { x: Math.round(x), y: Math.round(y), width: panelW, height: panelH };
}
```

多显示器：用 `screen.getDisplayMatching(bubbleBounds)` 取对应 `workArea`。

### 5.4 门槛计算（纯函数，必须有单测）

```js
// recommend.js
const TIER_ORDER = { S: 0, R: 1, '1': 2, '2': 3 };

/**
 * @param {Array<{schools:{id,tier,weight}[]}>} owned  本局已拿宝藏
 * @param {Array<{schools:{id,tier,weight}[]}>} pool   候选宝藏
 * @returns {{available:Set, progress:Object, next:Array}}
 */
export function computeAvailability(owned, pool) {
  const maxTier = {};                        // 每个流派标签的当前最深
  for (const t of owned)
    for (const s of t.schools)
      maxTier[s.id] = Math.max(maxTier[s.id] ?? 0, TIER_ORDER[s.tier] + 1);

  const canReach = (item) => item.schools.every(s => {
    const cur = maxTier[s.id] ?? 0;
    return TIER_ORDER[s.tier] + 1 <= cur + 1;   // 当前最深 +1 >= 所需
  });
  // …返回可用集合、各流派进度、按权重排序的下一步
}
```

**测试用例**（对应游戏机制，来自 wiki「宝藏 → 流派」页）：
- 有根级电属性 → 可拿 1 级电属性，不可拿 2 级
- 多标签宝藏必须所有标签都达标
- 无任何该标签 → 只能拿种级/根级

### 5.5 DataStore：加载、校验、降级

```
load():
  read data/*.json
  → validate()       失败 → 记日志 → 读 resources/data.bak.json
                     再失败 → 用内置最小数据集（仅 1 个流派，保证不白屏）
  → 合并 meta.json 版本信息
  → 返回 {builds, weapons, treasures, meta}
```

热更新（M5）：
```
checkUpdate(): fetch raw.githubusercontent.com/…/data/meta.json
  → 比对 sha256 → 有更新则下载 zip/json 到临时目录
  → 校验通过后原子替换（write tmp → rename）
  → 失败保持旧数据，UI 提示"更新失败，仍使用本地数据"
```

### 5.6 持久化

| 文件 | 内容 |
|---|---|
| `config.json` | 热键、透明度、气泡位置、默认视图、开机自启 |
| `session.json` | 上次节点、展开状态、本局勾选的宝藏（进程退出即视为结束） |

写入采用 `写临时文件 + rename`，避免断电写坏。

---

## 6. 安全与合规

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- preload 只暴露白名单 API：`openPanel / closePanel / getTree / getConfig / setConfig / saveSession / checkUpdate`
- **不加载任何远程页面**，只加载本地 `index.html`（更新只更新 JSON 数据）
- 不访问游戏进程、不注入、不写游戏目录 —— 硬性约束，写进 README 与代码注释
- 数据许可：CC BY-NC-SA 4.0，仓库内 `LICENSE` + README 署名（详见 PRD §8）

---

## 7. 打包与发布

```jsonc
// electron-builder 关键配置
{
  "appId": "com.lc2helper.app",
  "productName": "LC2 Helper",
  "win": { "target": ["portable", "zip"], "icon": "build/icon.ico" },
  "portable": { "artifactName": "LC2Helper-${version}-portable.exe" },
  "files": ["src/**/*", "data/**/*", "package.json"]
}
```

- 版本号与数据版本分离：`app 1.2.0` 可以搭配 `data 1.0.1.3-r2`
- 发布物：`LC2Helper-x.y.z-portable.exe`（免安装）+ `data-*.zip`（可选覆盖更新）
- 不做自动静默更新（避免玩家困惑），改为托盘"检查更新"提示

---

## 8. 测试策略

| 层 | 手段 | 覆盖 |
|---|---|---|
| 算法 | `node --test test/recommend.test.js` | 门槛计算、排序、边界 |
| 数据 | `test/validate.test.js` | 18 个流派 JSON 全量校验、必填字段、版本号格式 |
| 树构建 | `test/tree.test.js` | 纯树层级、顺序、武器类型覆盖 9 类 |
| 交互 | 手动 checklist（PRD §9） | 热键、焦点、展开收起、多显示器 |
| 回归 | 每次发版跑 `npm run check`（校验+单测） | — |

**没有自动化 UI 测试**：Electron 的 e2e（Playwright）成本高、收益低，本期用原型 + 手动 checklist 替代。

---

## 9. 性能预算与优化点

| 指标 | 预算 | 手段 |
|---|---|---|
| 冷启动 | < 2s | 延迟创建窗口（app ready 后异步加载数据）、数据预编译为树缓存 |
| 展开 | < 150ms | 窗口 resize + CSS transform，不重建 DOM（树渲染一次，切换只改 class） |
| 内存 | < 200MB | 无框架、无打包链依赖、图片零加载（纯文字 + CSS 形状） |
| 滚动 | > 50fps | 数据量小（18 流派），无需虚拟列表 |

---

## 10. 演进路线（预留扩展点）

| 方向 | 预留 |
|---|---|
| BepInEx 内嵌版 | `recommend.js` 是纯函数、与运行时无关，可直接移植到 C#（逻辑一致） |
| OCR 自动识别武器 | `WindowCtrl` 旁加 `OcrService`，产出 `currentWeaponId` 事件，UIMachine 直接消费 |
| 多游戏支持 | `data/` 目录按游戏分文件夹，`DataStore` 增加 `gameId` 参数 |
| 迁移 Tauri | `renderer/` 是标准 HTML/CSS/JS，主进程逻辑已按模块拆分，替换壳层即可 |

---

## 11. 架构层面的开放问题

1. 单窗口双形态若动画不达标，是否接受两窗口（内存 +30MB 换流畅）？
2. `treasures.json` 全量约 200+ 条，是否需要按需加载（当前设计一次性加载，估计 < 200KB，无必要）
3. 高级搜索（F4 抢焦点）是否值得做，还是只保留纯按键筛选？
4. 是否需要"流派变体 variant"层？（会影响树的深度：`流派 → 变体 → 四块`，比现在是 5 层）
