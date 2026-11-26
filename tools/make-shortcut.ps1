# Legt "Trainingslog"-Verknuepfungen mit Logo an (Projektordner, Desktop, Startmenue).
# Sie oeffnen die App in Edge als eigenes Fenster ohne Adressleiste.
# Aufruf:  powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1

$url = "https://trainingslog-production.up.railway.app"
$root = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $root "icons\favicon.ico"

$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw "Microsoft Edge nicht gefunden." }

$targets = @(
  (Join-Path $root "Trainingslog.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "Trainingslog.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Programs")) "Trainingslog.lnk")
)

$shell = New-Object -ComObject WScript.Shell
function Save-Shortcut($path, $appUrl, $desc) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $edge
  $lnk.Arguments = "--app=$appUrl"
  $lnk.WorkingDirectory = Split-Path -Parent $edge
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = $desc
  $lnk.Save()
  Write-Host "Verknuepfung: $path"
}
foreach ($t in $targets) { Save-Shortcut $t $url "Trainingslog starten" }
