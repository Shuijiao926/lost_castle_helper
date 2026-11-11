# 从原始 key art 裁出圆形图标（给气泡 / 任务栏 / 托盘用）
#
# 用法（必须用 Windows PowerShell 5.1，PowerShell 7 的 System.Drawing 转发会编译失败）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#
# 输出到 apps\desktop\assets\：
#   icon-face.png   主角脸部特写（小尺寸气泡最清晰）
#   icon-half.png   主角半身
#   icon-art.png    整幅 key art（当前 icon.png 的来源）
param(
  [string]$Source = '',
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Source) { $Source = Join-Path $root 'apps\desktop\assets\icon-raw.png' }
if (-not $OutDir) { $OutDir = Join-Path $root 'apps\desktop\assets' }

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public class IconCropper {
    public static void MakeCircle(string srcPath, string outPath, int size, int cx, int cy, int cw, int ch) {
        using (Image src = Image.FromFile(srcPath))
        using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingMode = CompositingMode.SourceCopy;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.Clear(Color.Transparent);
                using (GraphicsPath path = new GraphicsPath()) {
                    path.AddEllipse(0, 0, size, size);
                    g.SetClip(path);
                    g.DrawImage(src, new Rectangle(0, 0, size, size), new Rectangle(cx, cy, cw, ch), GraphicsUnit.Pixel);
                }
            }
            bmp.Save(outPath, ImageFormat.Png);
        }
    }
}
'@
Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition $cs -Language CSharp

# 原图 852x500，主角在中间偏右
$presets = @(
    @{ Name = 'icon-art.png';  X = 0;   Y = 0;   W = 500; H = 500 },  # 整幅（基线）
    @{ Name = 'icon-half.png'; X = 285; Y = 150; W = 330; H = 330 },  # 半身
    @{ Name = 'icon-face.png'; X = 355; Y = 195; W = 215; H = 215 }   # 脸部特写
)

foreach ($p in $presets) {
    $out = Join-Path $OutDir $p.Name
    [IconCropper]::MakeCircle($Source, $out, 256, $p.X, $p.Y, $p.W, $p.H)
    Write-Host ("  -> " + $out)
}

Write-Host 'done'
