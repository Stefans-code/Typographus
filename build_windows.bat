@echo off
REM Typographus - build the Windows installer (NSIS .exe).
REM (c) 2026 Nexflamma S.r.l.
echo ===========================================
echo [INFO] Building Typographus for Windows...
echo ===========================================

call npm install
call npm run build

echo [INFO] Packaging NSIS installer (x64)...
call npx electron-builder --win --publish never

echo [SUCCESS] Done. Trovi l'installer nella cartella .\release
pause
