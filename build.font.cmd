@echo off
chcp  65001>nul
set   NAME=iosevnya
pause&cls
cmd/c pnpm up
cmd/c pnpm clean
echo.
echo.
pause&cls
cmd/c pnpm build fonts::%NAME% ttc::%NAME%
echo.
echo.
pause
echo.&echo Start building 7z . . .
echo.
build.7z
