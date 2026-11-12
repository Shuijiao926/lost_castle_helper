# Castle Helper - panel background generator
#
# Source: official camp loading background (Armstrong raising a mug, campfire celebration,
#         (c) Hunter Studio; used inside this non-commercial local assistant).
#         Vendored at apps\desktop\assets\source\panel-bg-src.jpg
#
# Output: apps\desktop\assets\panel-bg.jpg  (880x1360, portrait crop for the 440x680 panel)
#
# Usage (Windows PowerShell 5.1; keep the C# block pure ASCII):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-panel-bg.ps1

param(
  [string]$AssetsDir = '',
  [int]$CropX = 520,
  [int]$CropY = 0,
  [int]$CropW = 699,
  [int]$CropH = 1080
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $AssetsDir) { $AssetsDir = Join-Path $root 'apps\desktop\assets' }
$srcPath = Join-Path $AssetsDir 'source\panel-bg-src.png'
if (-not (Test-Path $srcPath)) { throw "missing source: $srcPath" }

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public class PanelBg {
    public static void Make(string srcPath, string outPath, int x, int y, int w, int h, int outW, int outH) {
        using (Image src = Image.FromFile(srcPath))
        using (Bitmap bmp = new Bitmap(outW, outH, PixelFormat.Format24bppRgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                Rectangle dest = new Rectangle(0, 0, outW, outH);
                Rectangle srcRect = new Rectangle(x, y, w, h);
                ImageAttributes ia = new ImageAttributes();
                float c = 1.06f;
                float t = (1f - c) / 2f;
                ColorMatrix cm = new ColorMatrix(new float[][] {
                    new float[] { c * 1.06f, 0, 0, 0, 0 },
                    new float[] { 0, c * 1.02f, 0, 0, 0 },
                    new float[] { 0, 0, c * 1.10f, 0, 0 },
                    new float[] { 0, 0, 0, 1, 0 },
                    new float[] { t - 0.01f, t, t + 0.01f, 0, 1 }
                });
                ia.SetColorMatrix(cm);
                g.DrawImage(src, dest, srcRect.X, srcRect.Y, srcRect.Width, srcRect.Height, GraphicsUnit.Pixel, ia);
                ia.Dispose();
            }
            ImageCodecInfo jpg = null;
            foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders()) {
                if (codec.FormatID == ImageFormat.Jpeg.Guid) { jpg = codec; break; }
            }
            EncoderParameters ep = new EncoderParameters(1);
            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 88L);
            bmp.Save(outPath, jpg, ep);
            ep.Dispose();
        }
    }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies 'System.Drawing' -ErrorAction Stop

$outPath = Join-Path $AssetsDir 'panel-bg.jpg'
[PanelBg]::Make($srcPath, $outPath, $CropX, $CropY, $CropW, $CropH, 880, 1360)
Write-Host "PANEL_BG_OK $outPath"
