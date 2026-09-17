"""
Typographus — "Importa da URL" fetcher.

Lets a document be pulled straight from a link — a template hosted on
GitHub (raw Markdown, or a Typst Universe package's .typ source), an
Overleaf project's raw .tex file, a plain web page, anything reachable
over plain HTTP(S) — instead of only from a file already on disk.

Runs in the desktop shell (not the browser build) for the same reason the
WordPress and Notion connectors do: most sites don't send permissive CORS
headers for arbitrary third-party pages, so a plain browser fetch() would
be refused. A direct HTTP request from Python has no such restriction.

Deliberately conservative: only http(s), a byte cap so a link to a huge
file can't hang or exhaust memory, and no redirect to a non-http(s)
scheme (blocks file://, ftp://, etc. smuggled in via a redirect).
"""
import json
import mimetypes
import os
import urllib.error
import urllib.request
from base64 import b64encode
from urllib.parse import urlparse

MAX_BYTES = 8 * 1024 * 1024  # 8 MB — generous for a document/template source
TIMEOUT = 20


def _filename_from_url(url: str, content_type: str) -> str:
    path = urlparse(url).path
    name = os.path.basename(path) or "documento"
    if "." not in name:
        ext = mimetypes.guess_extension((content_type or "").split(";")[0].strip()) or ".txt"
        name += ext
    return name


def fetch(url: str) -> dict:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https"):
        return {"ok": False, "error": "Sono supportati solo indirizzi http:// o https://."}

    req = urllib.request.Request(url, headers={"User-Agent": "Typographus/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            final_url = resp.geturl()
            if urlparse(final_url).scheme not in ("http", "https"):
                return {"ok": False, "error": "Reindirizzamento a uno schema non supportato."}
            content_type = resp.headers.get("Content-Type", "")
            data = resp.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                return {"ok": False, "error": f"Il file supera il limite di {MAX_BYTES // (1024*1024)} MB per l'importazione da URL."}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"Il sito ha risposto con un errore ({e.code})."}
    except Exception as e:
        return {"ok": False, "error": f"Impossibile raggiungere l'indirizzo: {e}"}

    return {
        "ok": True,
        "filename": _filename_from_url(final_url, content_type),
        "contentType": content_type,
        "base64": b64encode(data).decode("ascii"),
    }
