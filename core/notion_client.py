"""
Typographus — Notion publish connector.

Uses Notion's own public API (developers.notion.com) with an "integration
token" the user creates at notion.so/my-integrations and shares with a
single parent page in their workspace — never their real Notion login.
Typographus only ever sees that token, and only sends it to api.notion.com.

Credentials are saved locally (same folder as the license token), never
inside a document's own JSON — so they don't get bundled into exports,
templates, or the "Pubblica nel Mondo" gallery.
"""
import json
import os
import urllib.error
import urllib.request

from . import license_manager as lic

_CRED_FILENAME = "notion.json"
_API = "https://api.notion.com/v1"
_VERSION = "2022-06-28"


def _cred_path() -> str:
    return os.path.join(lic.license_dir(), _CRED_FILENAME)


def get_credentials() -> dict:
    try:
        with open(_cred_path(), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def has_credentials() -> bool:
    c = get_credentials()
    return bool(c.get("token") and c.get("page_id"))


def save_credentials(token: str, page_id: str) -> bool:
    try:
        data = {
            "token": (token or "").strip(),
            # accept a pasted page URL or a bare ID; Notion's API wants the
            # bare 32-char ID (hyphens optional either way).
            "page_id": (page_id or "").strip().split("-")[-1].split("?")[0].split("/")[-1][-32:],
        }
        with open(_cred_path(), "w", encoding="utf-8") as f:
            json.dump(data, f)
        return True
    except Exception:
        return False


def remove_credentials():
    try:
        os.remove(_cred_path())
    except Exception:
        pass


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": _VERSION,
        "Content-Type": "application/json",
        "User-Agent": "Typographus/1.0",
    }


def check_connection() -> dict:
    """Verifies the token is valid and the integration can see itself,
    without touching any page — probes GET /v1/users/me."""
    creds = get_credentials()
    token = creds.get("token")
    if not token:
        return {"ok": False, "error": "Nessuna integrazione Notion configurata."}
    req = urllib.request.Request(f"{_API}/users/me", headers=_headers(token))
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        return {"ok": True, "name": data.get("name") or "Integrazione Notion"}
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {"ok": False, "error": "Token rifiutato: verifica l'integration token."}
        return {"ok": False, "error": f"Notion ha risposto con un errore ({e.code})."}
    except Exception as e:
        return {"ok": False, "error": f"Impossibile raggiungere Notion: {e}"}


def _blocks_from_markdown(source: str) -> list:
    """Best-effort Markdown → Notion blocks: headings, quotes, bullets,
    paragraphs. Notion's API caps a single request at 100 children blocks
    and 2000 characters of rich text per block, so both are respected."""
    blocks = []
    for raw in source.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("### "):
            kind, text = "heading_3", line[4:]
        elif line.startswith("## "):
            kind, text = "heading_2", line[3:]
        elif line.startswith("# "):
            kind, text = "heading_1", line[2:]
        elif line.startswith("> "):
            kind, text = "quote", line[2:]
        elif line.startswith(("- ", "* ")):
            kind, text = "bulleted_list_item", line[2:]
        else:
            kind, text = "paragraph", line
        text = text[:2000]
        blocks.append({
            "object": "block",
            "type": kind,
            kind: {"rich_text": [{"type": "text", "text": {"content": text}}]},
        })
        if len(blocks) >= 95:
            break
    if not blocks:
        blocks = [{
            "object": "block", "type": "paragraph",
            "paragraph": {"rich_text": [{"type": "text", "text": {"content": "(documento vuoto)"}}]},
        }]
    return blocks


def publish(title: str, source: str) -> dict:
    creds = get_credentials()
    token = creds.get("token")
    page_id = creds.get("page_id")
    if not (token and page_id):
        return {"ok": False, "error": "Connessione Notion non configurata."}
    body = json.dumps({
        "parent": {"page_id": page_id},
        "properties": {"title": {"title": [{"text": {"content": title or "Senza titolo"}}]}},
        "children": _blocks_from_markdown(source),
    }).encode()
    req = urllib.request.Request(f"{_API}/pages", data=body, method="POST", headers=_headers(token))
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
        return {"ok": True, "url": data.get("url", "")}
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode()).get("message", "")
        except Exception:
            pass
        if e.code == 401:
            return {"ok": False, "error": "Autenticazione rifiutata: controlla l'integration token."}
        if e.code == 404:
            return {"ok": False, "error": "Pagina non trovata: verifica l'ID pagina e condividila con l'integrazione (⋯ → Aggiungi connessioni)."}
        return {"ok": False, "error": f"Notion ha rifiutato la richiesta ({e.code}). {detail}"}
    except Exception as e:
        return {"ok": False, "error": f"Impossibile pubblicare: {e}"}
