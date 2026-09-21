# Firma dell'installer Windows (SignPath)

La CI (`.github/workflows/build.yml`, job `windows`) firma `TypographusSetup.exe`
con [SignPath](https://signpath.io) **solo se** è presente il segreto
`SIGNPATH_API_TOKEN`. Senza segreto la build produce l'installer non firmato,
come prima.

> SignPath Foundation offre certificati gratuiti solo a progetti **open source**.
> Typographus è software proprietario (vedi `LICENSE`): per usare SignPath serve
> un piano a pagamento oppure un accordo con SignPath. Verifica prima di iniziare.

## 1. Configurazione su SignPath

1. Crea un'organizzazione e un **progetto** con slug `typographus`.
2. Collega il repository GitHub (trusted build system: GitHub.com).
3. Crea una **signing policy** con slug `release-signing`.
4. Crea una **artifact configuration** per il progetto (formato zip con un
   singolo file), ad esempio:

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="TypographusSetup.exe">
         <authenticode-sign/>
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

5. Crea un **API token** per l'utente CI, con permesso di sottomettere richieste
   alla policy `release-signing`.

## 2. Configurazione su GitHub (Settings → Secrets and variables → Actions)

| Tipo | Nome | Valore |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | il token del punto 5 |
| Variable | `SIGNPATH_ORGANIZATION_ID` | ID organizzazione (da SignPath) |
| Variable | `SIGNPATH_PROJECT_SLUG` | opzionale, default `typographus` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | opzionale, default `release-signing` |

## 3. Come funziona

1. La build produce `build_out/TypographusSetup.exe`.
2. L'installer non firmato viene caricato come artifact `Typographus-Windows-unsigned`.
3. SignPath lo firma e la CI lo scarica in `signed/`.
4. L'installer firmato sostituisce quello non firmato e viene pubblicato come
   artifact `Typographus-Windows`.

## Limiti

- Viene firmato solo l'installer. `Typographus.exe` (dentro l'installer) resta
  non firmato; per firmarlo servirebbe una prima richiesta di firma prima della
  fase NSIS.
- Se la policy di SignPath richiede approvazione manuale, il job resta in attesa
  finché qualcuno approva.
- Anche firmato, SmartScreen può avvisare finché il file non ha reputazione.
