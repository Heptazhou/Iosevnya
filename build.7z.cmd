@echo off
chcp 65001>nul
set VERSION=v0.0.0-0
set NAME=iosevnya
set ARGS=-m0=lzma -md1536m -mfb273 -mmt1 -ms -mx9 -stl
cd dist
del  %VERSION%*.7z /p 2>nul
pause&cls
7z a %VERSION%.7z %ARGS% ./@TTC/%NAME%.ttc
echo.
7z a %VERSION%-ttf.7z %ARGS% ./%NAME%/ttf/*.ttf
echo.
7z a %VERSION%-ttf-unhinted.7z %ARGS% ./%NAME%/ttf-unhinted/*.ttf
echo.
echo.
cmd
