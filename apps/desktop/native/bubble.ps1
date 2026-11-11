# 城堡助手 · 原生气泡窗口
# ------------------------------------------------------------------
# Windows 分层窗口（WS_EX_LAYERED + UpdateLayeredWindow）实现，逐像素 alpha 由系统合成。
# 和 uTools 悬浮球同一技术路线：平滑、无白角，不依赖 Chromium 的透明合成。
#
# 三个关键点：
#   1. 进程必须 DPI 感知，否则窗口会被系统二次缩放 → 糊。脚本第一件事就是打开它。
#   2. 光环用「每帧旋转重绘」做动画，不是换图片，所以是真正的旋转光效。
#   3. 逐像素合成 + 超采样抗锯齿，边缘平滑。
#
# 与 Electron 的行协议（stdin/stdout）：
#   PS -> Electron : READY | CLICK | MOVE x,y
#   Electron -> PS : QUIT
#
# 手动调试：
#   powershell -NoProfile -ExecutionPolicy Bypass -File bubble.ps1 -Icon <icon.png> -Size 90
#   powershell ... -File bubble.ps1 -Icon <icon.png> -Size 90 -Preview out.png -GenerateOnly
param(
  [string]$Icon = '',
  [int]$Size = 90,
  [int]$X = 100,
  [int]$Y = 100,
  [string]$Preview = '',
  [switch]$GenerateOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# ---------- 第一步：DPI 感知（必须在任何窗口创建之前） ----------
$dpiCs = @'
using System;
using System.Runtime.InteropServices;
public class DpiAware {
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    public static bool Enable() {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return true; } catch { }
        try { return SetProcessDPIAware(); } catch { }
        return false;
    }
}
'@
Add-Type -TypeDefinition $dpiCs
$dpiOk = [DpiAware]::Enable()
Write-Output ('DPI ' + $dpiOk)   # 供 Electron 日志确认 DPI 感知是否生效

# ---------- 气泡窗口实现（C# 内嵌编译；注释保持 ASCII，避免 GBK 代码页解错） ----------
$cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class Lc2Bubble : Form
{
    /* ---- Win32 ---- */
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct SIZE { public int CX, CY; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BLENDFUNCTION { public byte BlendOp; public byte BlendFlags; public byte SourceConstantAlpha; public byte AlphaFormat; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize,
        IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr h);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr ho);

    private const int WS_EX_LAYERED = 0x80000;
    private const int WS_EX_TOOLWINDOW = 0x80;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const byte AC_SRC_ALPHA = 1;
    private const int ULW_ALPHA = 2;

    private const double IconRatio = 0.44;        // icon diameter = size * 0.88
    private const double RingInnerRatio = 0.412;  // ring inner radius
    private const double RingOuterRatio = 0.492;  // ring outer radius
    private const int SuperSample = 3;

    public static Lc2Bubble Instance;

    private readonly int sizePx;
    private readonly Bitmap iconLayer;
    private readonly Bitmap ringNormal;
    private readonly Bitmap ringHover;
    private IntPtr hBmp = IntPtr.Zero;

    private readonly System.Windows.Forms.Timer timer;
    private float angle;

    private bool dragging;
    private bool moved;
    private Point dragAnchor;
    private Point winAnchor;

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    public Lc2Bubble(int size, int x, int y, string iconPath)
    {
        sizePx = size;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(x, y);
        Size = new Size(size, size);

        iconLayer = BuildIconLayer(iconPath, size);
        ringNormal = BuildRing(size, false);
        ringHover = BuildRing(size, true);

        timer = new System.Windows.Forms.Timer();
        timer.Interval = 33; // about 30fps
        timer.Tick += new EventHandler(OnTick);
    }

    /* ---------------- 图层 ---------------- */

    private static Bitmap BuildIconLayer(string iconPath, int size)
    {
        double r = size * IconRatio;
        int d = (int)Math.Round(r * 2);
        int off = (size - d) / 2;

        Bitmap layer = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(layer))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingMode = CompositingMode.SourceOver;
            g.Clear(Color.Transparent);

            using (Bitmap resized = ResampleBox(iconPath, d))
            {
                g.DrawImage(resized, off, off, d, d);
            }
        }

        Sharpen(layer, 0.85);
        return layer;
    }

    // Area-average (box filter) downscale in premultiplied space.
    // GDI+ bicubic is too soft at 3-4x reduction; this keeps detail crisp and
    // gives clean alpha on the circular edge.
    private static Bitmap ResampleBox(string iconPath, int destSize)
    {
        using (Bitmap src = new Bitmap(iconPath))
        {
            int sw = src.Width, sh = src.Height;
            Rectangle srect = new Rectangle(0, 0, sw, sh);
            BitmapData sd = src.LockBits(srect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int sstride = sd.Stride;
            byte[] sbuf = new byte[Math.Abs(sstride) * sh];
            Marshal.Copy(sd.Scan0, sbuf, 0, sbuf.Length);
            src.UnlockBits(sd);

            Bitmap dst = new Bitmap(destSize, destSize, PixelFormat.Format32bppArgb);
            Rectangle drect = new Rectangle(0, 0, destSize, destSize);
            BitmapData dd = dst.LockBits(drect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            int dstride = dd.Stride;
            byte[] dbuf = new byte[Math.Abs(dstride) * destSize];

            double scale = (double)sw / destSize;

            for (int y = 0; y < destSize; y++)
            {
                double sy0 = y * scale, sy1 = (y + 1) * scale;
                int iy0 = (int)Math.Floor(sy0), iy1 = (int)Math.Ceiling(sy1);

                for (int x = 0; x < destSize; x++)
                {
                    double sx0 = x * scale, sx1 = (x + 1) * scale;
                    int ix0 = (int)Math.Floor(sx0), ix1 = (int)Math.Ceiling(sx1);

                    double asum = 0, rsum = 0, gsum = 0, bsum = 0, wsum = 0;

                    for (int yy = iy0; yy < iy1; yy++)
                    {
                        if (yy < 0 || yy >= sh) continue;
                        double wy = Math.Min(sy1, yy + 1) - Math.Max(sy0, yy);
                        if (wy <= 0) continue;
                        for (int xx = ix0; xx < ix1; xx++)
                        {
                            if (xx < 0 || xx >= sw) continue;
                            double wx = Math.Min(sx1, xx + 1) - Math.Max(sx0, xx);
                            if (wx <= 0) continue;

                            double w = wx * wy;
                            int idx = yy * sstride + xx * 4;
                            double a = sbuf[idx + 3] / 255.0;
                            rsum += sbuf[idx] * a * w;
                            gsum += sbuf[idx + 1] * a * w;
                            bsum += sbuf[idx + 2] * a * w;
                            asum += a * w;
                            wsum += w;
                        }
                    }

                    int o = y * dstride + x * 4;
                    if (asum <= 0.0001 || wsum <= 0)
                    {
                        dbuf[o] = 0; dbuf[o + 1] = 0; dbuf[o + 2] = 0; dbuf[o + 3] = 0;
                    }
                    else
                    {
                        double alpha = asum / wsum;
                        if (alpha > 1) alpha = 1;
                        dbuf[o] = (byte)Math.Min(255, rsum / asum);
                        dbuf[o + 1] = (byte)Math.Min(255, gsum / asum);
                        dbuf[o + 2] = (byte)Math.Min(255, bsum / asum);
                        dbuf[o + 3] = (byte)(alpha * 255);
                    }
                }
            }

            Marshal.Copy(dbuf, 0, dd.Scan0, dbuf.Length);
            dst.UnlockBits(dd);
            return dst;
        }
    }

    // light unsharp mask on straight-alpha pixels: makes the art read crisper at small sizes
    private static void Sharpen(Bitmap bmp, double amount)
    {
        int w = bmp.Width, h = bmp.Height;
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        int len = Math.Abs(stride) * h;
        byte[] src = new byte[len];
        Marshal.Copy(data.Scan0, src, 0, len);
        byte[] dst = new byte[len];
        Array.Copy(src, dst, len);

        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int i = y * stride + x * 4;
                if (src[i + 3] == 0) continue;
                for (int c = 0; c < 3; c++)
                {
                    int sum = 0, n = 0;
                    for (int dy = -1; dy <= 1; dy++)
                    {
                        int yy = y + dy;
                        if (yy < 0 || yy >= h) continue;
                        for (int dx = -1; dx <= 1; dx++)
                        {
                            int xx = x + dx;
                            if (xx < 0 || xx >= w) continue;
                            int j = yy * stride + xx * 4;
                            if (src[j + 3] == 0) continue;
                            sum += src[j + c];
                            n++;
                        }
                    }
                    if (n == 0) continue;
                    double blurred = (double)sum / n;
                    double v = src[i + c] + amount * (src[i + c] - blurred);
                    if (v < 0) v = 0;
                    if (v > 255) v = 255;
                    dst[i + c] = (byte)v;
                }
            }
        }

        Marshal.Copy(dst, 0, data.Scan0, len);
        bmp.UnlockBits(data);
    }

    // per-pixel ring with 3x3 supersampling
    private static Bitmap BuildRing(int size, bool hover)
    {
        Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        Rectangle rect = new Rectangle(0, 0, size, size);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        int len = Math.Abs(data.Stride) * size;
        byte[] buf = new byte[len];
        int stride = data.Stride;

        double cx = size / 2.0;
        double cy = size / 2.0;
        double rIn = size * RingInnerRatio;
        double rOut = size * RingOuterRatio;
        double v = hover ? 0.78 : 0.62;
        double sat = hover ? 0.95 : 0.90;
        int samples = SuperSample * SuperSample;

        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                double covSum = 0, rSum = 0, gSum = 0, bSum = 0;
                for (int sy = 0; sy < SuperSample; sy++)
                {
                    for (int sx = 0; sx < SuperSample; sx++)
                    {
                        double px = x + (sx + 0.5) / SuperSample;
                        double py = y + (sy + 0.5) / SuperSample;
                        double dx = px - cx, dy = py - cy;
                        double dist = Math.Sqrt(dx * dx + dy * dy);

                        double cov = RingCoverage(dist, rIn, rOut);
                        if (cov <= 0) continue;

                        double ang = Math.Atan2(dy, dx) * 180.0 / Math.PI;
                        if (ang < 0) ang += 360;
                        double hue = ang / 360.0 * 320.0;
                        double rr, gg, bb;
                        HsvToRgb(hue, sat, v, out rr, out gg, out bb);

                        double edgeDist = Math.Abs(dist - rOut);
                        if (edgeDist < 1.2)
                        {
                            double k = 0.55 * (1 - edgeDist / 1.2);
                            rr = rr * (1 - k) + 8 * k;
                            gg = gg * (1 - k) + 10 * k;
                            bb = bb * (1 - k) + 16 * k;
                        }

                        rSum += rr * cov;
                        gSum += gg * cov;
                        bSum += bb * cov;
                        covSum += cov;
                    }
                }

                int idx = y * stride + x * 4;
                if (covSum <= 0.0001)
                {
                    buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 0;
                }
                else
                {
                    buf[idx] = (byte)Math.Min(255, rSum / covSum);
                    buf[idx + 1] = (byte)Math.Min(255, gSum / covSum);
                    buf[idx + 2] = (byte)Math.Min(255, bSum / covSum);
                    buf[idx + 3] = (byte)Math.Min(255, 255.0 * covSum / samples);
                }
            }
        }

        Marshal.Copy(buf, 0, data.Scan0, len);
        bmp.UnlockBits(data);
        return bmp;
    }

    private static double RingCoverage(double dist, double rIn, double rOut)
    {
        double c1 = SmoothStep(dist, rIn - 0.6, rIn + 0.6);
        double c2 = 1.0 - SmoothStep(dist, rOut - 1.0, rOut);
        double c = Math.Min(c1, c2);
        if (c < 0) c = 0;
        if (c > 1) c = 1;
        return c;
    }

    private static double SmoothStep(double x, double e0, double e1)
    {
        if (e1 <= e0) return x >= e1 ? 1 : 0;
        double t = (x - e0) / (e1 - e0);
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        return t * t * (3 - 2 * t);
    }

    private static void HsvToRgb(double h, double s, double v, out double r, out double g, out double b)
    {
        h = ((h % 360) + 360) % 360;
        double c = v * s;
        double x = c * (1 - Math.Abs((h / 60.0) % 2 - 1));
        double m = v - c;
        double rr = 0, gg = 0, bb = 0;
        if (h < 60) { rr = c; gg = x; }
        else if (h < 120) { rr = x; gg = c; }
        else if (h < 180) { gg = c; bb = x; }
        else if (h < 240) { gg = x; bb = c; }
        else if (h < 300) { rr = x; bb = c; }
        else { rr = c; bb = x; }
        r = (rr + m) * 255; g = (gg + m) * 255; b = (bb + m) * 255;
    }

    /* ---------------- compose and push to screen ---------------- */

    private const int FrameSS = 2; // full-frame supersampling factor

    private void Compose(float deg, bool hover)
    {
        int big = sizePx * FrameSS;

        using (Bitmap hi = new Bitmap(big, big, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(hi))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.Clear(Color.Transparent);

                float cx = big / 2f, cy = big / 2f;
                g.TranslateTransform(cx, cy);
                g.RotateTransform(deg);
                g.TranslateTransform(-cx, -cy);
                g.DrawImage(hover ? ringHover : ringNormal, 0, 0, big, big);
                g.ResetTransform();

                g.DrawImage(iconLayer, 0, 0, big, big);
            }

            using (Bitmap frame = new Bitmap(sizePx, sizePx, PixelFormat.Format32bppArgb))
            {
                using (Graphics g2 = Graphics.FromImage(frame))
                {
                    g2.SmoothingMode = SmoothingMode.AntiAlias;
                    g2.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g2.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g2.CompositingQuality = CompositingQuality.HighQuality;
                    g2.Clear(Color.Transparent);
                    g2.DrawImage(hi, 0, 0, sizePx, sizePx);
                }

                IntPtr hb = ToPremultipliedHBitmap(frame);
                ApplyBitmap(hb);
                if (hBmp != IntPtr.Zero) { try { DeleteObject(hBmp); } catch { } }
                hBmp = hb;
            }
        }
    }

    private static IntPtr ToPremultipliedHBitmap(Bitmap bmp)
    {
        int w = bmp.Width, h = bmp.Height;
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int len = Math.Abs(data.Stride) * h;
        byte[] buf = new byte[len];
        Marshal.Copy(data.Scan0, buf, 0, len);
        for (int i = 0; i < len; i += 4)
        {
            int a = buf[i + 3];
            if (a == 0) { buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; }
            else if (a < 255)
            {
                buf[i] = (byte)((buf[i] * a) / 255);
                buf[i + 1] = (byte)((buf[i + 1] * a) / 255);
                buf[i + 2] = (byte)((buf[i + 2] * a) / 255);
            }
        }
        Marshal.Copy(buf, 0, data.Scan0, len);
        bmp.UnlockBits(data);
        return bmp.GetHbitmap(Color.FromArgb(0));
    }

    private void ApplyBitmap(IntPtr hBitmap)
    {
        if (hBitmap == IntPtr.Zero || !IsHandleCreated) return;
        IntPtr screenDc = GetDC(IntPtr.Zero);
        IntPtr memDc = CreateCompatibleDC(screenDc);
        IntPtr old = SelectObject(memDc, hBitmap);

        SIZE size = new SIZE(); size.CX = Width; size.CY = Height;
        POINT srcPos = new POINT(); srcPos.X = 0; srcPos.Y = 0;
        POINT topPos = new POINT(); topPos.X = Left; topPos.Y = Top;
        BLENDFUNCTION blend = new BLENDFUNCTION();
        blend.BlendOp = 0; blend.BlendFlags = 0;
        blend.SourceConstantAlpha = 255; blend.AlphaFormat = AC_SRC_ALPHA;

        UpdateLayeredWindow(Handle, screenDc, ref topPos, ref size, memDc, ref srcPos, 0, ref blend, ULW_ALPHA);

        SelectObject(memDc, old);
        DeleteDC(memDc);
        ReleaseDC(IntPtr.Zero, screenDc);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Compose(0f, false);
        Console.WriteLine("READY");
        Console.Out.Flush();
    }

    /* ---------------- hover animation ---------------- */

    private void OnTick(object sender, EventArgs e)
    {
        angle += 7f;
        if (angle >= 360f) angle -= 360f;
        Compose(angle, true);
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        base.OnMouseEnter(e);
        angle = 0f;
        Compose(angle, true);
        timer.Start();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        timer.Stop();
        angle = 0f;
        Compose(0f, false);
    }

    /* ---------------- drag / click ---------------- */

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        dragging = true;
        moved = false;
        dragAnchor = Cursor.Position;
        winAnchor = Location;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!dragging) return;
        Point p = Cursor.Position;
        int dx = p.X - dragAnchor.X;
        int dy = p.Y - dragAnchor.Y;
        if (Math.Abs(dx) + Math.Abs(dy) > 3) moved = true;
        if (moved) Location = new Point(winAnchor.X + dx, winAnchor.Y + dy);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (!dragging) return;
        dragging = false;
        if (moved)
        {
            Console.WriteLine("MOVE " + Left + "," + Top);
        }
        else
        {
            Console.WriteLine("CLICK");
        }
        Console.Out.Flush();
    }

    /* ---------------- lifetime ---------------- */

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try { timer.Stop(); timer.Dispose(); } catch { }
        if (hBmp != IntPtr.Zero) { try { DeleteObject(hBmp); } catch { } hBmp = IntPtr.Zero; }
        if (ringNormal != null) ringNormal.Dispose();
        if (ringHover != null) ringHover.Dispose();
        if (iconLayer != null) iconLayer.Dispose();
        base.OnFormClosed(e);
    }

    /* ---------------- entry ---------------- */

    public static void Run(string iconPath, int size, int x, int y)
    {
        Application.EnableVisualStyles();
        Instance = new Lc2Bubble(size, x, y, iconPath);

        Thread t = new Thread(delegate()
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (line == "QUIT")
                {
                    try { Instance.BeginInvoke(new MethodInvoker(delegate() { Instance.Close(); })); }
                    catch { }
                    break;
                }
            }
        });
        t.IsBackground = true;
        t.Start();

        Application.Run(Instance);
    }

    /// Preview: render one frame to PNG (debug / docs only)
    public static void Preview(string iconPath, string outPath, int size)
    {
        using (Bitmap icon = BuildIconLayer(iconPath, size))
        using (Bitmap ring = BuildRing(size, false))
        using (Bitmap frame = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(frame))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                g.DrawImage(ring, 0, 0, size, size);
                g.DrawImage(icon, 0, 0, size, size);
            }
            frame.Save(outPath, ImageFormat.Png);
        }
    }
}
'@

Add-Type -ReferencedAssemblies 'System.Drawing', 'System.Windows.Forms' -TypeDefinition $cs -Language CSharp

if ($GenerateOnly) {
  if (-not $Icon) { throw '-Icon is required when -GenerateOnly is used' }
  if (-not $Preview) { throw '-Preview <path> is required when -GenerateOnly is used' }
  [Lc2Bubble]::Preview($Icon, $Preview, $Size)
  Write-Host ('PREVIEW_OK ' + $Preview)
  exit 0
}

if (-not $Icon) { throw '-Icon is required' }
[Lc2Bubble]::Run($Icon, $Size, $X, $Y)
