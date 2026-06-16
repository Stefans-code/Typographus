/* Typographus license manager — offline JWT (HS256) bound to a hardware ID.
   Same model as the other Nexflamma products (Datarium / Census):
   a signed token stored locally, verified against the machine HWID + expiry.
   Works fully offline; an optional online revocation check can be added later. */

const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

// Deve corrispondere al generatore di chiavi (tools/license-maker.mjs)
const LICENSE_SECRET = "typographus_offline_secure_key_2026_nexflamma_x7";

/* ---- base64url + HS256 ---- */
function b64url(buf) {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlToBuf(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}
function hmac(data) {
  return b64url(crypto.createHmac("sha256", LICENSE_SECRET).update(data).digest());
}

function signToken(payload) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  return `${data}.${hmac(data)}`;
}

function decodeVerify(token) {
  const parts = String(token).trim().split(".");
  if (parts.length !== 3) throw new Error("Token non valido");
  const data = `${parts[0]}.${parts[1]}`;
  const expected = hmac(data);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Firma non valida");
  return JSON.parse(b64urlToBuf(parts[1]).toString("utf8"));
}

/* ---- hardware id ---- */
function getHWID() {
  let raw;
  try {
    if (process.platform === "win32") {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).toString();
      const m = out.match(/MachineGuid\s+REG_SZ\s+([A-Za-z0-9-]+)/i);
      raw = `${m ? m[1] : os.hostname()}-TYPOGRAPHUS-SECURE`;
    } else if (process.platform === "darwin") {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).toString();
      const m = out.match(/IOPlatformSerialNumber"\s*=\s*"([^"]+)"/);
      raw = `${m ? m[1] : os.hostname()}-APPLE-TYPOGRAPHUS-SECURE`;
    } else {
      raw = `${os.hostname()}-${os.arch()}-TYPOGRAPHUS-GENERIC`;
    }
  } catch {
    const nics = os.networkInterfaces();
    const mac = Object.values(nics).flat().find((n) => n && n.mac && n.mac !== "00:00:00:00:00:00");
    raw = `${mac ? mac.mac : os.hostname()}-TYPOGRAPHUS-FALLBACK`;
  }
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16).toUpperCase();
}

/* ---- persistent storage ---- */
function licenseDir() {
  let base;
  if (process.platform === "win32") base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  else if (process.platform === "darwin") base = path.join(os.homedir(), "Library", "Application Support");
  else base = path.join(os.homedir(), ".config");
  const dir = path.join(base, "Typographus");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return os.tmpdir();
  }
  return dir;
}
function licensePath() {
  return path.join(licenseDir(), "license.typographus");
}

function readToken() {
  try {
    return fs.readFileSync(licensePath(), "utf8").trim();
  } catch {
    return null;
  }
}
function saveToken(token) {
  try {
    fs.writeFileSync(licensePath(), String(token).trim(), "utf8");
    return true;
  } catch {
    return false;
  }
}
function removeToken() {
  try {
    fs.unlinkSync(licensePath());
  } catch {
    /* ignore */
  }
}

/* ---- public API ---- */
function verifyToken(token, hwid) {
  try {
    const payload = decodeVerify(token);
    if (payload.hwid && payload.hwid !== hwid) {
      return { valid: false, message: `Licenza per un altro dispositivo (locale: ${hwid})` };
    }
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return { valid: false, message: "Licenza scaduta" };
    }
    const exp = payload.exp ? new Date(payload.exp * 1000).toLocaleDateString("it-IT") : "perpetua";
    return { valid: true, message: `Attiva (scadenza: ${exp})`, plan: payload.plan || "Full", exp };
  } catch (e) {
    return { valid: false, message: e.message || "Token non valido" };
  }
}

function status() {
  const hwid = getHWID();
  const token = readToken();
  if (!token) return { valid: false, message: "Nessuna licenza presente", hwid };
  return { ...verifyToken(token, hwid), hwid };
}

function activate(token) {
  const hwid = getHWID();
  const res = verifyToken(token, hwid);
  if (res.valid) saveToken(token);
  return { ...res, hwid };
}

module.exports = { getHWID, status, activate, verifyToken, signToken, removeToken, LICENSE_SECRET };
