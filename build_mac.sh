#!/usr/bin/env bash
# Typographus (Python + embedded web UI) - build the macOS app (.app, onedir).
# (c) 2026 Nexflamma S.r.l.   |   the compiled UI lives in webui/ (offline).
set -euo pipefail
cd "$(dirname "$0")"

echo "==========================================="
echo "[INFO] Building Typographus for macOS..."
echo "==========================================="

PY=python3
if [ -x "venv/bin/python" ]; then PY="venv/bin/python"; fi

"$PY" -m pip install -r requirements.txt pyinstaller
rm -rf build_out build_tmp

# PyInstaller needs a .icns on macOS; the repo only ships .ico/.png, so build
# one from icon.png on the fly (sips/iconutil are stock on every Mac).
ICON_ARG=()
if [ -f icon.icns ]; then
  ICON_ARG=(--icon icon.icns)
elif command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  ICONSET="build_tmp/icon.iconset"
  mkdir -p "$ICONSET"
  for sz in 16 32 64 128 256 512 1024; do
    sips -z "$sz" "$sz" icon.png --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o build_tmp/icon.icns
  ICON_ARG=(--icon build_tmp/icon.icns)
else
  echo "[WARN] Can't produce icon.icns (no sips/iconutil) - building without a custom icon."
fi

"$PY" -m PyInstaller --noconfirm --onedir --windowed --name Typographus \
  "${ICON_ARG[@]}" --distpath build_out --workpath build_tmp \
  --add-data "webui:webui" --add-data "icon.ico:." --add-data "icon.png:." \
  --hidden-import core.license_manager \
  main.py

echo "[SUCCESS] App bundle: build_out/Typographus.app"

# Wrap in a .dmg so it's a proper double-click installer, not a bare folder.
if command -v hdiutil >/dev/null 2>&1; then
  DMG="build_out/Typographus.dmg"
  rm -f "$DMG"
  hdiutil create -volname "Typographus" -srcfolder "build_out/Typographus.app" \
    -ov -format UDZO "$DMG"
  echo "[SUCCESS] Installer: $DMG"
else
  echo "[WARN] hdiutil not found (not on macOS?) - skipping .dmg packaging."
fi
