param(
  [string]$PngPath = (Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\icons\icon.png'),
  [string]$IcoPath = (Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\icons\icon.ico')
)

Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 8, 18, 38))

$cyan = [System.Drawing.Color]::FromArgb(255, 56, 214, 255)
$blue = [System.Drawing.Color]::FromArgb(255, 27, 102, 255)
$white = [System.Drawing.Color]::FromArgb(255, 242, 250, 255)

$eyePath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$eyePath.AddBezier(28, 128, 72, 58, 184, 58, 228, 128)
$eyePath.AddBezier(228, 128, 184, 198, 72, 198, 28, 128)
$eyePath.CloseFigure()

$eyeBrush = [System.Drawing.SolidBrush]::new($white)
$outlinePen = [System.Drawing.Pen]::new($cyan, 10)
$graphics.FillPath($eyeBrush, $eyePath)
$graphics.DrawPath($outlinePen, $eyePath)

$irisBrush = [System.Drawing.SolidBrush]::new($blue)
$pupilBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 5, 20, 48))
$highlightBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$graphics.FillEllipse($irisBrush, 78, 78, 100, 100)
$graphics.FillEllipse($pupilBrush, 103, 103, 50, 50)
$graphics.FillEllipse($highlightBrush, 116, 108, 16, 16)

$memory = [System.IO.MemoryStream]::new()
$bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $memory.ToArray()

$pngParent = Split-Path -Parent $PngPath
$icoParent = Split-Path -Parent $IcoPath
[System.IO.Directory]::CreateDirectory($pngParent) | Out-Null
[System.IO.Directory]::CreateDirectory($icoParent) | Out-Null
[System.IO.File]::WriteAllBytes($PngPath, $pngBytes)

$icoStream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($icoStream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([uint16]1)
$writer.Write([uint16]32)
$writer.Write([uint32]$pngBytes.Length)
$writer.Write([uint32]22)
$writer.Write($pngBytes)
$writer.Flush()
[System.IO.File]::WriteAllBytes($IcoPath, $icoStream.ToArray())

$writer.Dispose()
$icoStream.Dispose()
$memory.Dispose()
$highlightBrush.Dispose()
$pupilBrush.Dispose()
$irisBrush.Dispose()
$outlinePen.Dispose()
$eyeBrush.Dispose()
$eyePath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Generated $PngPath and $IcoPath"
