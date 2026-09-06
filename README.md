# Typographus — Editorial & Typesetting Engine

App **desktop Python** (PySide6) per impaginazione editoriale ad alta precisione
da sorgenti Markdown/Word: anteprima impaginata, PDF di stampa (CMYK/ICC),
ePub 3, indice, note, bibliografia, colophon, metriche di leggibilità.

L'interfaccia (lo stile "Atelier" grafite/accento) è disegnata dal motore web
incorporato e **compilata** in `webui/` — nessun sorgente JS/TS nel progetto.
Tutto **offline**. © 2026 Nexflamma S.r.l. — software proprietario (vedi `LICENSE`).

## Avvio (sviluppo)
```bash
python -m venv venv
venv\Scripts\pip install -r requirements.txt   # PySide6
venv\Scripts\python main.py
```

## Build app (Windows / macOS / Linux)
```bat
build_windows.bat        REM -> build_out\TypographusSetup.exe (PyInstaller + NSIS)
```
```bash
./build_mac.sh           # -> build_out/Typographus.dmg (PyInstaller + hdiutil)
./build_linux.sh         # -> build_out/Typographus-x86_64.AppImage (PyInstaller + appimagetool)
```
Ogni script compila prima `npm run build` (per rigenerare `webui/`, se necessario)
e poi impacchetta l'app Python in un installer nativo per la propria piattaforma.
CI: [`.github/workflows/build.yml`](.github/workflows/build.yml) produce i tre
installer ad ogni push su `main` (artifact scaricabili dalla Action, nessuna
release pubblica automatica).

## Licenza
Attivazione **offline** legata all'HWID (gate nel pannello *Impostazioni →
Licenza*). File: `%LOCALAPPDATA%\Typographus\license.typographus` (Win),
`~/Library/Application Support/Typographus/` (mac), `~/.config/Typographus/` (Linux).
Genera una chiave:
```bash
python tools/license_maker.py <HWID> [giorni] [piano]   # 0 giorni = perpetua
```

## Struttura
```
main.py                 shell PySide6 (finestra frameless, server locale, bridge licenza, PDF/download)
core/license_manager.py licenza offline HS256 + HWID
tools/license_maker.py  generatore chiavi
webui/                  interfaccia compilata (necessaria, offline)
icon.ico / icon.png     marchio
```
