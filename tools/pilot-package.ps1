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

if (Test-Path $out) { Remove-Item $out -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $root "apps\extension\dist") (Join-Path $out "extension") -Recurse
Copy-Item (Join-Path $root "tools\hardware-check.ps1") $out
Copy-Item $guide.FullName (Join-Path $out "Инструкция.pdf")

# Пакетът за ръководителя не бива да съдържа тайни или данни от разговори.
$forbidden = Get-ChildItem $out -Recurse -File | Where-Object { $_.Name -match '\.(pem|env|wav|mp3|m4a|webm)$' -or $_.Name -eq ".env" }
if ($forbidden) { throw "В пакета има забранени файлове: $($forbidden.Name -join ', ')" }

if (Test-Path $zip) { Remove-Item $zip -Force -Confirm:$false }
Compress-Archive -Path $out -DestinationPath $zip
"Готово: $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)"
