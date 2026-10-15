# Проверка дали компютърът може да разпознава говор локално на живо (Whisper).
# Показва само процесора, паметта и видеокартата. Не събира имена, файлове или лични данни.
# Резултатът се копира и в клипборда, за да го поставите в чата.
#
# Стартиране: десен бутон върху файла, после „Run with PowerShell“.
# Или:  powershell -NoProfile -ExecutionPolicy Bypass -File tools/hardware-check.ps1

$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$os = (Get-CimInstance Win32_OperatingSystem).Caption

# Win32_VideoController отчита най-много 4 GB, затова видео паметта се чете от регистъра.
$gpuKeys = Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}" -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -match '^\d{4}$' }
$gpus = foreach ($key in $gpuKeys) {
  $props = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
  if (-not $props.DriverDesc) { continue }
  $bytes = $props.'HardwareInformation.qwMemorySize'
  if ($null -eq $bytes) { $bytes = $props.'HardwareInformation.MemorySize' }
  if ($bytes -is [byte[]]) { $bytes = [BitConverter]::ToUInt32($bytes, 0) }
  $vram = if ($bytes) { "{0} GB" -f [math]::Round([double]$bytes / 1GB, 1) } else { "?" }
  "  - $($props.DriverDesc) (видео памет: $vram)"
}

$report = @"
Zara Copilot: проверка на хардуера
Процесор:    $($cpu.Name.Trim())
Ядра/нишки:  $($cpu.NumberOfCores) / $($cpu.NumberOfLogicalProcessors)
RAM:         $ramGb GB
Система:     $os
Видеокарти:
$($gpus -join "`n")
"@

$report
try { Set-Clipboard -Value $report; "`n(Копирано в клипборда)" } catch { }
if ($Host.Name -eq "ConsoleHost") { Read-Host "`nНатиснете Enter за изход" | Out-Null }
