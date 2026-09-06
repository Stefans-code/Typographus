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
  {
    id: "novel",
    name: "Romanzo",
    icon: "auto_stories",
    desc: "Formato A5 da volume, capolettera.",
    front: { headline: "Capitolo primo" },
    source:
      "# Capitolo primo\n\nEra una notte buia e tempestosa. L'incipit di un romanzo apre il mondo: voce, ritmo, promessa.\n\nIl secondo paragrafo entra nella scena e nei personaggi.\n\n* * *\n\nUno stacco di scena separa due momenti della narrazione.",
    settings: { pageSize: "A5", columns: 1, dropcap: true, bodySize: 11, leading: 1.55, marginLeft: 18, marginRight: 18, bodyFont: "serif" },
  },
  {
    id: "thesis",
    name: "Tesi accademica",
    icon: "school",
    desc: "Una colonna, note e bibliografia.",
    front: { headline: "Titolo della tesi", deck: "Relatore · Anno accademico", author: "Candidato" },
    source:
      "# Introduzione\n\nQuesto lavoro indaga…[@autore2020]\n\n## Stato dell'arte\n\nLa letteratura esistente mostra…[@bianchi2019]\n\n## Metodologia\n\nDescrizione del metodo.\n\n[^1]: Nota metodologica.",
    settings: { pageSize: "A4", columns: 1, dropcap: false, align: "justify", bodySize: 12, leading: 1.6, marginLeft: 30, marginRight: 25 },
  },
  {
    id: "magazine",
    name: "Rivista / Magazine",
    icon: "import_contacts",
    desc: "Tre colonne, layout ricco.",
    front: { kicker: "Reportage", headline: "Titolo del servizio", deck: "Sommario d'effetto del servizio di copertina.", author: "di Autore", section: "Cultura" },
    source:
      "Attacco del servizio con un'immagine forte e una frase che cattura.\n\n:::pullquote\nLa citazione che diventa il cuore visivo della pagina.\n:::\n\n## Sottotitolo\n\nProsecuzione del testo su più colonne.",
    settings: { pageSize: "A4", columns: 3, columnGap: 5, dropcap: true, align: "justify" },
  },
  {
    id: "poetry",
    name: "Raccolta di poesie",
    icon: "format_quote",
    desc: "A5, a bandiera, niente rientri.",
    front: { headline: "Titolo della raccolta", author: "Poeta" },
    source:
      "# Senza titolo\n\nVerso primo che resta sospeso\nverso secondo che scende piano\n\nstrofa nuova dopo il bianco\nche conta quanto le parole.",
    settings: { pageSize: "A5", columns: 1, dropcap: false, align: "left", hyphens: false, paraIndent: 0, bodyFont: "display", bodySize: 12, leading: 1.7 },
  },
  {
    id: "recipe",
    name: "Ricettario",
    icon: "restaurant",
    desc: "Due colonne, ingredienti + passi.",
    front: { kicker: "Primi piatti", headline: "Nome della ricetta", deck: "4 persone · 40 minuti · facile" },
    source:
      "## Ingredienti\n\n- 320 g di pasta\n- 2 spicchi d'aglio\n- olio extravergine\n- prezzemolo\n\n## Preparazione\n\n1. Porta a bollore l'acqua salata.\n2. Soffriggi l'aglio nell'olio.\n3. Manteca e servi.",
    settings: { pageSize: "A5", columns: 2, columnGap: 6, dropcap: false, align: "left", hyphens: false },
  },
  {
    id: "letter",
    name: "Lettera formale",
    icon: "mail",
    desc: "Una colonna, impostazione classica.",
    front: { headline: "", author: "Nome Cognome", dateline: "Città, data" },
    source:
      "Spett.le Destinatario,\n\ncon la presente desidero…\n\nResto a disposizione per ogni chiarimento e porgo cordiali saluti.\n\nNome Cognome",
    settings: { pageSize: "A4", columns: 1, dropcap: false, align: "left", hyphens: false, bodySize: 11 },
  },
  {
    id: "brochure",
    name: "Brochure / Volantino",
    icon: "ad",
    desc: "Due colonne, testo breve d'impatto.",
    front: { kicker: "Evento", headline: "Titolo della brochure", deck: "Una riga che invita all'azione." },
    source:
      "## Cosa\n\nDescrizione breve e diretta.\n\n## Quando\n\nData e orario.\n\n## Dove\n\nLuogo e indirizzo.\n\n:::pullquote\nNon mancare!\n:::",
    settings: { pageSize: "A4", columns: 2, dropcap: false, align: "left", hyphens: false },
  },
  {
    id: "cv",
    name: "Curriculum Vitae",
    icon: "contact_page",
    desc: "Layout pulito per valorizzare competenze ed esperienze.",
    front: {
      kicker: "Curriculum Vitae",
      headline: "Nome Cognome",
      deck: "Specializzazione / Professione",
      author: "contatto@email.it · +39 333 123456",
      dateline: "Milano, Italia",
      section: "Profilo Professionale",
    },
    source: "## Esperienze Professionali\n\n**Ruolo / Posizione** — Azienda (Periodo)\n- Descrizione delle mansioni svolte e risultati raggiunti.\n- Gestione progetti e coordinamento team.\n\n**Altro Ruolo** — Altra Azienda (Periodo)\n- Descrizione attività.\n\n## Formazione e Studi\n\n**Titolo di Studio / Laurea** — Università (Anno)\n- Dettagli sul percorso e voto di laurea.\n\n## Competenze\n\n- Competenze tecniche principali\n- Capacità organizzative e gestionali\n- Lingue parlate",
    settings: { pageSize: "A4", columns: 1, dropcap: false, align: "left", bodySize: 10, leading: 1.45, marginLeft: 24, marginRight: 24 },
  },
  {
    id: "report",
    name: "Rapporto Aziendale",
    icon: "analytics",
    desc: "Struttura per relazioni formali, bilanci o analisi.",
    front: {
      kicker: "Rapporto Annuale",
      headline: "Analisi delle Performance",
      deck: "Sintesi dei risultati aziendali conseguiti nell'anno fiscale corrente.",
      author: "Dipartimento Ricerca & Sviluppo",
      dateline: "Giugno 2026",
      section: "Documento Riservato",
    },
    source: "## Sintesi Esecutiva\n\nIl presente rapporto illustra i dati relativi alle performance operative della società. I risultati indicano una crescita costante nei settori chiave.[^1]\n\n## Risultati per Divisione\n\n- **Divisione A:** +15% di crescita anno su anno.\n- **Divisione B:** Consolidamento della quota di mercato.\n- **Divisione C:** Espansione dei canali digitali.\n\n:::pullquote\nIl traguardo principale è stato il raggiungimento dell'efficienza energetica nei nostri impianti.\n:::\n\n## Conclusioni e Raccomandazioni\n\nSi raccomanda di proseguire gli investimenti nella digitalizzazione dei processi.\n\n[^1]: Dati certificati dall'ente di revisione esterno.",
    settings: { pageSize: "A4", columns: 1, dropcap: false, align: "justify", bodySize: 11, leading: 1.5, marginLeft: 26, marginRight: 22 },
  },
  {
    id: "technical",
    name: "Manuale Tecnico",
    icon: "build",
    desc: "Layout a due colonne per documentazione, guide e codice.",
    front: {
      kicker: "Guida di Riferimento",
      headline: "Installazione e Configurazione",
      deck: "Manuale per amministratori di sistema sulla configurazione dei server.",
      author: "Team Infrastruttura",
      dateline: "Versione 2.4",
      section: "Ingegneria",
    },
    source: "## Requisiti di Sistema\n\nPrima di procedere all'installazione, verificare la presenza dei seguenti pacchetti:\n- Python 3.10 o superiore\n- PySide6\n- Node.js 18+\n\n## Configurazione Rapida\n\n1. Clonare il repository di installazione.\n2. Eseguire la configurazione iniziale.\n3. Avviare il demone di servizio.\n\n:::pullquote\nAttenzione: non avviare il servizio come utente amministratore (root) in produzione.\n:::\n\n## Troubleshooting\n\nIn caso di errore di connessione, controllare che la porta standard sia aperta nel firewall locale.",
    settings: { pageSize: "A4", columns: 2, columnGap: 7, dropcap: false, align: "left", bodySize: 10, leading: 1.4, marginLeft: 20, marginRight: 20 },
  },
  {
    id: "menu",
    name: "Menu Ristorante",
    icon: "restaurant",
    desc: "Elegante menu in formato A5 per piatti e bevande.",
    front: {
      kicker: "La Nostra Cucina",
      headline: "Menu del Giorno",
      deck: "Ingredienti biologici del territorio e preparazioni artigianali.",
      author: "Chef Esecutivo",
      dateline: "Stagione Estiva",
      section: "Ristorante Il Ciliegio",
    },
    source: "## Antipasti\n\n**Tagliere Rustico** — €14\n*Selezione di salumi e formaggi locali serviti con miele e confetture*\n\n**Fiori di Zucca Dorati** — €10\n*Ripieni di ricotta fresca ed erbe di campo su specchio di pomodoro*\n\n## Primi Piatti\n\n**Tonnarelli cacio e pepe** — €12\n*Pasta fresca all'uovo mantecata con pecorino romano DOP e pepe nero in grani*\n\n**Risotto ai Funghi Porcini** — €16\n*Riso Carnaroli sfumato al vino bianco e mantecato al burro di malga*\n\n## Dessert\n\n**Tiramisù classico** — €6\n*Mascarpone artigianale e savoiardi bagnati nel caffè espresso*\n\n**Panna cotta ai Frutti di Bosco** — €6\n*Con salsa calda ai mirtilli e lamponi*",
    settings: { pageSize: "A5", columns: 1, dropcap: false, align: "left", paraIndent: 0, bodyFont: "serif", bodySize: 11.5, leading: 1.6, marginLeft: 16, marginRight: 16 },
  },
  {
    id: "screenplay",
    name: "Sceneggiatura",
    icon: "movie",
    desc: "Formato copione per registi e sceneggiatori.",
    front: { headline: "Titolo del film", author: "Sceneggiatura di Nome Cognome" },
    source:
      "INT. APPARTAMENTO – GIORNO\n\nLa luce filtra dalle persiane. MARIA (30) è seduta al tavolo, immobile.\n\n                    MARIA\n          Non possiamo più aspettare.\n\nLUCA entra dalla porta, ancora con il cappotto addosso.\n\n                    LUCA\n          Dammi solo un giorno.\n\nMaria si alza e va alla finestra.\n\nTAGLIO SU:\n\nEST. STRADA – NOTTE\n\nLe luci dei lampioni si riflettono sull'asfalto bagnato.",
    settings: { pageSize: "A4", columns: 1, dropcap: false, align: "left", hyphens: false, paraIndent: 0, bodyFont: "courier", bodySize: 12, leading: 1.5, marginLeft: 28, marginRight: 25 },
  },
];

export interface CommunityTemplate {
  id: string;
  name: string;
  icon: string;
  desc: string;
  front: any;
  source: string;
  settings: any;
  author?: string;
}

export function getCommunityTemplates(): CommunityTemplate[] {
  try {
    const raw = localStorage.getItem("typographus.community_templates.v1");
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  
  // Default mock templates if empty
  const defaults: CommunityTemplate[] = [
    {
      id: "comm-script-teatrale",
      name: "Script Teatrale",
      icon: "theater_comedy",
      desc: "Copione per atti e scene teatrali. Pubblicato da @regista_doc",
      front: { headline: "La Locandiera", author: "Atto Primo" },
      source: "SCENA I\n\nINT. LOCANDA — GIORNO\n\nMIRANDOLINA ordina i tavoli. FABRIZIO la osserva con ammirazione.",
      settings: { pageSize: "A4", columns: 1, bodyFont: "courier", bodySize: 12, leading: 1.5, dropcap: false }
    },
    {
      id: "comm-romanzo-gotico",
      name: "Romanzo Gotico",
      icon: "castle",
      desc: "Stile gotico, Newsreader display. Pubblicato da @scrittore_oscuro",
      front: { headline: "Il Castello delle Ombre" },
      source: "# Capitolo I\n\nIl vento ululava tra le torri di pietra scura dell'antico castello.",
      settings: { pageSize: "A5", columns: 1, bodyFont: "display", bodySize: 11, leading: 1.6, textColor: "#2f1f1f" }
    }
  ];
  
  try {
    localStorage.setItem("typographus.community_templates.v1", JSON.stringify(defaults));
  } catch (e) {}
  
  return defaults;
}

export function saveCommunityTemplate(t: CommunityTemplate) {
  const current = getCommunityTemplates();
  current.unshift(t);
  try {
    localStorage.setItem("typographus.community_templates.v1", JSON.stringify(current));
  } catch (e) {}
}

export function deleteCommunityTemplate(id: string) {
  const current = getCommunityTemplates().filter((x) => x.id !== id);
  try {
    localStorage.setItem("typographus.community_templates.v1", JSON.stringify(current));
  } catch (e) {}
}

