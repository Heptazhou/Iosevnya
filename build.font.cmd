@echo off
chcp 65001>nul
set NAME=iosevnya
pause&cls
cmd /c pnpm up
pause&cls
cmd /c pnpm run build fonts::%NAME% ttc::%NAME%
echo.
pause&build.7z
