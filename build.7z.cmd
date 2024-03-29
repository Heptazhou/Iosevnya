@echo off
chcp  65001>nul
set   VERSION=v28.0.4-1
set   NAME=iosevnya
set   ARGS=-m0=lzma -md3840m -mfb273 -mmt2 -mqs -ms -mtm- -mx9 -stl
cd    dist
del   /p          %VERSION%*.7z 2>nul
pause&7z a %ARGS% %VERSION%.7z       ./%NAME%/%NAME%.ttc
echo.&7z a %ARGS% %VERSION%-ttf.7z          ./%NAME%/ttf/%NAME%-*.ttf
echo.&7z a %ARGS% %VERSION%-ttf-unhinted.7z ./%NAME%/ttf-unhinted/%NAME%-*.ttf
echo.
echo.
cmd
