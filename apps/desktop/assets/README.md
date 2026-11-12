# assets

放打包用的图标与本地图标缓存。

## 气泡 / 托盘图标（当前方案）

素材在 `source/`，由 `scripts/make-bubble-icon.ps1` 合成：

| 文件 | 用途 |
|---|---|
| `source/nina-main.png` | 剧情角色妮娜立绘（wiki，CC BY-NC-SA 4.0） |
| `source/nina-sealed.jpg` | 妮娜（封印）剧情场景（同上） |
| `source/clienticon.ico` | Steam 官方客户端图标（托盘用） |
| `icon.png` | 256×256，气泡中心图形 |
| `icon-64.png` / `icon-32.png` | 中间尺寸 |
| `tray-32.png` / `tray-16.png` | 托盘图标 |
| `_icon-preview.png` / `_tray-preview.png` / `_bubble-preview.png` | 预览（调试用） |

重新生成：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-bubble-icon.ps1
```

## 旧版 key art 裁切（保留参考，不再作为默认）

`icon-art.png` / `icon-half.png` / `icon-face.png` / `icon-full.png` / `icon-raw.png`
由 `scripts/make-icons.ps1` 生成。

## 图标缓存（M2 再做）

正式版会把武器 / 刻印 / 宝藏图标下载到本地，避免依赖 wiki CDN：

```
assets/icons/
  weapons/        thw.png shw.png ...
  inscriptions/   shw_revenge.png ...
  treasures/      不融冰.png ...
```

来源：[失落城堡2中文维基](https://lc2.huijiwiki.com/)（CC BY-NC-SA 4.0，需署名、非商用）。
