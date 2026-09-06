"""
Typographus license generator (Nexflamma, offline).

Usage:
  python tools/license_maker.py <HWID> [giorni] [piano]
    giorni = 0  -> licenza perpetua (default)
  python tools/license_maker.py            -> usa l'HWID di QUESTA macchina

Stampa la chiave. Con --save la salva anche nel percorso licenza locale.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import license_manager as lic


def main():
    args = [a for a in sys.argv[1:] if a != "--save"]
    save = "--save" in sys.argv

    hwid = args[0] if len(args) > 0 else lic.get_hwid()
    days = int(args[1]) if len(args) > 1 else 0
    plan = args[2] if len(args) > 2 else "Full"

    payload = {"hwid": hwid, "plan": plan}
    if len(args) > 3:
        payload["email"] = args[3]
    if days > 0:
        payload["exp"] = int(time.time()) + days * 86400

    token = lic.sign_token(payload)
    print(token)
    if save:
        lic.save_token(token)
        print(f"[saved] {lic.license_path()}", file=sys.stderr)


if __name__ == "__main__":
    main()
