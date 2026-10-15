# Сглобява пакет за пренасяне на компютъра на ръководителя:
#   release/zara-copilot-pilot/
#     extension/            готовото разширение (Load unpacked)
#     hardware-check.ps1    проверка на компютъра
#     Инструкция.pdf        стъпките за теста
#   release/zara-copilot-pilot.zip
#
# Файлът е UTF-8 с BOM, иначе Windows PowerShell 5.1 обърква кирилицата.
# Употреба (от корена на проекта):  npm run pilot-package
$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$out = Join-Path $root "release\zara-copilot-pilot"
$zip = Join-Path $root "release\zara-copilot-pilot.zip"
$guide = Get-ChildItem (Join-Path $root "docs\pilot") -Filter "*.pdf" | Sort-Object Name | Select-Object -Last 1
if ($null -eq $guide) { throw "Липсва PDF инструкция в docs\pilot (npm run pilot-guide)." }

npm.cmd run build:extension | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Изграждането на разширението не успя." }

# Изчистваме съдържанието, а не самата папка: тя може да е отворена в Explorer
# или заредена в Chrome, и тогава Windows не позволява изтриването ѝ.
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem $out -Force | Remove-Item -Recurse -Force -Confirm:$false
Copy-Item (Join-Path $root "apps\extension\dist") (Join-Path $out "extension") -Recurse
Copy-Item (Join-Path $root "tools\hardware-check.ps1") $out
Copy-Item $guide.FullName (Join-Path $out "Инструкция.pdf")

# Пакетът за ръководителя не бива да съдържа тайни или данни от разговори.
# Изключение: синтетичният запис за теста на компютъра (Windows TTS, без лични данни).
$allowed = Join-Path $out "extension\selftest\sample.wav"
$forbidden = Get-ChildItem $out -Recurse -File | Where-Object {
  ($_.Name -match '\.(pem|env|wav|mp3|m4a|webm)$' -or $_.Name -eq ".env") -and $_.FullName -ne $allowed
}
if ($forbidden) { throw "В пакета има забранени файлове: $($forbidden.Name -join ', ')" }

if (Test-Path $zip) { Remove-Item $zip -Force -Confirm:$false }
Compress-Archive -Path $out -DestinationPath $zip
"Готово: $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)"
