@echo off
chcp 65001>nul
set VERSION=v10.3.2-1
set NAME=iosevnya
set ARGS=-m0=lzma -md3840m -mfb273 -mmt2 -ms -mx9 -stl
cd dist
del  %VERSION%*.7z /p 2>nul
pause
7z a %VERSION%.7z %ARGS% ./@TTC/%NAME%.ttc
echo.
7z a %VERSION%-ttf.7z %ARGS% ./%NAME%/ttf/%NAME%-*.ttf
echo.
7z a %VERSION%-ttf-unhinted.7z %ARGS% ./%NAME%/ttf-unhinted/%NAME%-*.ttf
echo.
echo.
cmd
