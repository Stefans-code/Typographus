import { describe, it, expect } from "vitest";
import { paraphrase } from "./paraphraser";

const IT_SAMPLE = `Il progetto è iniziato nel 2021 e ha coinvolto 45 persone. Secondo Rossi (2020), il metodo utilizzato ha permesso di ottenere risultati importanti. "Non cambieremo una virgola di questo accordo", ha dichiarato l'amministratore delegato. Per maggiori informazioni visita https://esempio.it/pagina oppure scrivi a info@esempio.it. Il documento [1] descrive il problema in modo semplice, e propone una soluzione fondamentale per il 12% dei casi.`;

const EN_SAMPLE = `The project began in 2021 and involved 45 people. According to Rossi (2020), the method used allowed the team to obtain important results. "We will not change a comma of this agreement," said the CEO. For more information visit https://example.com/page or write to info@example.com. The document [1] describes the problem in a simple way, and proposes a key solution for 12% of the cases.`;

function extractNumbers(s: string): string[] {
  return (s.match(/\d[\d.,:/%]*/g) || []).sort();
}
function extractUrls(s: string): string[] {
  return (s.match(/https?:\/\/[^\s)]+/g) || []).sort();
}
function extractQuotes(s: string): string[] {
  return (s.match(/"[^"]*"/g) || []).sort();
}
function extractBrackets(s: string): string[] {
  return (s.match(/\[\d+(?:\s*[-,]\s*\d+)*\]/g) || []).sort();
}

describe("paraphrase() — guardie (contenuto intoccabile)", () => {
  it("preserva numeri, percentuali e anni identici", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1 });
    expect(extractNumbers(res.text)).toEqual(extractNumbers(IT_SAMPLE));
  });

  it("preserva URL ed email esattamente", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1 });
    expect(extractUrls(res.text)).toEqual(extractUrls(IT_SAMPLE));
    expect(res.text).toContain("info@esempio.it");
  });

  it("preserva le citazioni testuali fra virgolette parola per parola", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1 });
    expect(extractQuotes(res.text)).toEqual(extractQuotes(IT_SAMPLE));
  });

  it("preserva i riferimenti bibliografici numerici [1]", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1 });
    expect(extractBrackets(res.text)).toEqual(extractBrackets(IT_SAMPLE));
  });

  it("preserva i nomi propri (es. Rossi)", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1, seed: 42 });
    expect(res.text).toContain("Rossi");
  });

  it("non lascia segnaposto di protezione orfani nell'output", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1, seed });
      expect(res.text).not.toMatch(/[]/);
    }
  });

  it("rispetta un glossario di termini tecnici forniti dall'utente", () => {
    const text = "Il framework utilizza un algoritmo di scheduling per migliorare le prestazioni del sistema.";
    const res = paraphrase(text, { lang: "it", level: 1, protectTerms: ["framework", "scheduling"] });
    expect(res.text).toMatch(/\bframework\b/i);
    expect(res.text).toMatch(/\bscheduling\b/i);
  });
});

describe("paraphrase() — formattazione", () => {
  it("preserva blocchi di codice e non li tocca", () => {
    const text = "Testo normale con molte parole importanti da cambiare.\n```\nconst x = utilizzare(1);\n```\nAltro testo importante.";
    const res = paraphrase(text, { lang: "it", level: 1 });
    expect(res.text).toContain("```\nconst x = utilizzare(1);\n```");
  });

  it("preserva titoli, elenchi puntati e citazioni Markdown", () => {
    const text = "# Titolo importante\n\n- primo punto importante\n- secondo punto importante\n\n> una citazione importante";
    const res = paraphrase(text, { lang: "it", level: 1 });
    const lines = res.text.split("\n");
    expect(lines[0].startsWith("# ")).toBe(true);
    expect(lines[2].startsWith("- ")).toBe(true);
    expect(lines[3].startsWith("- ")).toBe(true);
    expect(lines[5].startsWith(">")).toBe(true);
  });

  it("preserva il numero di righe e le righe vuote", () => {
    const text = "Prima riga importante.\n\nSeconda riga importante.\n\nTerza riga importante.";
    const res = paraphrase(text, { lang: "it", level: 0.8 });
    expect(res.text.split("\n").length).toBe(text.split("\n").length);
  });

  it("preserva link e grassetto Markdown intatti", () => {
    const text = "Leggi il [documento importante](https://esempio.it/doc) e nota il **punto fondamentale**.";
    const res = paraphrase(text, { lang: "it", level: 1 });
    expect(res.text).toContain("[documento importante](https://esempio.it/doc)");
    expect(res.text).toContain("**punto fondamentale**");
  });
});

describe("paraphrase() — livello di trasformazione", () => {
  it("a livello 0 restituisce il testo identico", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 0 });
    expect(res.text).toBe(IT_SAMPLE);
    expect(res.changedRatio).toBe(0);
  });

  it("a livello alto modifica più parole di livello basso (in media)", () => {
    let lowChanges = 0;
    let highChanges = 0;
    for (let seed = 0; seed < 8; seed++) {
      lowChanges += paraphrase(IT_SAMPLE, { lang: "it", level: 0.15, seed }).changedRatio;
      highChanges += paraphrase(IT_SAMPLE, { lang: "it", level: 0.95, seed }).changedRatio;
    }
    expect(highChanges).toBeGreaterThan(lowChanges);
  });

  it("è deterministico: stesso testo e stesso seed producono lo stesso output", () => {
    const a = paraphrase(IT_SAMPLE, { lang: "it", level: 0.6, seed: 7 });
    const b = paraphrase(IT_SAMPLE, { lang: "it", level: 0.6, seed: 7 });
    expect(a.text).toBe(b.text);
  });

  it("semi diversi possono produrre varianti diverse (non è un unico output fisso)", () => {
    const outs = new Set<string>();
    for (let seed = 0; seed < 6; seed++) {
      outs.add(paraphrase(IT_SAMPLE, { lang: "it", level: 0.9, seed }).text);
    }
    expect(outs.size).toBeGreaterThan(1);
  });
});

describe("paraphrase() — conservazione del significato (proxy automatico)", () => {
  it("mantiene un'alta sovrapposizione lessicale di contenuto anche a livello massimo (IT)", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1, seed: 3 });
    expect(res.similarity).toBeGreaterThan(0.55);
  });

  it("mantiene un'alta sovrapposizione lessicale di contenuto anche a livello massimo (EN)", () => {
    const res = paraphrase(EN_SAMPLE, { lang: "en", level: 1, seed: 3 });
    expect(res.similarity).toBeGreaterThan(0.55);
  });

  it("non altera drasticamente la lunghezza del testo", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1, seed: 9 });
    const ratio = res.text.length / IT_SAMPLE.length;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.6);
  });
});

describe("paraphrase() — intensità lessicale e strutturale indipendenti", () => {
  it("intensità strutturale=1, lessicale=0: il vocabolario non cambia", () => {
    const text = "Il problema è capire come procedere, e trovare una soluzione fondamentale.";
    const res = paraphrase(text, { lang: "it", lexicalIntensity: 0, structuralIntensity: 1, seed: 5 });
    expect(res.text).toMatch(/\bproblema\b/i);
    expect(res.text).toMatch(/\bfondamentale\b/i);
    expect(res.text).toMatch(/\bsoluzione\b/i);
  });

  it("intensità lessicale=1, strutturale=0: l'ordine delle clausole non cambia mai", () => {
    const text = "Il problema è capire come procedere, e trovare una soluzione fondamentale.";
    for (let seed = 0; seed < 10; seed++) {
      const res = paraphrase(text, { lang: "it", lexicalIntensity: 1, structuralIntensity: 0, seed });
      expect(/^(il|l')/i.test(res.text.trim())).toBe(true);
    }
  });

  it("riduce gli incipit di frase ripetuti quando l'intensità strutturale è alta", () => {
    const text =
      "Il gatto dorme, e il cane corre. Il sole splende, e la pioggia cade. Il vento soffia, e la neve scende.";
    const allSameStart = (t: string) => {
      const starts = t
        .split(/(?<=[.!?])\s+/)
        .map((s) => (s.match(/[\p{L}]+/u) || [""])[0].toLowerCase())
        .filter(Boolean);
      return starts.every((s) => s === starts[0]);
    };
    let variedAtLeastOnce = false;
    for (let seed = 0; seed < 12; seed++) {
      const res = paraphrase(text, { lang: "it", lexicalIntensity: 0, structuralIntensity: 1, seed });
      if (!allSameStart(res.text)) variedAtLeastOnce = true;
    }
    expect(variedAtLeastOnce).toBe(true);
  });
});

describe("paraphrase() — grammatica (accordo articolo/elisione)", () => {
  it("elide correttamente l'articolo davanti a un sinonimo che inizia per vocale (es. 'il problema' -> 'inconveniente')", () => {
    let sawInconveniente = false;
    for (let seed = 0; seed < 30; seed++) {
      const res = paraphrase("Il problema principale è capire come procedere.", { lang: "it", level: 1, seed });
      expect(res.text).not.toMatch(/\bil inconveniente\b/i);
      expect(res.text).not.toMatch(/\bIl inconveniente\b/);
      if (/inconveniente/i.test(res.text)) sawInconveniente = true;
    }
    expect(sawInconveniente).toBe(true); // conferma che il caso è stato davvero esercitato
  });
});

describe("paraphrase() — robustezza / gestione errori", () => {
  it("non lancia mai eccezioni e gestisce l'input vuoto", () => {
    expect(() => paraphrase("")).not.toThrow();
    expect(paraphrase("").text).toBe("");
  });

  it("gestisce input con solo spazi o punteggiatura senza andare in errore", () => {
    expect(() => paraphrase("   \n\n   ")).not.toThrow();
    expect(() => paraphrase("!!! ??? ...")).not.toThrow();
  });

  it("gestisce testo molto ripetuto senza andare in errore o in loop", () => {
    const text = Array(200).fill("importante").join(" ") + ".";
    expect(() => paraphrase(text, { level: 1 })).not.toThrow();
  });

  it("gestisce caratteri Unicode ed emoji senza corromperli", () => {
    const text = "Il caffè è importante ☕ per la produttività, e per l'umore 😊 di tutti.";
    const res = paraphrase(text, { lang: "it", level: 1 });
    expect(res.text).toContain("☕");
    expect(res.text).toContain("😊");
    expect(res.text).toContain("caffè");
  });

  it("non produce mai testo vuoto a fronte di un input non vuoto", () => {
    const res = paraphrase(IT_SAMPLE, { lang: "it", level: 1 });
    expect(res.text.trim().length).toBeGreaterThan(0);
  });
});
