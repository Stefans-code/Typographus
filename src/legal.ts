/* Legal / licensing content shown inside the app (mirrors LICENSE). */

export const COMPANY = {
  name: "Nexflamma",
  product: "Typographus",
  version: "0.1",
  office: "Sede legale in fase di registrazione",
  rea: "REA in fase di registrazione",
  vat: "P.IVA in fase di registrazione",
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
    body: "Nexflamma concede una licenza non esclusiva, non trasferibile e revocabile per installare ed eseguire Typographus secondo la durata e il numero di postazioni acquistati. Il Software è concesso in licenza, non venduto. In abbonamento la licenza vale per il periodo pagato: dopo la disdetta resta attiva fino alla fine di quel periodo e poi cessa. Ove richiesto, l'esecuzione può prevedere la validazione crittografica del nodo tramite impronta hardware (HWID).",
  },
  {
    n: "2",
    title: "Diritto di recesso",
    body: "Ai sensi dell'art. 59, lett. o) del Codice del Consumo (D.Lgs. 206/2005), trattandosi di contenuti digitali forniti subito, il recesso di 14 giorni non si applica se al momento dell'acquisto l'utente ha chiesto espressamente l'esecuzione immediata e ha riconosciuto di perdere così il diritto di recesso. Nexflamma offre comunque una garanzia di rimborso commerciale di 72 ore (3 giorni) dall'acquisto.",
  },
  {
    n: "3",
    title: "Restrizioni e tuoi contenuti",
    body: "È vietato eludere il sistema di licenze HWID, decompilare o effettuare reverse engineering, trasferire o sublicenziare le attivazioni a nodi non autorizzati. I documenti, gli impaginati e i file creati dall'utente restano di esclusiva proprietà dell'utente: Nexflamma non vanta alcun diritto sui contenuti editoriali prodotti.",
  },
  {
    n: "4",
    title: "Proprietà intellettuale",
    body: "Il Software, il codice sorgente, il design system e i marchi «Typographus» e «Nexflamma» sono e restano di proprietà esclusiva di Nexflamma. I componenti open-source di terze parti sono concessi secondo le rispettive licenze (vedi THIRD-PARTY-NOTICES).",
  },
  {
    n: "5",
    title: "Garanzia e responsabilità",
    body: "Nei limiti di legge il Software è fornito «così com'è». Nexflamma non risponde di danni indiretti o consequenziali, salvo dolo o colpa grave. Le funzioni di intelligenza artificiale (riscrittura, parafrasi, controlli) generano risultati che possono essere errati: vanno verificati. Restano impregiudicati i diritti inderogabili del consumatore, compresa la garanzia legale di conformità dei contenuti digitali (Codice del Consumo).",
  },
  {
    n: "6",
    title: "Privacy (GDPR)",
    body: "Nexflamma è Titolare del trattamento ai sensi del Reg. (UE) 2016/679. Typographus salva documenti e preferenze sul dispositivo. Per la licenza invia a Nexflamma un identificativo hardware (HWID) e controlla gli aggiornamenti. I contenuti escono dal computer solo quando usi una funzione che lo richiede: pubblicare un modello nella community (salvato da Nexflamma insieme al tuo account), creare un link di condivisione (il documento viene caricato su file.io, servizio di terzi, per 7 giorni), aprire il documento in Overleaf o pubblicarlo sul tuo sito WordPress (inviato a quei servizi). Dettagli su nexflamma.net/#/privacy. Per esercitare i diritti (artt. 15-22 GDPR) scrivere a " + COMPANY.dpo + ".",
  },
  {
    n: "7",
    title: "Legge applicabile e foro",
    body: "I presenti termini sono regolati dalla legge italiana. Foro competente: quello della sede di Nexflamma; se l'utente è un consumatore, quello del suo luogo di residenza o domicilio.",
  },
];
