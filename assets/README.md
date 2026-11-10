# assets

放打包用的图标与本地图标缓存。

## 需要的文件

| 文件 | 用途 | 规格 |
|---|---|---|
| `icon.png` | 托盘图标 | 32×32 或 16×16 PNG，带透明通道 |
| `icon.ico` | 安装包/窗口图标 | 多尺寸 ICO（16/32/48/256） |

**缺失时**：主进程会跳过托盘（只在控制台提示），热键仍然可用。
所以 M1 阶段没有图标也能跑。

## 图标缓存（M2 再做）

正式版会把武器 / 刻印 / 宝藏图标下载到本地，避免依赖 wiki CDN：

```
assets/icons/
  weapons/        thw.png shw.png ...
  inscriptions/   shw_revenge.png ...
  treasures/      不融冰.png ...
```

下载脚本计划放在 `tools/fetch_icons.py`，来源：
[失落城堡2中文维基](https://lc2.huijiwiki.com/)（CC BY-NC-SA 4.0，需署名、非商用）。

> 当前 M1 阶段渲染层仍直接引用 wiki CDN 的缩略图，
> 加载失败会自动降级为「稀有度底色 + 名称首字」色块，不会出现裂图。
