#!/usr/bin/env bash
# Typographus (Python + embedded web UI) - build a universal Linux AppImage.
# (c) 2026 Nexflamma S.r.l.   |   the compiled UI lives in webui/ (offline).
#
# An AppImage is the closest thing Linux has to a single "universal
# installer": one executable file, no package manager, runs on (almost)
# any distro with FUSE (or --appimage-extract-and-run as a fallback).
set -euo pipefail
cd "$(dirname "$0")"

echo "==========================================="
echo "[INFO] Building Typographus for Linux..."
echo "==========================================="

PY=python3
if [ -x "venv/bin/python" ]; then PY="venv/bin/python"; fi

"$PY" -m pip install -r requirements.txt pyinstaller
rm -rf build_out build_tmp

"$PY" -m PyInstaller --noconfirm --onedir --windowed --name Typographus \
  --icon icon.png --distpath build_out --workpath build_tmp \
  --add-data "webui:webui" --add-data "icon.ico:." --add-data "icon.png:." \
  --hidden-import core.license_manager \
  main.py

echo "[SUCCESS] App folder: build_out/Typographus"

# ---- Package as an AppImage (needs appimagetool; downloaded if missing) ----
APPDIR="build_tmp/Typographus.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
cp -r build_out/Typographus/* "$APPDIR/usr/bin/"
cp icon.png "$APPDIR/typographus.png"

cat > "$APPDIR/typographus.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Typographus
Comment=Motore editoriale e di impaginazione tipografica
Exec=Typographus
Icon=typographus
Categories=Office;Publishing;
Terminal=false
EOF

cat > "$APPDIR/AppRun" <<'EOF'
#!/usr/bin/env bash
HERE="$(dirname "$(readlink -f "${0}")")"
exec "$HERE/usr/bin/Typographus" "$@"
EOF
chmod +x "$APPDIR/AppRun"

APPIMAGETOOL="build_tmp/appimagetool.AppImage"
if [ ! -x "$APPIMAGETOOL" ]; then
  echo "[INFO] Downloading appimagetool..."
  curl -L -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$APPIMAGETOOL"
fi

ARCH=x86_64 "$APPIMAGETOOL" "$APPDIR" "build_out/Typographus-x86_64.AppImage" --no-appstream

echo "[SUCCESS] Installer: build_out/Typographus-x86_64.AppImage"
