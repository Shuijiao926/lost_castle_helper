# 城堡助手 · 面板阴影窗口（原生分层窗口）
# ------------------------------------------------------------------
# 目的：Electron 的透明窗口在部分机器上会失效（留白显示成浅灰框），
#       所以"面板外侧的柔和阴影"改由这个原生分层窗口来画：
#       它是一张带 alpha 的位图，逐像素阴影由系统合成，不依赖 Chromium 透明。
#
# 由 Electron 主进程拉起，通过 stdin/stdout 行协议通信：
#   PS -> Electron : READY
#   Electron -> PS : SHOW x,y | MOVE x,y | ALPHA 0-255 | QUIT
#
# 用法（一般由 Electron 调用）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File shadow.ps1 `
#       -PanelW 440 -PanelH 680 -Radius 16 -Pad 24 -Scale 1
param(
  [int]$PanelW = 440,
  [int]$PanelH = 680,
  [int]$Radius = 16,
  [int]$Pad = 24,
  [double]$Scale = 1,
  [int]$ParentPid = 0,
  [string]$Preview = '',
  [switch]$GenerateOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# ---------- DPI 感知（先于任何窗口创建） ----------
$dpiCs = @'
using System;
using System.Runtime.InteropServices;
public class ShadowDpi {
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
$null = [ShadowDpi]::Enable()

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class PanelShadow : Form
{
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
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
    [DllImport("dwmapi.dll", EntryPoint = "DwmSetWindowAttribute")]
    private static extern int DwmSetCorner(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmSetWindowAttribute")]
    private static extern int DwmSetColor(IntPtr hwnd, int attr, ref uint value, int size);

    private const int WS_EX_LAYERED = 0x80000;
    private const int WS_EX_TOOLWINDOW = 0x80;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TRANSPARENT = 0x20;
    private const byte AC_SRC_ALPHA = 1;
    private const int ULW_ALPHA = 2;

    public static PanelShadow Instance;
    private IntPtr hBmp = IntPtr.Zero;
    private byte globalAlpha = 255;
    private static int sW, sH, sPad, sRadius;
    private static bool sFill = false;
    private static volatile bool dragStop = false;
    private static Thread dragThread = null;

    /* drag stream: pointer capture breaks on non-focusable windows, poll cursor natively */
    private static void StartDragStream()
    {
        if (dragThread != null && dragThread.IsAlive) return;
        dragStop = false;
        dragThread = new Thread(delegate()
        {
            int lastX = int.MinValue, lastY = int.MinValue;
            bool wasDown = false;
            DateTime started = DateTime.UtcNow;
            while (!dragStop)
            {
                Thread.Sleep(8);
                bool down = (GetAsyncKeyState(0x01) & 0x8000) != 0;
                if (!down)
                {
                    if (wasDown) { Console.WriteLine("DRAGEND"); Console.Out.Flush(); break; }
                    // not pressed yet: wait up to 1s for the user's mousedown
                    if ((DateTime.UtcNow - started).TotalSeconds > 1.0) break;
                    continue;
                }
                wasDown = true;
                POINT pt;
                if (GetCursorPos(out pt) && (pt.X != lastX || pt.Y != lastY))
                {
                    lastX = pt.X; lastY = pt.Y;
                    Console.WriteLine("DRAG " + pt.X + "," + pt.Y);
                    Console.Out.Flush();
                }
            }
            dragThread = null;
        });
        dragThread.IsBackground = true;
        dragThread.Start();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            // click-through: the shadow must never eat mouse events
            cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT;
            return cp;
        }
    }

    public PanelShadow(int w, int h)
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-32000, -32000);
        Size = new Size(w, h);
    }

    /* ---- per-pixel shadow: gaussian falloff outside a rounded rect ---- */
    private static Bitmap BuildShadowBitmap(int w, int h, int pad, int radius, bool fill)
    {
        Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        byte[] buf = new byte[Math.Abs(data.Stride) * h];
        int stride = data.Stride;

        // shadow params:
        //   sigma = softness, offsetY = slight downward shift (more natural),
        //   edge fade keeps alpha at 0 before the bitmap border (no hard rectangle cut).
        double sigma = Math.Max(2.5, pad * 0.42);
        double offsetY = pad * 0.16;
        double peak = 0.52;                       // shadow peak alpha
        double cx = pad + (w - 2 * pad) / 2.0;
        double cy = pad + (h - 2 * pad) / 2.0;
        double halfW = (w - 2 * pad) / 2.0;
        double halfH = (h - 2 * pad) / 2.0;
        double r = Math.Min(radius, Math.Min(halfW, halfH));
        double edgeFadeBand = Math.Max(4.0, pad * 0.55);

        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                double px = x + 0.5 - cx;
                double py = y + 0.5 - (cy - offsetY);   // move rect up -> shadow goes down

                // signed distance to the rounded rect (positive = outside)
                double qx = Math.Abs(px) - (halfW - r);
                double qy = Math.Abs(py) - (halfH - r);
                double ax = Math.Max(qx, 0), ay = Math.Max(qy, 0);
                double outside = Math.Sqrt(ax * ax + ay * ay) + Math.Min(Math.Max(qx, qy), 0) - r;

                double shadowAlpha = 0;
                if (outside > 0)
                {
                    double t = outside / sigma;
                    shadowAlpha = Math.Exp(-0.5 * t * t) * peak;   // gaussian falloff
                }

                // distance to bitmap border -> force fade to 0 near the edge
                double edgeDist = Math.Min(Math.Min(x + 0.5, w - x - 0.5), Math.Min(y + 0.5, h - y - 0.5));
                if (edgeDist < edgeFadeBand)
                {
                    double u = edgeDist / edgeFadeBand;
                    shadowAlpha *= u * u * (3 - 2 * u);       // smoothstep
                }

                // fill = true: opaque panel color inside the rounded rect (Win10 fallback, covers setShape jaggies)
                double fillAlpha = 0;
                if (fill)
                {
                    if (outside < 0) fillAlpha = 1;
                    else if (outside < 1.0) fillAlpha = 1.0 - outside;
                }

                if (shadowAlpha < 0.004) shadowAlpha = 0;

                double outA = Math.Max(fillAlpha, shadowAlpha);
                int idx = y * stride + x * 4;
                if (outA <= 0)
                {
                    buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 0;
                }
                else if (fillAlpha >= shadowAlpha)
                {
                    buf[idx] = 21;
                    buf[idx + 1] = 22;
                    buf[idx + 2] = 28;
                    buf[idx + 3] = (byte)Math.Min(255, Math.Round(255 * fillAlpha));
                }
                else
                {
                    buf[idx] = 0;
                    buf[idx + 1] = 0;
                    buf[idx + 2] = 0;
                    buf[idx + 3] = (byte)Math.Min(255, Math.Round(255 * shadowAlpha));
                }
            }
        }

        Marshal.Copy(buf, 0, data.Scan0, buf.Length);
        bmp.UnlockBits(data);
        return bmp;
    }

    private void Apply(int x, int y)
    {
        if (!IsHandleCreated) return;
        IntPtr screenDc = GetDC(IntPtr.Zero);
        IntPtr memDc = CreateCompatibleDC(screenDc);
        IntPtr old = SelectObject(memDc, hBmp);

        SIZE size = new SIZE(); size.CX = Width; size.CY = Height;
        POINT srcPos = new POINT();
        POINT topPos = new POINT(); topPos.X = x; topPos.Y = y;
        BLENDFUNCTION blend = new BLENDFUNCTION();
        blend.BlendOp = 0; blend.BlendFlags = 0;
        blend.SourceConstantAlpha = globalAlpha; blend.AlphaFormat = AC_SRC_ALPHA;

        UpdateLayeredWindow(Handle, screenDc, ref topPos, ref size, memDc, ref srcPos, 0, ref blend, ULW_ALPHA);

        SelectObject(memDc, old);
        DeleteDC(memDc);
        ReleaseDC(IntPtr.Zero, screenDc);
    }

    /* ---- public actions ---- */
    public static void ShowAt(int x, int y)
    {
        Instance.Apply(x, y);
    }

    public static void MoveTo(int x, int y)
    {
        Instance.Location = new Point(x, y);
        Instance.Apply(x, y);
    }

    public static void SetAlpha(int a)
    {
        if (a < 0) a = 0;
        if (a > 255) a = 255;
        Instance.globalAlpha = (byte)a;
        Instance.Apply(Instance.Left, Instance.Top);
    }

    public static void HideShadow()
    {
        Instance.Location = new Point(-32000, -32000);
        Instance.Apply(-32000, -32000);
    }

    private static IntPtr ToHBitmap(Bitmap bmp)
    {
        IntPtr hb = bmp.GetHbitmap(Color.FromArgb(0));
        return hb;
    }

    /* ---- system rounded corners (Windows 11 DWM) ---- */
    public static bool ApplyRoundedCorners(IntPtr hwnd, int cornerPref)
    {
        if (hwnd == IntPtr.Zero) return false;
        try
        {
            int pref = cornerPref;              // DWMWCP_ROUND=2 / DWMWCP_DONOTROUND=1
            int hr = DwmSetCorner(hwnd, 33, ref pref, 4);
            // subtle dark border (COLORREF = 0x00BBGGRR -> rgb(43,48,56))
            // darker than system white border, matches the dark panel
            uint borderColor = 0x0038302B;
            DwmSetColor(hwnd, 34, ref borderColor, 4);
            return hr == 0;
        }
        catch { return false; }
    }

    /* ---- preview (debug only) ---- */
    public static void Preview(string outPath, int w, int h, int pad, int radius)
    {
        using (Bitmap bmp = BuildShadowBitmap(w, h, pad, radius, false))
        {
            bmp.Save(outPath, ImageFormat.Png);
        }
    }

    /* ---- entry ---- */
    private static void Rebuild()
    {
        if (Instance == null) return;
        if (Instance.hBmp != IntPtr.Zero) { try { DeleteObject(Instance.hBmp); } catch { } }
        using (Bitmap bmp = BuildShadowBitmap(sW, sH, sPad, sRadius, sFill))
        {
            Instance.hBmp = ToHBitmap(bmp);
        }
        Instance.Apply(Instance.Left, Instance.Top);
    }

    public static void Run(int w, int h, int pad, int radius, int x, int y, int parentPid)
    {
        Application.EnableVisualStyles();
        sW = w; sH = h; sPad = pad; sRadius = radius; sFill = false;
        Instance = new PanelShadow(w, h);
        Instance.Show();

        IntPtr handle = Instance.Handle;          // force handle creation
        using (Bitmap shadowBmp = BuildShadowBitmap(w, h, pad, radius, false))
        {
            Instance.hBmp = ToHBitmap(shadowBmp);
        }
        Instance.Apply(x, y);

        /* watchdog: close when the Electron parent is gone */
        if (parentPid > 0)
        {
            Thread watchdogThread = new Thread(delegate()
            {
                while (true)
                {
                    Thread.Sleep(1000);
                    bool alive = false;
                    try { alive = !System.Diagnostics.Process.GetProcessById(parentPid).HasExited; }
                    catch { alive = false; }
                    if (!alive)
                    {
                        try { Instance.BeginInvoke(new MethodInvoker(delegate() { Instance.Close(); })); }
                        catch { }
                        return;
                    }
                }
            });
            watchdogThread.IsBackground = true;
            watchdogThread.Start();
        }


        if (parentPid > 0)
        {
            // watchdog: close this window if the Electron parent dies (prevents orphan shadows)
            Thread watchdogThread = new Thread(delegate()
            {
                while (true)
                {
                    Thread.Sleep(1000);
                    bool alive = false;
                    try { alive = !System.Diagnostics.Process.GetProcessById(parentPid).HasExited; }
                    catch { alive = false; }
                    if (!alive)
                    {
                        try { Instance.BeginInvoke(new MethodInvoker(delegate() { Instance.Close(); })); }
                        catch { }
                        return;
                    }
                }
            });
            watchdogThread.IsBackground = true;
            watchdogThread.Start();
        }

        Thread t = new Thread(delegate()
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                try
                {
                    if (line == "QUIT") break;
                    if (line.StartsWith("SHOW "))
                    {
                        string[] p = line.Substring(5).Split(',');
                        ShowAt(int.Parse(p[0]), int.Parse(p[1]));
                    }
                    else if (line.StartsWith("MOVE "))
                    {
                        string[] p = line.Substring(5).Split(',');
                        MoveTo(int.Parse(p[0]), int.Parse(p[1]));
                    }
                    else if (line.StartsWith("ALPHA "))
                    {
                        SetAlpha(int.Parse(line.Substring(6)));
                    }
                    else if (line == "HIDE")
                    {
                        HideShadow();
                    }
                    else if (line == "DRAGSTART")
                    {
                        StartDragStream();
                    }
                    else if (line == "DRAGSTOP")
                    {
                        dragStop = true;
                    }
                    else if (line == "FILL 1")
                    {
                        sFill = true;
                        Rebuild();
                    }
                    else if (line == "FILL 0")
                    {
                        sFill = false;
                        Rebuild();
                    }
                    else if (line.StartsWith("HWND "))
                    {
                        string[] parts = line.Split(' ');
                        long hwndValue = long.Parse(parts[1]);
                        int pref = 2;   // default ROUND
                        if (parts.Length > 2) { try { pref = int.Parse(parts[2]); } catch { } }
                        bool ok = ApplyRoundedCorners(new IntPtr(hwndValue), pref);
                        Console.WriteLine(ok ? "DWM ok" : "DWM fail");
                        Console.Out.Flush();
                    }
                }
                catch { }
            }
            try
            {
                Instance.BeginInvoke(new MethodInvoker(delegate() { Instance.Close(); }));
            }
            catch { }
        });
        t.IsBackground = true;
        t.Start();

        // global left-click polling: the overlay never gets focus, so poll the native state
        Thread clickThread = new Thread(delegate()
        {
            bool prevDown = false;
            while (true)
            {
                Thread.Sleep(60);
                short state = GetAsyncKeyState(0x01);   // VK_LBUTTON
                bool down = (state & 0x8000) != 0;
                if (down && !prevDown)
                {
                    POINT pt;
                    if (GetCursorPos(out pt))
                    {
                        Console.WriteLine("CLICK " + pt.X + "," + pt.Y);
                        Console.Out.Flush();
                    }
                }
                prevDown = down;
            }
        });
        clickThread.IsBackground = true;
        clickThread.Start();

        Console.WriteLine("READY");
        Console.Out.Flush();

        Application.Run(Instance);
    }
}
'@

Add-Type -ReferencedAssemblies 'System.Drawing', 'System.Windows.Forms' -TypeDefinition $cs -Language CSharp

$w = [int][Math]::Round(($PanelW + 2 * $Pad) * $Scale)
$h = [int][Math]::Round(($PanelH + 2 * $Pad) * $Scale)
$padPx = [int][Math]::Round($Pad * $Scale)
$radiusPx = [int][Math]::Round($Radius * $Scale)
$padPx = [Math]::Max(2, $padPx)

if ($GenerateOnly) {
  if (-not $Preview) { throw '-Preview <path> is required when -GenerateOnly is used' }
  [PanelShadow]::Preview($Preview, $w, $h, $padPx, $radiusPx)
  Write-Host ('PREVIEW_OK ' + $Preview)
  exit 0
}

[PanelShadow]::Run($w, $h, $padPx, $radiusPx, -32000, -32000, $ParentPid)
