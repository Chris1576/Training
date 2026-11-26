# Erzeugt alle App-Icons in icons/ (PNG + favicon.ico).
# Aufruf:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "icons"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Color($hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

function RoundRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($r -le 0) { $p.AddRectangle((New-Object System.Drawing.RectangleF $x, $y, $w, $h)); return $p }
  $d = [Math]::Min($r * 2, [Math]::Min($w, $h))
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Zeichnet das Logo im 1024er-Raster. $rounded = abgerundete Kachel mit
# transparentem Rand, sonst randlos (fuer maskable / Apple-Icons).
function Draw-Logo($size, $rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 1024.0
  $g.ScaleTransform($s, $s)

  if ($rounded) { $bg = RoundRect 24 24 976 976 220 }
  else { $bg = RoundRect 0 0 1024 1024 0 }
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF 0, 1024), (Color "#1E2523"), (Color "#0E1110")
  $g.FillPath($grad, $bg)
  if ($rounded) {
    $pen = New-Object System.Drawing.Pen (Color "#2B322E"), 8
    $g.DrawPath($pen, $bg)
  }

  $teal = New-Object System.Drawing.SolidBrush (Color "#4FC8B4")
  $tealDark = New-Object System.Drawing.SolidBrush (Color "#2F8F80")
  $ink = New-Object System.Drawing.SolidBrush (Color "#E8ECE9")

  $cy = 470
  # Stange
  $g.FillPath($ink, (RoundRect 370 ($cy - 20) 284 40 12))
  foreach ($side in @(-1, 1)) {
    # Innere Scheibe, aeussere Scheibe, Endkappe (gespiegelt)
    $inner = if ($side -lt 0) { 312 } else { 1024 - 312 - 66 }
    $outer = if ($side -lt 0) { 232 } else { 1024 - 232 - 66 }
    $cap = if ($side -lt 0) { 190 } else { 1024 - 190 - 46 }
    $g.FillPath($teal, (RoundRect $inner ($cy - 160) 66 320 22))
    $g.FillPath($tealDark, (RoundRect $outer ($cy - 115) 66 230 22))
    $g.FillPath($ink, (RoundRect $cap ($cy - 34) 46 68 14))
  }

  # Pull / Push / Leg
  $cols = @("#4FC8B4", "#E08356", "#8FA0EE")
  for ($i = 0; $i -lt 3; $i++) {
    $b = New-Object System.Drawing.SolidBrush (Color $cols[$i])
    $g.FillPath($b, (RoundRect (338 + $i * 122) 705 104 30 15))
  }

  $g.Dispose()
  return $bmp
}

function Save-Png($bmp, $path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Save-Png (Draw-Logo 512 $true) (Join-Path $out "icon-512.png")
Save-Png (Draw-Logo 192 $true) (Join-Path $out "icon-192.png")
Save-Png (Draw-Logo 32 $true) (Join-Path $out "favicon-32.png")
Save-Png (Draw-Logo 512 $false) (Join-Path $out "icon-maskable-512.png")
Save-Png (Draw-Logo 180 $false) (Join-Path $out "apple-touch-icon.png")

# favicon.ico mit PNG-Eintraegen (Windows Vista+)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$blobs = @()
foreach ($sz in $sizes) {
  $bmp = Draw-Logo $sz $true
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $blobs += , $ms.ToArray()
}
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ico
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$blobs[$i].Length); $w.Write([UInt32]$offset)
  $offset += $blobs[$i].Length
}
foreach ($b in $blobs) { $w.Write($b) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $out "favicon.ico"), $ico.ToArray())

Write-Host "Icons erzeugt in $out"
