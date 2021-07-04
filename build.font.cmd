@echo off
chcp  65001>nul
set   NAME=iosevnya
pause&cls
cmd/c pnpm up
echo.
pause&cls
cmd/c pnpm run build fonts::%NAME% ttc::%NAME%
echo.
echo.
pause
echo.&echo Start building 7z . . .
echo.
build.7z
