@echo off
setlocal
set "assistant_exe=%~dp0src-tauri\target\debug\deep-interview.exe"
if not exist "%assistant_exe%" (
  echo Please run npm ci and npm run desktop:build:debug first.
  pause
  exit /b 1
)
start "" "%assistant_exe%"
