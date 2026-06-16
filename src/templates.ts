/* Document templates surfaced on the Home screen. Each seeds front-matter,
   a starter body and a few layout/typography settings. */

import type { FrontMatter, Settings } from "./state";

export interface Template {
  id: string;
  name: string;
  icon: string;
  desc: string;
  front: Partial<FrontMatter>;
  source: string;
  settings: Partial<Settings>;
}

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Documento vuoto",
    icon: "draft",
    desc: "Foglio bianco A4, una colonna.",
    front: { kicker: "", headline: "", deck: "", author: "", dateline: "", section: "" },
    source: "Inizia a scrivere qui…",
    settings: { columns: 1, dropcap: false },
  },
  {
    id: "article",
    name: "Articolo di giornale",
    icon: "newspaper",
    desc: "Testata, sommario, firma e capolettera.",
    front: {
      kicker: "Rubrica · Sezione",
      headline: "Titolo dell'articolo",
      deck: "Sommario in una o due righe che introduce il pezzo e invoglia alla lettura.",
      author: "di Nome Cognome",
      dateline: "CITTÀ — data",
      section: "Cronaca",
    },
    source:
      "Attacco del pezzo: la prima frase deve catturare il lettore e sintetizzare la notizia.\n\nSecondo paragrafo con i dettagli principali e il contesto.\n\n## Sottotitolo di sezione\n\nSviluppo dell'argomento.\n\n:::pullquote\nUna citazione di grande impatto messa in evidenza.\n:::\n\nChiusura del pezzo.",
    settings: { columns: 2, dropcap: true, align: "justify" },
  },
  {
    id: "essay",
    name: "Saggio / Libro",
    icon: "menu_book",
    desc: "Formato A5, impaginazione da volume.",
    front: { kicker: "", headline: "Titolo del capitolo", deck: "", author: "", dateline: "", section: "" },
    source:
      "# Titolo del capitolo\n\nIncipit del capitolo. Il testo scorre in una colonna, con margini ampi e interlinea generosa, secondo la tradizione del libro stampato.\n\n## Prima sezione\n\nCorpo del testo.[^1]\n\n[^1]: Nota a piè di documento.",
    settings: { pageSize: "A5", columns: 1, dropcap: true, marginLeft: 18, marginRight: 18, bodySize: 11 },
  },
  {
    id: "newsletter",
    name: "Newsletter",
    icon: "mail",
    desc: "Layout a due colonne, tono diretto.",
    front: {
      kicker: "Numero #1",
      headline: "La newsletter",
      deck: "Cosa è successo questa settimana, in breve.",
      author: "La redazione",
      dateline: "",
      section: "Settimanale",
    },
    source:
      "Benvenuti in questo numero.\n\n## In evidenza\n\n- Prima notizia\n- Seconda notizia\n- Terza notizia\n\n## Approfondimento\n\nTesto dell'approfondimento principale.",
    settings: { columns: 2, dropcap: false, align: "left", hyphens: false },
  },
  {
    id: "press",
    name: "Comunicato stampa",
    icon: "campaign",
    desc: "Una colonna, intestazione formale.",
    front: {
      kicker: "Comunicato stampa",
      headline: "Titolo del comunicato",
      deck: "Sottotitolo che riassume l'annuncio.",
      author: "Ufficio stampa",
      dateline: "CITTÀ, data",
      section: "Per diffusione immediata",
    },
    source:
      "**CITTÀ, data** — Paragrafo di apertura con la notizia principale: chi, cosa, quando, dove e perché.\n\nParagrafo con dichiarazione virgolettata di un portavoce.\n\n## Informazioni\n\nDettagli aggiuntivi e contatti.\n\n---\n\nPer informazioni: ufficiostampa@esempio.it",
    settings: { columns: 1, dropcap: false, align: "left" },
  },
];
