param([Parameter(Mandatory)][string]$Version)

$ErrorActionPreference = 'Stop'
$installer = Resolve-Path "release/Ymd-$Version-win-x64.exe"
$process = Start-Process -FilePath $installer -ArgumentList '/S','--updated','--force-run' -PassThru
if (-not $process.WaitForExit(90000) -or $process.ExitCode -ne 0) { throw 'NSIS update did not finish successfully.' }

$installed = Join-Path $env:LOCALAPPDATA 'Programs/Ymd/Ymd.exe'
if (-not (Test-Path $installed)) { throw 'Ymd was not installed.' }
$capabilities = 'Software\Ymd\Capabilities'
$registered = Get-Item 'HKCU:\Software\RegisteredApplications'
$associations = Get-Item "HKCU:\$capabilities\FileAssociations"
$openWith = Get-Item 'HKCU:\Software\Classes\.md\OpenWithProgids'
$command = Get-Item 'HKCU:\Software\Classes\Ymd.Markdown\shell\open\command'
if ($registered.GetValue('Ymd') -ne $capabilities -or $associations.GetValue('.md') -ne 'Ymd.Markdown' -or
    $openWith.GetValueNames() -notcontains 'Ymd.Markdown' -or $command.GetValue('') -ne ('"{0}" "%1"' -f $installed)) {
  throw 'The installer did not register Ymd as a Markdown handler.'
}
function Get-InstalledYmd {
  Get-Process -Name Ymd -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installed }
}
$running = $null
for ($attempt = 0; $attempt -lt 20 -and -not $running; $attempt++) {
  $running = Get-InstalledYmd | Select-Object -First 1
  if (-not $running) { Start-Sleep -Seconds 1 }
}
if (-not $running) { throw 'NSIS did not restart the installed Ymd.' }
Get-InstalledYmd | Stop-Process

Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AppWindow {
  [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr window, IntPtr region);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
  [DllImport("gdi32.dll")] static extern bool PtInRegion(IntPtr region, int x, int y);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr region);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, [Out] int[] rect);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attr, [Out] int[] value, int size);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, int flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(long point);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dc, int dx, int dy, int w, int h,
    IntPtr screen, int sx, int sy, uint operation);

  public static bool CaptureDesktop(IntPtr target, int x, int y, int w, int h) {
    var desktop = GetDC(IntPtr.Zero);
    try { return BitBlt(target, 0, 0, w, h, desktop, x, y, 0x40CC0020); } // SRCCOPY | CAPTUREBLT.
    finally { ReleaseDC(IntPtr.Zero, desktop); }
  }

  public static int[] VisibleFrame(IntPtr window) {
    var frame = new int[4];
    if (DwmGetWindowAttribute(window, 9, frame, 16) != 0) throw new InvalidOperationException("No visible frame");
    return frame;
  }

  public static bool HasRoundedRegion(IntPtr window) {
    if (window == IntPtr.Zero) return false;
    var rect = new int[4];
    if (!GetWindowRect(window, rect)) return false;
    var frame = VisibleFrame(window);
    int x = frame[0] - rect[0], y = frame[1] - rect[1];
    int right = frame[2] - rect[0] - 1, bottom = frame[3] - rect[1] - 1;
    IntPtr region = CreateRectRgn(0, 0, 0, 0);
    try {
      return GetWindowRgn(window, region) > 0 &&
        !PtInRegion(region, x, y) && !PtInRegion(region, right, y) &&
        !PtInRegion(region, x, bottom) && !PtInRegion(region, right, bottom) &&
         PtInRegion(region, (x + right) / 2, (y + bottom) / 2);
    } finally { DeleteObject(region); }
  }
}
'@

$profile = Join-Path $env:RUNNER_TEMP 'ymd-installed-window'
$nativeError = Join-Path $env:RUNNER_TEMP 'ymd-installed-window.stderr'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
Set-Content -Path (Join-Path $profile 'preferences.json') -Value '{"theme":"dark","autoCheckUpdates":false}'
$env:ELECTRON_ENABLE_LOGGING = '1'
$main = Start-Process -FilePath $installed -ArgumentList "--user-data-dir=`"$profile`"" -RedirectStandardError $nativeError -PassThru
try {
  $window = [IntPtr]::Zero
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $main.Refresh()
    if ($main.HasExited) { break }
    if ([AppWindow]::HasRoundedRegion($main.MainWindowHandle)) {
      $window = $main.MainWindowHandle
      break
    }
    Start-Sleep -Seconds 1
  }
  if (!$window) { throw 'The installed app did not cut all four corners at its startup size.' }

  # The DWM desktop capture sees Acrylic and the shadow, including pixels a renderer screenshot omits.
  $back = [Windows.Forms.Form]::new()
  $back.FormBorderStyle = 'None'
  $back.BackColor = [Drawing.Color]::FromArgb(36, 208, 102)
  $back.WindowState = 'Maximized'
  $back.Show()
  try {
    [Windows.Forms.Application]::DoEvents()
    $screen = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $width = [Math]::Min(760, $screen.Width - 70)
    $height = [Math]::Min(600, $screen.Height - 70)
    if (![AppWindow]::SetWindowPos($window, [IntPtr]::new(-1), ($screen.Left + 30), ($screen.Top + 30), $width, $height, 0)) {
      throw 'Could not position the installed window for the desktop capture.'
    }
    Start-Sleep -Milliseconds 900
    $frame = [AppWindow]::VisibleFrame($window)
    $padding = 22
    $image = [Drawing.Bitmap]::new(($frame[2] - $frame[0] + 2 * $padding), ($frame[3] - $frame[1] + 2 * $padding))
    $graphics = [Drawing.Graphics]::FromImage($image)
    try {
      $dc = $graphics.GetHdc()
      try {
        if (![AppWindow]::CaptureDesktop($dc, ($frame[0] - $padding), ($frame[1] - $padding), $image.Width, $image.Height)) {
          throw 'Could not capture the DWM desktop with layered windows.'
        }
      } finally { $graphics.ReleaseHdc($dc) }
      $right = $image.Width - $padding - 1
      $bottom = $image.Height - $padding - 1
      $page = $image.GetPixel(($right - 24), [int]($image.Height / 2))
      if ($page.G - [Math]::Max([int]$page.R, [int]$page.B) -gt 40) {
        throw 'The editor is not visible in front of the test desktop.'
      }
      foreach ($point in @(@($padding, $padding), @($right, $padding), @($padding, $bottom), @($right, $bottom))) {
        $color = $image.GetPixel($point[0], $point[1])
        if ($color.G - [Math]::Max([int]$color.R, [int]$color.B) -lt 40) {
          throw "The desktop is obscured at a visible window corner ($($point -join ','), RGB $($color.R),$($color.G),$($color.B))."
        }
      }
      $side = [int]($image.Height / 2)
      $top = $padding + 95
      foreach ($point in @(@($top, $padding), @($padding, $side), @($top, $bottom))) {
        $color = $image.GetPixel($point[0], $point[1])
        if ([Math]::Min([int]$color.R, [Math]::Min([int]$color.G, [int]$color.B)) -gt 210) {
          throw "A light window frame is visible at ($($point -join ','), RGB $($color.R),$($color.G),$($color.B))."
        }
      }
      $middle = [int]($image.Height / 2)
      $wallpaper = $image.GetPixel(0, $middle)
      $shadow = $image.GetPixel(($padding - 5), $middle)
      if ($wallpaper.G - $shadow.G -lt 12) { throw "The window did not cast a visible shadow (desktop G=$($wallpaper.G), edge G=$($shadow.G))." }
      $point = ([long]([int]($frame[1] + ($frame[3] - $frame[1]) / 2)) -shl 32) -bor ([long]($frame[0] - 5) -band 0xffffffffL)
      if ([AppWindow]::WindowFromPoint($point) -ne $back.Handle) { throw 'The window shadow intercepted pointer hit-testing.' }
      Write-Output 'Verified borderless rounded corners and a click-through shadow on the composited desktop.'
    } catch {
      $image.Save((Join-Path $env:RUNNER_TEMP 'ymd-windows-window.png'), [Drawing.Imaging.ImageFormat]::Png)
      throw
    } finally {
      $graphics.Dispose()
      $image.Dispose()
    }
  } finally { $back.Dispose() }
} catch {
  Write-Output "Installed main PID: $($main.Id). Window handle: $($main.MainWindowHandle)."
  if (Test-Path $nativeError) { Get-Content $nativeError -Tail 30 }
  throw
} finally {
  Get-InstalledYmd | Stop-Process
}
