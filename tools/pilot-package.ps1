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

# Пакетът е за други хора: изграждаме го без вградения ключ за Speechmatics (всеки въвежда свой).
$env:ZARA_PILOT_PACKAGE = "1"
try {
  npm.cmd run build:extension | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Изграждането на разширението не успя." }
} finally {
  Remove-Item Env:ZARA_PILOT_PACKAGE -ErrorAction SilentlyContinue
}

# Изчистваме съдържанието, а не самата папка: тя може да е отворена в Explorer
# или заредена в Chrome, и тогава Windows не позволява изтриването ѝ.
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem $out -Force | Remove-Item -Recurse -Force -Confirm:$false
Copy-Item (Join-Path $root "apps\extension\dist") (Join-Path $out "extension") -Recurse
Copy-Item (Join-Path $root "tools\hardware-check.ps1") $out
Copy-Item (Join-Path $root "tools\hardware-check.cmd") $out
Copy-Item $guide.FullName (Join-Path $out "Инструкция.pdf")

# Пакетът за ръководителя не бива да съдържа тайни или данни от разговори.
# Изключение: синтетичният запис за теста на компютъра (Windows TTS, без лични данни).
$allowed = Join-Path $out "extension\selftest\sample.wav"
$forbidden = Get-ChildItem $out -Recurse -File | Where-Object {
  ($_.Name -match '\.(pem|env|wav|mp3|m4a|webm)$' -or $_.Name -eq ".env") -and $_.FullName -ne $allowed
}
if ($forbidden) { throw "В пакета има забранени файлове: $($forbidden.Name -join ', ')" }
# Втора защита: в кода на пакета не бива да има вграден ключ.
$baked = Get-ChildItem (Join-Path $out "extension") -Filter "*.js" -File | Select-String -Pattern 'BUILT_IN_SPEECHMATICS_KEY = "[^"]+"' -List
if ($baked) { throw "В пакета има вграден ключ за Speechmatics ($($baked.Filename -join ', ')). Пакетът не е създаден." }

# Обратно: разширението за разработка (apps\extension\dist) отново с ключа от .env.
npm.cmd run build:extension | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Повторното изграждане на разширението не успя." }

if (Test-Path $zip) { Remove-Item $zip -Force -Confirm:$false }
# Не Compress-Archive: в Windows PowerShell 5.1 той записва пътищата с „\“ и на Mac
# архивът се разархивира като плоски файлове („extension\manifest.json“) вместо папки.
# Пишем записите ръчно с „/“ (ZIP стандарт); .NET слага UTF-8 за имената на кирилица.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $base = Split-Path $out -Parent
  Get-ChildItem $out -Recurse -File | ForEach-Object {
    $entryName = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $archive.Dispose()
}
"Готово: $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)"
