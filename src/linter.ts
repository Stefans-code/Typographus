/* =========================================================================
   House-style linter — detects typographic issues and offers fixes.
   Fixes skip fenced code blocks and inline code spans.
   ========================================================================= */

import { smartTypography } from "./typography";

export interface LintIssue {
  id: string;
  title: string;
  detail: string;
  count: number;
  severity: "warn" | "info";
  fix?: (source: string) => string;
}

/* Split source so we can apply fixes only outside code. */
function mapOutsideCode(source: string, fn: (chunk: string) => string): string {
  // protect fenced blocks ``` ``` and inline `code`
  const parts = source.split(/(```[\s\S]*?```|`[^`]*`)/g);
  return parts.map((p, i) => (i % 2 === 0 ? fn(p) : p)).join("");
}
function countOutsideCode(source: string, re: RegExp): number {
  let total = 0;
  mapOutsideCode(source, (chunk) => {
    total += (chunk.match(re) || []).length;
    return chunk;
  });
  return total;
}

export function lint(source: string): LintIssue[] {
  const issues: LintIssue[] = [];

  const straightDouble = countOutsideCode(source, /"/g);
  if (straightDouble > 0)
    issues.push({
      id: "straight-quotes",
      title: "Virgolette dritte",
      detail: `${straightDouble} virgolette dritte (") da convertire in “ ”.`,
      count: straightDouble,
      severity: "warn",
      fix: (s) => mapOutsideCode(s, smartTypography),
    });

  const straightApos = countOutsideCode(source, /'/g);
  if (straightApos > 0)
    issues.push({
      id: "straight-apos",
      title: "Apostrofi dritti",
      detail: `${straightApos} apostrofi dritti (') da convertire in ’.`,
      count: straightApos,
      severity: "warn",
      fix: (s) => mapOutsideCode(s, smartTypography),
    });

  const ellipsis = countOutsideCode(source, /\.\.\./g);
  if (ellipsis > 0)
    issues.push({
      id: "ellipsis",
      title: "Tre punti",
      detail: `${ellipsis} sequenze "..." da sostituire con il carattere …`,
      count: ellipsis,
      severity: "info",
      fix: (s) => mapOutsideCode(s, (c) => c.replace(/\.\.\./g, "…")),
    });

  const dblHyphen = countOutsideCode(source, /(?<!-)--(?!-)/g);
  if (dblHyphen > 0)
    issues.push({
      id: "dbl-hyphen",
      title: "Doppio trattino",
      detail: `${dblHyphen} "--" da convertire in trattino medio –`,
      count: dblHyphen,
      severity: "info",
      fix: (s) => mapOutsideCode(s, (c) => c.replace(/(?<!-)--(?!-)/g, "–")),
    });

  const doubleSpace = countOutsideCode(source, /\S  +/g);
  if (doubleSpace > 0)
    issues.push({
      id: "double-space",
      title: "Spazi doppi",
      detail: `${doubleSpace} punti con spazi multipli da normalizzare.`,
      count: doubleSpace,
      severity: "warn",
      fix: (s) => mapOutsideCode(s, (c) => c.replace(/(\S) {2,}/g, "$1 ")),
    });

  const spaceBeforePunct = countOutsideCode(source, /\s+[,.;:](?=\s|$)/g);
  if (spaceBeforePunct > 0)
    issues.push({
      id: "space-before-punct",
      title: "Spazio prima di punteggiatura",
      detail: `${spaceBeforePunct} spazi prima di , . ; : da rimuovere.`,
      count: spaceBeforePunct,
      severity: "warn",
      fix: (s) => mapOutsideCode(s, (c) => c.replace(/[ \t]+([,.;:])(?=\s|$)/g, "$1")),
    });

  const repeatedBang = countOutsideCode(source, /[!?]{2,}/g);
  if (repeatedBang > 0)
    issues.push({
      id: "repeated-bang",
      title: "Punteggiatura enfatica",
      detail: `${repeatedBang} sequenze "!!" / "??" — sconsigliate nella prosa giornalistica.`,
      count: repeatedBang,
      severity: "info",
    });

  const trailing = (source.match(/[ \t]+$/gm) || []).length;
  if (trailing > 0)
    issues.push({
      id: "trailing-space",
      title: "Spazi a fine riga",
      detail: `${trailing} righe con spazi finali.`,
      count: trailing,
      severity: "info",
      fix: (s) => s.replace(/[ \t]+$/gm, ""),
    });

  return issues;
}
