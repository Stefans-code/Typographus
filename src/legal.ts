/* Legal / licensing content shown inside the app (mirrors LICENSE). */

export const COMPANY = {
  name: "Nexflamma S.r.l.",
  product: "Typographus",
  version: "0.1",
  office: "Via della Seta 45, 20100 Milano (MI), Italia",
  rea: "REA MI-1234567",
  vat: "IT12345678901",
  email: "info@nexflamma.net",
  dpo: "privacy@nexflamma.net",
  year: 2026,
};

export const COPYRIGHT = `© ${COMPANY.year} ${COMPANY.name}`;

export interface EulaSection {
  n: string;
  title: string;
  body: string;
}

export const EULA_SECTIONS: EulaSection[] = [
  {
    n: "1",
    title: "Concessione della licenza",
    body: "Nexflamma S.r.l. concede una licenza non esclusiva, non trasferibile e revocabile per installare ed eseguire Typographus secondo la durata e il numero di postazioni acquistati. Il Software è concesso in licenza, non venduto. Ove richiesto, l'esecuzione può prevedere la validazione crittografica del nodo tramite impronta hardware (HWID).",
  },
  {
    n: "2",
    title: "Diritto di recesso",
    body: "Ai sensi dell'art. 59, lett. o) del Codice del Consumo (D.Lgs. 206/2005), trattandosi di contenuti digitali a download immediato, con l'attivazione della licenza l'utente rinuncia al recesso di 14 giorni. Nexflamma offre comunque una garanzia di rimborso commerciale di 72 ore (3 giorni) dall'acquisto.",
  },
  {
    n: "3",
    title: "Restrizioni e tuoi contenuti",
    body: "È vietato eludere il sistema di licenze HWID, decompilare o effettuare reverse engineering, trasferire o sublicenziare le attivazioni a nodi non autorizzati. I documenti, gli impaginati e i file creati dall'utente restano di esclusiva proprietà dell'utente: Nexflamma non vanta alcun diritto sui contenuti editoriali prodotti.",
  },
  {
    n: "4",
    title: "Proprietà intellettuale",
    body: "Il Software, il codice sorgente, il design system e i marchi «Typographus» e «Nexflamma» sono e restano di proprietà esclusiva di Nexflamma S.r.l. I componenti open-source di terze parti sono concessi secondo le rispettive licenze (vedi THIRD-PARTY-NOTICES).",
  },
  {
    n: "5",
    title: "Garanzia e responsabilità",
    body: "Il Software è fornito «così com'è», senza garanzie di alcun tipo. Nei limiti di legge, Nexflamma non risponde di danni indiretti o consequenziali. Restano impregiudicati i diritti inderogabili del consumatore previsti dal Codice del Consumo.",
  },
  {
    n: "6",
    title: "Privacy (GDPR)",
    body: "Nexflamma è Titolare del trattamento ai sensi del Reg. (UE) 2016/679. Typographus salva documenti e preferenze localmente sul dispositivo: nessun contenuto editoriale viene trasmesso a Nexflamma. Per esercitare i diritti (artt. 15-22 GDPR) scrivere a " + COMPANY.dpo + ".",
  },
  {
    n: "7",
    title: "Legge applicabile e foro",
    body: "I presenti termini sono regolati dalla legge italiana. Foro esclusivo: Milano, fatto salvo il foro inderogabile del consumatore. L'uso continuato del Software costituisce piena accettazione del presente contratto.",
  },
];
