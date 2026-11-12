# Castle Helper - bubble / tray icon generator (public assets based)
#
# Sources (vendored under apps\desktop\assets\source\, all publicly available):
#   nina-main.png     story character "Nina" main art (Lost Castle 2 wiki / CC BY-NC-SA)
#   nina-sealed.jpg   story cutscene "Nina (sealed)" (same wiki page)
#   clienticon.ico    official Steam client icon (Hunter Studio, used for tray only)
#
# Bubble icon: Nina portrait composited on the sealed-crystal scene (bright, story related).
# Tray icon:   official client icon, brightened - most recognizable at 16px.
#
# Usage (Windows PowerShell 5.1; keep this file pure ASCII):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-bubble-icon.ps1
#
# Output (apps\desktop\assets\):
#   icon.png 256, icon-64.png, icon-32.png   -> bubble center art
#   tray-32.png, tray-16.png                 -> tray icon
#   _icon-preview.png / _tray-preview.png    -> preview sheets

param(
  [string]$AssetsDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $AssetsDir) { $AssetsDir = Join-Path $root 'apps\desktop\assets' }
$srcDir = Join-Path $AssetsDir 'source'
if (-not (Test-Path $srcDir)) { throw "source dir missing: $srcDir" }

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public class CastleIcon {
    const int S = 512;

    static Bitmap CircleMask(Bitmap src) {
        Bitmap outBmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(outBmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using (GraphicsPath p = new GraphicsPath()) {
                p.AddEllipse(1, 1, src.Width - 3, src.Height - 3);
                g.SetClip(p);
                g.DrawImage(src, new Rectangle(0, 0, src.Width, src.Height));
            }
        }
        return outBmp;
    }

    static void Rim(Graphics g, int size, float inset, float width, Color color) {
        using (Pen pen = new Pen(color, width)) {
            pen.Alignment = PenAlignment.Center;
            g.DrawEllipse(pen, inset, inset, size - inset * 2, size - inset * 2);
        }
    }

    /* brighten / saturate a region (used for the pale character art) */
    static void DrawAdjusted(Graphics g, Bitmap img, Rectangle dest, Rectangle srcRect, float gain, float contrast, float sat) {
        ImageAttributes ia = new ImageAttributes();
        float c = contrast;
        float t = (1f - c) / 2f;
        ColorMatrix cm = new ColorMatrix(new float[][] {
            new float[] { c * (0.213f + 0.787f * sat), c * (0.715f - 0.715f * sat), c * (0.072f - 0.072f * sat), 0, 0 },
            new float[] { c * (0.213f - 0.213f * sat), c * (0.715f + 0.285f * sat), c * (0.072f - 0.072f * sat), 0, 0 },
            new float[] { c * (0.213f - 0.213f * sat), c * (0.715f - 0.715f * sat), c * (0.072f + 0.928f * sat), 0, 0 },
            new float[] { 0, 0, 0, 1, 0 },
            new float[] { t + gain, t + gain, t + gain, 0, 1 }
        });
        ia.SetColorMatrix(cm);
        g.DrawImage(img, dest, srcRect.X, srcRect.Y, srcRect.Width, srcRect.Height, GraphicsUnit.Pixel, ia);
        ia.Dispose();
    }

    /* soft radial glow behind the character */
    static void Glow(Graphics g, int size, float cx, float cy, float radius, Color color) {
        using (GraphicsPath p = new GraphicsPath()) {
            p.AddEllipse(cx - radius, cy - radius, radius * 2, radius * 2);
            using (PathGradientBrush pg = new PathGradientBrush(p)) {
                pg.CenterColor = color;
                pg.SurroundColors = new Color[] { Color.FromArgb(0, color.R, color.G, color.B) };
                g.FillPath(pg, p);
            }
        }
    }

    /* -------- bubble art: Nina face on gold-violet disc -------- */
    static Bitmap RenderBubbleMaster(string srcDir) {
        Bitmap bmp = new Bitmap(S, S, PixelFormat.Format32bppArgb);
        using (Bitmap nina = new Bitmap(Image.FromFile(System.IO.Path.Combine(srcDir, "nina-main.png"))))
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.Clear(Color.Transparent);

            /* diagonal gold -> violet disc */
            using (GraphicsPath p = new GraphicsPath()) {
                p.AddEllipse(1, 1, S - 3, S - 3);
                using (LinearGradientBrush lb = new LinearGradientBrush(
                    new RectangleF(0, 0, S, S),
                    Color.FromArgb(255, 0x3A, 0x16, 0x62),
                    Color.FromArgb(255, 0xF0, 0x7A, 0xFF),
                    52f)) {
                    g.FillPath(lb, p);
                }
            }

            /* character face + hair, slightly brighter & more saturated */
            int d = (int)(S * 1.02);
            Rectangle ninaSrc = new Rectangle(250, 45, 310, 310);
            Rectangle ninaDest = new Rectangle((S - d) / 2, (S - d) / 2 + S / 60, d, d);
            DrawAdjusted(g, nina, ninaDest, ninaSrc, 0.07f, 1.14f, 1.10f);

            /* gold rim + inner warm rim */
            Rim(g, S, 4, S * 0.040f, Color.FromArgb(255, 0xFF, 0xE6, 0xA8));
            Rim(g, S, 4 + S * 0.040f, S * 0.013f, Color.FromArgb(190, 0xFF, 0xF8, 0xE0));
        }
        Bitmap masked = CircleMask(bmp);
        bmp.Dispose();
        return masked;
    }

    /* -------- tray art: official client icon, brightened -------- */
    static Bitmap RenderTrayMaster(string srcDir) {
        Bitmap bmp = new Bitmap(S, S, PixelFormat.Format32bppArgb);
        using (Icon raw = new Icon(System.IO.Path.Combine(srcDir, "clienticon.ico"), new Size(S, S)))
        using (Bitmap src = raw.ToBitmap())
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);
            DrawAdjusted(g, src, new Rectangle(0, 0, S, S), new Rectangle(0, 0, src.Width, src.Height), 0.10f, 1.12f, 1.22f);
            Rim(g, S, 3, S * 0.028f, Color.FromArgb(230, 0xFF, 0xD8, 0x7A));
        }
        Bitmap masked = CircleMask(bmp);
        bmp.Dispose();
        return masked;
    }

    static void SaveSize(Bitmap master, string outPath, int size) {
        using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.Clear(Color.Transparent);
                g.DrawImage(master, new Rectangle(0, 0, size, size));
            }
            bmp.Save(outPath, ImageFormat.Png);
        }
    }

    static void SaveSheet(Bitmap master, string outPath, bool darkBackground) {
        int[] sizes = new int[] { 256, 64, 32, 16 };
        int pad = 18;
        int cell = 256 + pad * 2;
        using (Bitmap sheet = new Bitmap(cell * sizes.Length, cell, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(sheet)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                using (SolidBrush bg = new SolidBrush(darkBackground ? Color.FromArgb(255, 0x20, 0x22, 0x2A) : Color.FromArgb(255, 0xF2, 0xF3, 0xF5))) {
                    g.FillRectangle(bg, 0, 0, sheet.Width, sheet.Height);
                }
                for (int i = 0; i < sizes.Length; i++) {
                    int sz = sizes[i];
                    int x = i * cell + (cell - sz) / 2;
                    int y = (cell - sz) / 2;
                    using (Bitmap s = new Bitmap(master, new Size(sz, sz))) g.DrawImage(s, x, y, sz, sz);
                }
            }
            sheet.Save(outPath, ImageFormat.Png);
        }
    }

    public static void Generate(string assetsDir) {
        string srcDir = System.IO.Path.Combine(assetsDir, "source");
        using (Bitmap bubble = RenderBubbleMaster(srcDir))
        using (Bitmap tray = RenderTrayMaster(srcDir)) {
            SaveSize(bubble, System.IO.Path.Combine(assetsDir, "icon.png"), 256);
            SaveSize(bubble, System.IO.Path.Combine(assetsDir, "icon-64.png"), 64);
            SaveSize(bubble, System.IO.Path.Combine(assetsDir, "icon-32.png"), 32);
            SaveSize(tray, System.IO.Path.Combine(assetsDir, "tray-32.png"), 32);
            SaveSize(tray, System.IO.Path.Combine(assetsDir, "tray-16.png"), 16);
            SaveSheet(bubble, System.IO.Path.Combine(assetsDir, "_icon-preview.png"), false);
            SaveSheet(tray, System.IO.Path.Combine(assetsDir, "_tray-preview.png"), true);
        }
    }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies 'System.Drawing' -ErrorAction Stop

[CastleIcon]::Generate($AssetsDir)
Write-Host "ICONS_OK $AssetsDir"
