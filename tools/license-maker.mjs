/* Typographus — license key generator (Nexflamma internal).
   Mints an offline JWT bound to a device HWID.

   Usage:
     node tools/license-maker.mjs <HWID> [days] [plan]
   Examples:
     node tools/license-maker.mjs A1B2C3D4E5F60718 365 Full
     node tools/license-maker.mjs A1B2C3D4E5F60718 0   Perpetua   (0 = nessuna scadenza)
*/

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const lic = require("../electron/license.cjs");

const [hwid, daysArg, planArg] = process.argv.slice(2);

if (!hwid) {
  console.error("Uso: node tools/license-maker.mjs <HWID> [giorni] [piano]");
  process.exit(1);
}

const days = daysArg === undefined ? 365 : Number(daysArg);
const plan = planArg || "Full";
const now = Math.floor(Date.now() / 1000);
const payload = {
  hwid,
  plan,
  iss: "Nexflamma S.r.l.",
  product: "Typographus",
  iat: now,
};
if (days > 0) payload.exp = now + days * 86400;

const token = lic.signToken(payload);

console.log("\nHWID:   ", hwid);
console.log("Piano:  ", plan);
console.log("Scadenza:", days > 0 ? new Date(payload.exp * 1000).toLocaleDateString("it-IT") : "perpetua");
console.log("\n--- CHIAVE DI LICENZA ---\n");
console.log(token);
console.log("");
