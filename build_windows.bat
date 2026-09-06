@echo off
REM Typographus (Python + embedded web UI) - build the Windows app (.exe, onedir).
REM (c) 2026 Nexflamma S.r.l.   |   the compiled UI lives in webui/ (offline).
echo ===========================================
echo [INFO] Building Typographus for Windows...
echo ===========================================

set PY=python
if exist venv\Scripts\python.exe set PY=venv\Scripts\python.exe
%PY% -m pip install -r requirements.txt pyinstaller
if exist build_out rmdir /S /Q build_out
if exist build_tmp rmdir /S /Q build_tmp
%PY% -m PyInstaller --noconfirm --onedir --windowed --name Typographus ^
  --icon icon.ico --distpath build_out --workpath build_tmp ^
  --add-data "webui;webui" --add-data "icon.ico;." --add-data "icon.png;." ^
  --hidden-import core.license_manager ^
  main.py

echo [SUCCESS] App folder: build_out\Typographus\Typographus.exe

where makensis >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  makensis installer.nsi
  echo [SUCCESS] Installer: build_out\TypographusSetup.exe
) else (
  echo [WARN] makensis not found (NSIS not installed) - skipping installer packaging.
  echo [WARN] Install NSIS ^(https://nsis.sourceforge.io/^) to produce TypographusSetup.exe.
)
if not defined CI pause
