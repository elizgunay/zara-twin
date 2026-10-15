# Проверка дали компютърът може да разпознава говор локално на живо (Whisper).
# Показва само процесора, паметта и видеокартата. Не събира имена, файлове или лични данни.
# Резултатът се копира и в клипборда, за да го поставите в чата.
#
# Стартиране: двоен клик върху hardware-check.cmd (препоръчително).
# Или:  powershell -NoProfile -ExecutionPolicy Bypass -File hardware-check.ps1
#
# Всяка проверка е отделно: ако една не успее на даден компютър, останалите пак се показват.

function Try-Get([scriptblock]$read, [string]$fallback = "не е открито") {
  try {
    $value = & $read
    if ($null -eq $value -or "$value".Trim() -eq "") { return $fallback }
    return $value
  } catch {
    return "$fallback ($($_.Exception.Message))"
  }
}

$cpuName = Try-Get { (Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1).Name.Trim() }
$cores = Try-Get { $c = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1; "$($c.NumberOfCores) / $($c.NumberOfLogicalProcessors)" }
$ram = Try-Get { "{0} GB" -f [math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB, 1) }
$os = Try-Get { (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption }

# Win32_VideoController отчита най-много 4 GB, затова видео паметта се чете от регистъра.
$gpus = Try-Get {
  # Някои подключове (напр. „Properties“) са забранени за четене: пропускаме ги, без грешка.
  $keys = Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}" -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -match '^\d{4}$' }
  $lines = foreach ($key in $keys) {
    $props = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
    if (-not $props.DriverDesc) { continue }
    $bytes = $props.'HardwareInformation.qwMemorySize'
    if ($null -eq $bytes) { $bytes = $props.'HardwareInformation.MemorySize' }
    if ($bytes -is [byte[]]) { $bytes = [BitConverter]::ToUInt32($bytes, 0) }
    $vram = if ($bytes) { "{0} GB" -f [math]::Round([double]$bytes / 1GB, 1) } else { "?" }
    "  - $($props.DriverDesc) (видео памет: $vram)"
  }
  if (-not $lines) {
    # Резервен вариант без регистъра.
    $lines = Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object { "  - $($_.Name)" }
  }
  $lines -join "`n"
}

$report = @"
Zara Copilot: проверка на хардуера
Процесор:    $cpuName
Ядра/нишки:  $cores
RAM:         $ram
Система:     $os
Видеокарти:
$gpus
"@

Write-Host $report
try {
  Set-Clipboard -Value $report -ErrorAction Stop
  Write-Host "`n(Копирано в клипборда. Поставете го в чата с Ctrl+V.)" -ForegroundColor Green
} catch {
  Write-Host "`n(Не успях да копирам. Маркирайте текста по-горе с мишката и го копирайте.)" -ForegroundColor Yellow
}

# При „Run with PowerShell“ прозорецът се затваря веднага. .cmd файлът сам чака, затова тук не.
if ($env:ZARA_NO_PAUSE -ne "1" -and $Host.Name -eq "ConsoleHost") {
  Read-Host "`nНатиснете Enter за изход" | Out-Null
}
