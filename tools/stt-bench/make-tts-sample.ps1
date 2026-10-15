# Създава тестов запис на български с гласа на Windows (Microsoft Ivan, bg-BG)
# от еталонния текст в samples/tts-bg.txt. Синтетичният глас е по-чист от реален
# разговор, затова резултатът е оптимистичен: служи за проверка, че веригата
# работи, а не за окончателна оценка.
#
# Файлът е записан като UTF-8 с BOM, иначе Windows PowerShell 5.1 обърква кирилицата.
# Употреба (от корена на проекта):  npm run bench:sample
param(
  [string]$TextFile = "tools/stt-bench/samples/tts-bg.txt",
  [string]$OutDir = "data/bench"
)
$ErrorActionPreference = "Stop"

$text = [System.IO.File]::ReadAllText((Resolve-Path $TextFile).Path, [System.Text.Encoding]::UTF8)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTaskMethods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$asTask = $asTaskMethods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait()
  $task.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -eq "bg-BG" } | Select-Object -First 1
if ($null -eq $voice) { throw "Няма инсталиран български глас (bg-BG) в Windows." }
$synth.Voice = $voice

$speech = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$size = [uint32]$speech.Size
$reader = New-Object Windows.Storage.Streams.DataReader($speech.GetInputStreamAt(0))
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)

New-Item -ItemType Directory -Force $OutDir | Out-Null
$outPath = Join-Path (Resolve-Path $OutDir).Path "tts-bg.wav"
[System.IO.File]::WriteAllBytes($outPath, $bytes)
Copy-Item $TextFile (Join-Path (Resolve-Path $OutDir).Path "tts-bg.txt") -Force
"Записано: $outPath ($([math]::Round($size / 1KB)) KB, глас: $($voice.DisplayName))"
