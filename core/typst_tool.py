"""
Typographus — Typst compiler manager.

Typst has no embeddable library binding for Python, but ships small,
self-contained, official prebuilt binaries per platform on GitHub Releases.
This module downloads the right one on first use (into the app's own data
folder, never system-wide) and shells out to it to compile a .typ source
into a PDF — the same "local tool, invoked like a subprocess" pattern the
app already uses for makensis when building its own Windows installer.

Nothing is downloaded until the user explicitly asks (see typstDownload in
main.py, wired to a button the user must click).
"""
import json
import os
import platform
import shutil
import subprocess
import tarfile
import urllib.error
import urllib.request
import zipfile

from . import license_manager as lic

TYPST_VERSION = "v0.15.1"

# (system, machine) -> (release asset filename, archive kind, binary name inside it)
_ASSETS = {
    ("Windows", "AMD64"): ("typst-x86_64-pc-windows-msvc.zip", "zip", "typst.exe"),
    ("Windows", "x86_64"): ("typst-x86_64-pc-windows-msvc.zip", "zip", "typst.exe"),
    ("Darwin", "arm64"): ("typst-aarch64-apple-darwin.tar.xz", "txz", "typst"),
    ("Darwin", "x86_64"): ("typst-x86_64-apple-darwin.tar.xz", "txz", "typst"),
    ("Linux", "x86_64"): ("typst-x86_64-unknown-linux-musl.tar.xz", "txz", "typst"),
}


def _tools_dir() -> str:
    d = os.path.join(lic.license_dir(), "tools")
    os.makedirs(d, exist_ok=True)
    return d


def _local_binary_path() -> str:
    exe = "typst.exe" if platform.system() == "Windows" else "typst"
    return os.path.join(_tools_dir(), exe)


def _system_binary() -> str:
    return shutil.which("typst") or ""


def _resolved_binary() -> str:
    """A `typst` already on PATH takes priority over our downloaded copy —
    if the user has their own install, use it (and its own, possibly newer,
    version) rather than shadowing it."""
    return _system_binary() or (_local_binary_path() if os.path.exists(_local_binary_path()) else "")


def status() -> dict:
    exe = _resolved_binary()
    if not exe:
        key = (platform.system(), platform.machine())
        return {"installed": False, "downloadable": key in _ASSETS}
    return {"installed": True, "path": exe, "system": bool(_system_binary())}


def download() -> dict:
    key = (platform.system(), platform.machine())
    asset = _ASSETS.get(key)
    if not asset:
        return {"ok": False, "error": f"Piattaforma non supportata per il download automatico: {platform.system()} {platform.machine()}."}
    filename, kind, exe_name = asset
    url = f"https://github.com/typst/typst/releases/download/{TYPST_VERSION}/{filename}"
    tools_dir = _tools_dir()
    archive_path = os.path.join(tools_dir, filename)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Typographus/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp, open(archive_path, "wb") as out:
            shutil.copyfileobj(resp, out)
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"Download non riuscito: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"Download non riuscito: {e}"}

    try:
        if kind == "zip":
            with zipfile.ZipFile(archive_path) as z:
                z.extractall(tools_dir)
        else:
            with tarfile.open(archive_path) as t:
                t.extractall(tools_dir)
    except Exception as e:
        return {"ok": False, "error": f"Estrazione non riuscita: {e}"}
    finally:
        try:
            os.remove(archive_path)
        except Exception:
            pass

    found = None
    for root, _dirs, files in os.walk(tools_dir):
        if exe_name in files:
            found = os.path.join(root, exe_name)
            break
    if not found:
        return {"ok": False, "error": "Eseguibile non trovato nell'archivio scaricato."}

    target = _local_binary_path()
    if os.path.abspath(found) != os.path.abspath(target):
        shutil.copy2(found, target)
    if platform.system() != "Windows":
        os.chmod(target, 0o755)
    return {"ok": True, "path": target}


def compile_source(typ_source: str) -> dict:
    exe = _resolved_binary()
    if not exe:
        return {"ok": False, "error": "Typst non è installato.", "notInstalled": True}

    work_dir = os.path.join(lic.license_dir(), "typst-tmp")
    os.makedirs(work_dir, exist_ok=True)
    typ_path = os.path.join(work_dir, "document.typ")
    pdf_path = os.path.join(work_dir, "document.pdf")
    try:
        with open(typ_path, "w", encoding="utf-8") as f:
            f.write(typ_source)
        result = subprocess.run(
            [exe, "compile", typ_path, pdf_path],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            return {"ok": False, "error": (result.stderr or result.stdout or "Errore di compilazione Typst.").strip()[:4000]}
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
        import base64
        return {"ok": True, "pdfBase64": base64.b64encode(pdf_bytes).decode()}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Compilazione Typst scaduta (60s)."}
    except Exception as e:
        return {"ok": False, "error": f"Errore imprevisto: {e}"}
