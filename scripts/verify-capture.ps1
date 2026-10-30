$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (Get-Process -Name 'deep-interview' -ErrorAction SilentlyContinue) {
    throw '请先从托盘退出 Deep Interview，避免单实例机制把测试发送到现有窗口。'
}
& npm.cmd run desktop:build:debug
if ($LASTEXITCODE -ne 0) { throw '桌面构建失败。' }
$executable = Join-Path $projectRoot 'src-tauri\target\debug\deep-interview.exe'
$report = Join-Path $projectRoot 'artifacts\local\capture-report.json'
if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report }
$probe = Start-Process -FilePath $executable -ArgumentList '--capture-self-test' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
if (-not $probe.WaitForExit(45000)) {
    $probe.Kill()
    throw '捕获验证超时，已结束本次测试进程。'
}
if (-not (Test-Path -LiteralPath $report)) { throw '没有生成捕获测试报告。' }
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
$result | ConvertTo-Json
if ($probe.ExitCode -ne 0 -or -not $result.passed) { throw '本机捕获测试未通过，请检查报告。' }
Write-Output '本机 GDI 捕获对照测试通过。会议远端接收画面仍需独立验证。'
