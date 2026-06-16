/* Sample editorial document — demonstrates front-matter, pull quotes,
   figures with caption/credit, footnotes, drop cap, multi-section flow. */

export const SAMPLE_FRONT = {
  kicker: "Inchiesta · Cultura della stampa",
  headline: "L'inchiostro che non muore",
  deck: "Mentre il digitale divora l'attenzione, una nuova generazione di editori riscopre il peso della carta e la precisione del carattere tipografico.",
  author: "di Elena Vasari",
  dateline: "MILANO — 15 giugno 2026",
  section: "Cultura",
};

export const SAMPLE_TITLE = "Inchiesta — L'inchiostro che non muore";

export const SAMPLE_MD = `Per più di un decennio gli analisti hanno scritto il necrologio della carta stampata. Eppure, nelle redazioni più piccole e nelle case editrici indipendenti d'Europa, qualcosa si muove in direzione contraria: una riscoperta ostinata della pagina fisica, dell'oggetto-libro, del giornale che si piega e si conserva.

La ragione, sostengono i protagonisti di questo ritorno, non è nostalgia. È **economia dell'attenzione**. Dove lo schermo frammenta, la carta concentra; dove il feed scorre all'infinito, la pagina ha un margine, un bordo, una fine.

## Una questione di precisione

Comporre una pagina non è disporre parole su uno sfondo. È un esercizio di geometria e ritmo: la *gabbia*, l'interlinea, la spaziatura ottica, il controllo delle righe vedove e orfane. Dettagli invisibili al lettore distratto, decisivi per quello attento.

:::pullquote
La buona tipografia è come l'aria condizionata: te ne accorgi solo quando funziona male.
:::

Negli ultimi anni una manciata di strumenti software ha provato a democratizzare questo sapere, portando regole un tempo riservate ai tipografi professionisti dentro flussi di lavoro accessibili a chiunque sappia scrivere in Markdown.[^1]

![Banco tipografico con caratteri mobili in piombo.](placeholder "Caratteri mobili in una tipografia storica milanese. | Foto: Archivio Typographus")

### Dal manoscritto all'impaginato

Il passaggio critico resta la conversione: trasformare una bozza testuale in un impaginato pronto per la stampa senza posizionare manualmente ogni elemento. La sillabazione multilingua, le legature, la gestione dei crocini di registro e dell'abbondanza al vivo sono oggi automatizzabili.

> Non vogliamo sostituire il tipografo. Vogliamo dargli dieci ore in più alla settimana per fare il lavoro che conta davvero.

Resta il nodo del colore. La stampa professionale ragiona in CMYK, con profili ICC incorporati; lo schermo mente sempre un po'. Per questo l'anteprima di separazione è diventata uno strumento di sopravvivenza per chi consegna file alla tipografia.

## Il futuro è ibrido

Nessuno crede davvero a un ritorno totale alla carta. Il punto è un altro: lo stesso sorgente — un file di testo — deve poter generare sia un PDF impeccabile per la rotativa sia un ePub validato per il lettore digitale.[^2]

Chi padroneggia entrambi i mondi, dicono in queste redazioni, non sta scegliendo tra passato e futuro. Sta semplicemente facendo bene il proprio mestiere.

[^1]: Il formato Markdown, ideato da John Gruber nel 2004, è oggi lo standard de facto per la scrittura strutturata.
[^2]: Lo standard EPUB 3 richiede un XHTML valido e un file di metadati conforme alle specifiche IDPF/W3C.
`;
