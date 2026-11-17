# Windows 安装包瘦身指南

城堡助手的完整安装包原为 **90.7 MB**。保留同一个 Electron 版本，只调整打包文件清单，对照构建测得 **82.5 MB**，减少约 **9.1%**。以下配置供需要瘦身时手动应用。

## 最容易上手的瘦身方法

先按[构建步骤](#在这台电脑上重新打出-exe)生成原包。在 [桌面端 package.json](../apps/desktop/package.json) 的 `build` 下，将 `files` 和 `extraResources` 两项替换为下列内容。`files` 控制应用归档，`extraResources` 控制应用归档旁边的普通文件。

```json
{
  "files": [
    "src/**/*",
    "assets/**/*",
    "!assets/source/**/*",
    "!assets/_*-preview.png",
    "!assets/icon-{art,face,full,half,raw}.png",
    "package.json"
  ],
  "extraResources": [
    { "from": "../../data", "to": "data", "filter": ["*.json", "!ratings.json", "README.md"] },
    { "from": "assets", "to": "assets", "filter": ["icon.png"] },
    { "from": "native", "to": "native" }
  ]
}
```

这组规则排除设计原图、预览图、旧版图标和 `data/sources/` 采集快照。托盘和面板仍通过 `app.asar` 读取自己的图标和背景，原生气泡由 PowerShell 运行，继续从普通文件 `resources/assets/icon.png` 读取图标。许可和署名说明随实际分发的素材和数据保留。

在 PowerShell 运行下面的命令，将瘦身包写到独立目录，方便比较两个 EXE。

```powershell
$output = Join-Path $PWD 'release/optimized'
npm run dist -w @lc2/desktop -- --publish never "-c.directories.output=$output"
Get-Item 'release/*-setup.exe', 'release/optimized/*-setup.exe' |
  Select-Object FullName, Length
```

测试时先运行 `npm test`，再双击瘦身包安装。确认开始菜单能启动应用、托盘和气泡有图标、面板能通过 **Alt + 反引号**唤出、断网时能读随包数据。对照构建中，解包文件从 **291.8 MB 降到 282.7 MB**，包内客户端已在 Windows 11 验证启动。安装向导和其他系统版本仍需试装。

## 先分清「下载」「安装」「运行」

用户从网页下载 `LC2Helper-0.1.7-win-x64-setup.exe`。双击它，安装向导把压缩在里面的文件写入安装目录，并建立开始菜单快捷方式和卸载入口。之后，每次打开的是安装目录中的 `LC2 Helper.exe`。

```mermaid
flowchart LR
    A[项目源码与资源] --> B[electron-builder 组装应用和 Electron]
    B --> C[NSIS 生成 setup.exe]
    C --> D[用户下载安装包]
    D --> E[安装向导解压到电脑]
    E --> F[从开始菜单启动 LC2 Helper]
```

联网取决于具体环节。

| 环节 | 城堡助手目前怎么做 |
| --- | --- |
| 开发者构建 | 第一次通常要下载 npm 依赖、Electron 和 NSIS 工具。已有匹配的运行时与构建工具缓存时，可以复用 |
| 用户下载 | 可从网站获取 EXE，也可从 U 盘复制同一个文件 |
| 用户安装 | `nsis` 安装包已经包含应用和 Electron，安装阶段无需再下载程序文件 |
| 应用运行 | 托盘、气泡、热键可以离线工作。默认启动后会尝试从 GitHub 获取流派数据，失败后依次读取缓存、随包数据。首次离线使用时，当前随包流派数据为空，面板显示空状态。部分远程图鉴图标需要网络 |

## 市面上常见的几种交付方式

| 方式 | 用户第一次拿到什么 | 什么时候还要下载 |
| --- | --- | --- |
| 完整安装包 | 包含应用及其运行所需文件的安装器。本项目当前采用 `nsis` | 安装阶段无需下载应用。安装后的联网需求由功能决定 |
| 联网安装器 | 小型 `setup.exe`，也叫 bootstrapper。本项目的打包工具提供 `nsis-web` | 通常在**安装时**从服务器下载应用压缩包，下载完成后再安装 |
| 便携版 | 可以解压运行的 ZIP，或双击运行的便携 EXE | 如果运行时已经随文件一起提供，启动前无需下载。Electron 便携 EXE 仍然会带上 Electron |
| 使用系统或共享运行时 | 应用的安装包，例如使用 WebView2 的 Windows 客户端 | 电脑已安装所需运行时时可直接复用。缺少时可联网补装，也可随产品提供离线运行时安装器 |

VS Code 在 Windows 上同时提供用户安装器、系统安装器和 ZIP。Microsoft 365 应用则有复用共享 WebView2 Runtime 的例子。能否做成小安装包，既看运行时放在哪里，也看安装时是否允许联网。 [VS Code 的 Windows 安装选项](https://code.visualstudio.com/docs/setup/windows) · [Microsoft 365 与 WebView2](https://learn.microsoft.com/en-us/deployoffice/webview2-install) · [WebView2 分发方式](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

也可以让应用**第一次打开时**再下载可选内容，例如语音包或离线素材。前提是安装后已有足够组件让界面启动并展示下载进度。城堡助手已经采用类似思路更新流派数据，下载的是数据。若换成 `nsis-web`，安装时下载的则是整个应用包，必须先把对应版本的压缩包放到可访问的地址上。 [electron-builder 联网安装器选项](https://www.electron.build/docs/api/app-builder-lib.interface.nsisweboptions/)

## 90 MB 主要装了什么

Electron 把渲染界面用的 Chromium 和运行桌面逻辑用的 Node.js 一起带上。原始 `0.1.7` 安装包为 **90.7 MB**，解包后约 **291.8 MB**，其中运行时和安装辅助文件约 **281.1 MB**，应用代码与资源约 **10.7 MB**。压缩后的下载体积和安装后占用是两个不同的数字。 [Electron 为什么内置 Chromium 和 Node.js](https://www.electronjs.org/docs/latest/why-electron)

## 怎么让安装包变小

| 做法 | 能省什么 | 需要考虑什么 |
| --- | --- | --- |
| 精简打包文件清单 | 下载体积和安装占用都能下降 | 上面的对照构建剔除了开发素材和大部分重复资源。保留应用用到的文件及署名说明 |
| 减少 Electron 自带语言资源 | 可减少一部分运行时文件和安装包体积 | Electron 33 当前的 55 个语言资源文件解包后合计约 42.2 MB。缩减需要先决定支持哪些系统语言并验证启动及系统文案 |
| 改用 `nsis-web` | 初次点击下载拿到的 EXE 能明显变小 | 完整应用改由安装器下载，首次安装的总下载量和安装后的占用仍接近完整安装包。需要托管文件，并处理断网和下载失败 |
| 改用 WebView2 或原生桌面框架 | 有机会显著缩小应用包，并减少随应用安装的文件 | 属于架构迁移。必须重新验证托盘、全局热键、浮窗不抢焦点、透明气泡以及各 Windows 版本的兼容性 |

完整包适合当前试用阶段，只需要把一个 EXE 发给测试者。若以后主要问题是下载页上的文件太大，可以同时提供联网安装器和完整安装包。若主要问题是**总下载量或安装占用**，优先衡量运行时本身的体积。

## 在这台电脑上重新打出 EXE

使用 Windows x64，在 PowerShell 中进入仓库根目录，也就是能看到根 `package.json` 和 `apps` 的目录。本次用 Node.js 24 构建，仓库配置要求 Node.js 18 或以上。已有依赖时，从 `npm test` 开始即可。

```powershell
npm install
npm test
npm run dist
```

每条命令成功后再执行下一条。`npm install` 准备开发依赖和项目 Git hooks。`npm test` 会校验数据并运行桌面端和服务端测试。`npm run dist` 读取 [桌面端 package.json](../apps/desktop/package.json) 的 `build`，用本地工作区的代码和资源生成安装包。

| 产物 | 用途 |
| --- | --- |
| `release/LC2Helper-版本号-win-x64-setup.exe` | 发给试用者的安装包 |
| `release/win-unpacked/LC2 Helper.exe` | 配合整个 `win-unpacked` 目录在本机试跑。这个 EXE 依赖旁边的 DLL 和资源 |
| `release/*.blockmap` | 构建器生成的分块索引。手动下载安装时只需提供 `setup.exe` |

配置里最常看的几项如下。

| 字段 | 作用 |
| --- | --- |
| `build.win.target` | `nsis` 选择完整安装包，`x64` 选择 64 位 Windows |
| `build.files` | 把主进程、页面和界面素材打进 `resources/app.asar`。`!` 开头的规则排除开发期素材 |
| `build.extraResources` | 把本地数据、PowerShell 脚本和气泡图标复制到 `resources/`。独立运行的 PowerShell 需要能用系统路径读到这些文件 |
| `build.nsis.artifactName` | 写入版本号和架构，生成用户下载时看到的文件名。客户端版本沿用仓库的版本脚本和提交钩子 |

### 下载构建工具失败时

若 npm 依赖已装好，而且 `node_modules/electron/dist/electron.exe` 存在，可以复用它。GitHub 下载 NSIS 或 `winCodeSign` 工具超时时，可以临时为本次 PowerShell 会话指定镜像。镜像只影响开发者构建时下载工具。 [镜像配置说明](https://github.com/cnpm/mirrors#electron-builder)

```powershell
$electronDist = (Resolve-Path 'node_modules/electron/dist').Path
$env:ELECTRON_BUILDER_CACHE = Join-Path $PWD 'release/.build-cache'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist -w @lc2/desktop -- --publish never "-c.electronDist=$electronDist"
```

`--publish never` 让这次构建只在本地生成文件。关闭当前 PowerShell 窗口后，临时环境变量会随会话结束。构建结束后，也可以用下面的命令记录要发送的文件及 SHA-256，方便接收者核对。

```powershell
Get-Item 'release/*-setup.exe' | Select-Object Name, Length
Get-FileHash 'release/*-setup.exe' -Algorithm SHA256
```

## 怎么给别人下载

1. 先双击新生成的 `setup.exe`，走一遍安装、开始菜单启动和卸载。试一下托盘、气泡、**Alt + 反引号**和断网后的流派面板。项目当前的安装包面向 Windows 10/11 x64。Windows 7 需要另外适配已结束维护的 Electron 22。 [Electron 的 Windows 兼容性说明](https://www.electronjs.org/blog/windows-7-to-8-1-deprecation-notice)
2. 小范围试用直接发送 `setup.exe`。对外发布时，可以在代码仓库创建对应版本的 GitHub Release，把 EXE 作为附件上传，再分享附件链接。 [GitHub Release 操作说明](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
3. 在下载说明中写清 Windows 版本、x64、安装包大小、主要变更和签名状态。当前本地试用包没有数字签名，Windows 可能显示「未知发布者」。

之后修改程序、皮肤或随包资源时重新打包。只更新由 GitHub 分发的流派数据时，已运行在线取数的客户端可继续拉取数据，更新流程见 [数据说明](./数据说明.md)。
