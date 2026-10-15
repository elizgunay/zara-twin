param([string]$Pdf, [string]$OutDir)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); $task.Result }
function AwaitA($op) { $asTaskAction.Invoke($null, @($op)).Wait() }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Pdf)) ([Windows.Storage.StorageFile])
$doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
for ($i = 0; $i -lt $doc.PageCount; $i++) {
  $page = $doc.GetPage($i)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  AwaitA ($page.RenderToStreamAsync($stream))
  $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
  $fs = [System.IO.File]::Create((Join-Path $OutDir ("page-{0}.png" -f ($i + 1))))
  $net.CopyTo($fs); $fs.Close(); $page.Dispose()
}
"rendered $($doc.PageCount)"
