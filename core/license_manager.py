"""
Typographus — offline license manager (Nexflamma).
Signed token (HS256) stored locally, verified against machine HWID + expiry.
No third-party dependency (uses hashlib/hmac), works fully offline.
"""
import base64
import hashlib
import hmac
import json
import os
import platform
import subprocess
import time

LICENSE_SECRET = "typographus_offline_secure_key_2026_nexflamma"


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def get_hwid() -> str:
    """Stable per-machine hardware id (Windows / macOS / Linux)."""
    system = platform.system()
    try:
        if system == "Windows":
            import winreg
            reg = winreg.ConnectRegistry(None, winreg.HKEY_LOCAL_MACHINE)
            key = winreg.OpenKey(reg, r"SOFTWARE\Microsoft\Cryptography")
            machine_guid, _ = winreg.QueryValueEx(key, "MachineGuid")
            winreg.CloseKey(key)
            raw = f"{machine_guid}-TYPOGRAPHUS-SECURE"
        elif system == "Darwin":
            out = subprocess.check_output(
                "ioreg -rd1 -c IOPlatformExpertDevice", shell=True, stderr=subprocess.DEVNULL
            ).decode()
            serial = "MACOS-FALLBACK"
            for line in out.splitlines():
                if "IOPlatformSerialNumber" in line:
                    serial = line.split("=")[-1].replace('"', "").strip()
                    break
            raw = f"{serial}-APPLE-TYPOGRAPHUS-SECURE"
        else:
            mid = ""
            for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
                if os.path.exists(p):
                    mid = open(p).read().strip()
                    break
            raw = f"{mid or platform.node()}-LINUX-TYPOGRAPHUS-SECURE"
        return hashlib.sha256(raw.encode()).hexdigest()[:16].upper()
    except Exception:
        import uuid
        return hashlib.sha256(f"{uuid.getnode()}-FALLBACK".encode()).hexdigest()[:16].upper()


def license_dir() -> str:
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("LOCALAPPDATA", os.path.expanduser("~/AppData/Local"))
        path = os.path.join(base, "Typographus")
    elif system == "Darwin":
        path = os.path.expanduser("~/Library/Application Support/Typographus")
    else:
        path = os.path.expanduser("~/.config/Typographus")
    os.makedirs(path, exist_ok=True)
    return path


def license_path() -> str:
    return os.path.join(license_dir(), "license.typographus")


def sign_token(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    seg = _b64url_encode(json.dumps(header, separators=(",", ":")).encode()) + "." + _b64url_encode(
        json.dumps(payload, separators=(",", ":")).encode()
    )
    sig = hmac.new(LICENSE_SECRET.encode(), seg.encode(), hashlib.sha256).digest()
    return seg + "." + _b64url_encode(sig)


def _decode_verify(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Token malformato")
    seg = parts[0] + "." + parts[1]
    expected = hmac.new(LICENSE_SECRET.encode(), seg.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64url_decode(parts[2])):
        raise ValueError("Firma non valida")
    return json.loads(_b64url_decode(parts[1]))


def verify_token(token: str, hwid: str) -> dict:
    try:
        payload = _decode_verify(token)
    except Exception as e:
        return {"valid": False, "message": f"Token non valido: {e}"}
    if payload.get("hwid") and payload["hwid"] != hwid:
        return {"valid": False, "message": f"Licenza per un altro dispositivo (locale: {hwid})"}
    exp = payload.get("exp")
    if exp and time.time() > exp:
        return {"valid": False, "message": "Licenza scaduta"}
    when = time.strftime("%d/%m/%Y", time.localtime(exp)) if exp else "perpetua"
    res = {"valid": True, "message": f"Attiva (scadenza: {when})", "plan": payload.get("plan", "Full"), "exp": exp}
    for k, v in payload.items():
        if k not in res:
            res[k] = v
    return res


def read_token() -> str:
    try:
        with open(license_path(), "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def save_token(token: str) -> bool:
    try:
        with open(license_path(), "w", encoding="utf-8") as f:
            f.write(token.strip())
        return True
    except Exception:
        return False


def remove_token():
    try:
        os.remove(license_path())
    except Exception:
        pass


def status() -> dict:
    hwid = get_hwid()
    token = read_token()
    if not token:
        return {"valid": False, "message": "Licenza mancante", "hwid": hwid}
    res = verify_token(token, hwid)
    res["hwid"] = hwid
    return res


def activate(token: str) -> dict:
    hwid = get_hwid()
    res = verify_token(token, hwid)
    if res["valid"]:
        save_token(token)
    res["hwid"] = hwid
    return res
