# docs/qa — Sprint 6: sikkerhetstest og P0-gate

Kjørt 2026-10-12 mot den faktiske tjeneren (HTTP + PostgreSQL 16 i dev-beholderen
`punkgrid-pg`), ikke mot en etterligning. Alt uten skytjenester, uten betalende
leverandørkall og uten ekte API-nøkler: narrasjon måles mot `CompliantProvider`
og §10-grensen mot en lokal `node:http`-stub. Hemmeligheten i disse kjøringene er
en dev-hemmelighet, og den er aldri sendt noensteds bort.

Dette er den organiserte versjonen av det `STATUS.md` tidligere listet som
«tilgjeneliggende»: IDOR-matrise, injeksjon fra brukertekst, budsjett- og
rate-limit-missbruk, idempotens, og `/dev/token` som standard av.

## 0. Reprodusere

```powershell
cd "C:\Users\Rune W. Monrad\CascadeProjects\PunkGrid"
npm run typecheck
npx vitest run
```

Uten database: **203 passed | 23 skipped (226)**, og suiten skriver
`! Postgres suite SKIPPED` til stdout. Med database: **226 passed (226)**,
16 filer.

```powershell
$env:PUNKGRID_DB_URL  = "postgresql://postgres:punkgrid_dev_pw@localhost:54330/punkgrid"
$env:PUNKGRID_TEST_DB = "1"
npx vitest run
```

`PUNKGRID_TEST_DB=1` er et annet, villet samtykke: Postgres-settet TRUNCATEER
hele `punkgrid`-schemaet. Vi kjører ikke noe mot Supabase, Stripe eller Resend —
se «Grenser» nederst.

## 1. Hva som finnes av sikkerhetsangrep

`core/tests/security.test.ts` — 16 tilfeller, alltid på, over ekte sockets mot
sammenstillingen i `core/src/server/app.ts`. De tre egenskapene suiten prøver å
holde: (1) en fremmed verden er en verden som ikke finnes, (2) autorisering
skjer før noe annet leser eller svarer (§1.7), (3) nedgradering er lov,
opplysning er ikke.

| Linje | Tilfelle |
|---|---|
| `:134` | en fremmed verden på alle ni verdenrutene gir 404 og identisk legeme som et spøkelse-id |
| `:155` | en konto uten verden verken lister eller opplyser |
| `:163` | gjenbruker ikke en annen konto sin lagrede CommandResult |
| `:191` | utleverer ikke en modereringskvittering til feil konto |
| `:209` | et lånt commandId får ikke svar i det hele tatt, ikke 409 |
| `:232` | en `world.create`-kommandonøkkel leses bare av kontoen som skrev den (F-S8) |
| `:255` | en annen konto får ikke svar på den nøkkelen, heller ikke når legemet er identisk (F-S8) |
| `:283` | ni fiendtlige stier/legemer: ingen 500, ingen rad tapt |
| `:309` | anonymbanen strupes før noen autentiseres |
| `:333` | et forfalsket `x-forwarded-for` får ikke velge bøtte når proxyen ikke er betrodd |
| `:347` | med betrodd proxy er det det siste leddet — hoppen proxyen selv så — som strupes |
| `:359` | blueprint med instruks til fortelleren avvises, ingen verden oppstår |
| `:383` | blokkert kategori avvises på samme sted |
| `:398` | rapport av en scene skriver ikke til verdenen |
| `:424` | narrasjonsbudsjettet følger kontoen: én konto tærer ikke en annens |
| `:466` | `/dev/token` signerer aldri en konto prosessen ikke tillater |

`core/tests/pg.test.ts:810` — «security negatives as the deployed roles», fem
tilfeller ett lag dypere: `:832` RLS-les, `:863` app-rollens fravær av skrivebane,
`:888` rate limit-bøtten som skriver, `:927` ledger-immutabilitet, `:977` budsjett
per konto og over restart. `core/tests/pg.test.ts:1038` — «shared rate limit», fem
tilfeller om at bøtten er delt på tvers av prosesser (F-S6).
De 20 negative blokkene i `docs/architecture/migrations/validate_invariants.sql`
(30 `ok`-meldinger) er det tredje laget.

## 2. Funn som er rettet

### F-S1 — en lånt commandId ga en annen konto sitt svar (P0, alvorlig)

`executeCommand` slo opp lagrede kommandoresulter *før* medlemskapet ble
spurt. Med et `commandId` fra en annen spills verden kunne en inntrengende
konto få ut det faktiske CommandResult-et — hendelsesid-er, tilstandshash og
ny versjon.

Roten er at `requestHash` for verdenkommandoer dekker
`{kind, worldId, actorIdentityId, expectedWorldVersion, choiceId}`
(`engine.ts:393, 414, 466, 504, 518`) men **ikke** `actorUserId`, så
hashsammenligningen alene skilte aldri aktører.

Rettelse: oppslaget ligger inne i verdenslåsen, bak `authorizeWrite`
(`engine.ts:538-550`). Bevis: `security.test.ts:161` og `:207`.

### F-S2 — 403 på skriv var en eksistensorakel (P0, informasjon)

En fremmed verden besvart med 403 på `POST …/choices` mens samme verden ga 404
på lesing. Statuskoden alene fortalte hvilke verdener som finnes — §14s
lekkasjebasen handler om koder like mye som om legemer.

Rettelse: `authorizeWrite` svarer 404 (`engine.ts:1043-1049`). 403 blir
reservert `assertActorIdentity`, som kjører inne i en verden opprinneren
bevisebart kan se. Forventningen i `core/tests/api.test.ts:78` er skrevet om
til den nye semantikken, ikke bare slappet av.

### F-S3 — duplikatrapport utlevererte kvitteringen (P0, informasjon)

`reportEpisode` slo opp `moderationCases` på `commandId` før lesesjekken, så en
annen konto kunne få ut en rapport-id og et utdrag. Rettelse: `authorizeRead`
først (`engine.ts:188-189`). Bevis: `security.test.ts:189`.

### At testene faktisk bærer

De tre rettelsene ble målt baklengs: `core/src/engine.ts` ble reversert til
standen før fiksen (sikkerhetskopi `/tmp/engine.fixed.ts`), og
`core/tests/security.test.ts` gikk da på **4 failed | 8 passed (12)**.
Deretter ble den fikset versjonen gjenopprettet og hele suiten grønn. En grønn
angrepssuite som også er grønn med hullet på plass, er ingen test.

### F-S6 — rate limiten var per prosess og nøklet på proxy-adressen (P1, β)

`TokenBucket` holdt tilstand i minnet, og én enkelt bøtte-map sto for både
anonymbeskyttelsen og kontokvoten (`http.ts:96` og `http.ts:115`). To følger: med
N instanser bruker én konto kvoten sin N ganger, og bak en lastbalanser blir
«adressen» balanserens egen, altså én felles anonymbøtte for alle kunder.

Rettelsen er tre deler, én per beslutning:

* **Kvoten legges i Postgres.** Migrasjon `010_rate_limit.sql` har én rad per
  bøtte, og `punkgrid_rate_limit_take()` utfører hele take'et i SQL med
  `SELECT … FOR UPDATE`. Tidsstempelet er `statement_timestamp()`, altså
  databaseklokken og ikke prosessklokken; ellers ville to instanser med skjev
  klokke være uenige om påfyllingen, og det er nettopp den uenigheten delingen
  skal fjerne. Kjørebanen heter `core/src/server/pgRateLimit.ts`.
* **De to vaktene skilles.** `Limiters` (`rateLimit.ts:40`) har `addresses` og
  `accounts`. Anonymbøtten blir med vilje værende i prosessen: en uautentisert
  forespørsel som i tillegg skriver en database-rad, gjør vakten selv til et
  misbruksmål. Kontobøtten blir delt så snart `dbUrl` er satt
  (`core/src/server/app.ts:130`).
* **Adressen leses riktig.** `PUNKGRID_TRUST_PROXY=1` gir `x-forwarded-for`
  gyldighet, men bare som *siste* ledd: proxyen vår legger til hoppen den selv så,
  så et forfalsket `203.0.113.9` havner foran i listen og blir sett bort fra
  (`peerAddress` i `http.ts:232`). Av er standard, og da blir headeren ikke lest i
  det hele tatt.

Bevis (`pg.test.ts:1038`, fem tilfeller): to `buildApp`-prosesser over én database
gir **6** tillatte take av 10 forsøk — med per-prosess-bøtter gikk alle ti
gjennom; tolv samtidige take gir fortsatt 6, så det er radlåsen som holder og
ikke køen i testen; den delte bøtta og `TokenBucket` tar samme avgjøring i samme
rekkefølge; en kapasitet som krympes fra 8 til 1, gir ett take og nektet det
neste. `pg.test.ts:888` måler grantene som faktisk ligger på
disk: på en fersk database har `punkgrid_app` `arw` på tabellen (verken `D` eller
`T`), funksjonen er `prosecdef = f`, og et forsøk på å skrive en full bøtte
direkte stopper på `CHECK`-en (23514) heller enn på grant-listen.

Målt baklengs, som F-S1–F-S3: `app.ts:130` ble midlertidig satt tilbake til den
gamle, prosess-interne bøtta, og de tre første tilfellene i `pg.test.ts:1038` gikk
da på `expected [ …(10) ] to have a length of 6 but got 10`, `expected [ …(12) ] …
but got 12` og `expected [ true × 6 ] to deeply equal [ true, true, true, false,
false, false ]`. De to siste tilfellene ble ikke røde — de måler egenskapene som
skal bli værende uansett (anonymbøtta per prosess, og at et probe-take ruller
tilbake).

Prisen for kunden er én runde per autentiserte forespørsel, lokalt målt til
**p50 1,7–1,8 ms og max 12,4–13,5 ms** over fire kjøringer 2026-10-12
(`pg.test.ts:1075` skriver tallet til stdout). Hva det koster lesetiden i den
utplasserte formen, er målt i egen test (`pg.test.ts:736`, rapportert i
`docs/qa/STATUS.md`): p50 12,5–14,4 ms og p95 15,3–18,9 ms over 30 GET mot
Postgres-kanon med worker og delt bøtte på banen, mot p50 0,7 og p95 2,4–2,6 ms
for samme flyt i minnet. Begge er langt innenfor NFR-01.
Beslutningen er registrert som ADR-020, som erstatter ADR-016 §5 på dette
punktet.

Åpne avgrensninger, ikke skjulte: tabellen vokser med antall kontoer som har tatt
en bøtte, altså bundet av antall registrerte kontoer; det finnes ingen
TTL-fjerning, og den trengs først hvis nøkkelen noen gang blir noe annet enn en
konto-id. Anonymbøtta er fortsatt per instans, og det er en beslutning, ikke en
mangel.

## 3. Funn som ikke er rettet, men som alpha må kjenne

### F-S4 — RLS er en andre linje som ikke nås (P1, arkitektur)

Migrasjon 008 definerer `punkgrid_app`/`punkgrid_worker`/`punkgrid_owner`
(NOLOGIN), policyer for lesing og en `app.user_id`-GUC. Kjørebanen bruker dem
aldri: `createPool` har en `assumeRole`-parameter (`core/src/db/client.ts:19,24`)
som ingen bruker (verifisert: `grep -rn assumeRole core/src` treffer
bare client.ts), og ingen plass i `core/src` setter `app.user_id`.
`buildApp`/`Sessions` kobler med den ene innloggingsbrukeren som
connection-strengen gir, og i dev er det eieren av schemaet.

Konsekvens: som deployet i dag er lesing og skriving av kanon beskyttet av
autoriseringen i motoren, og *bare* av den. Det er §1.7s første linje, og den er
testet. Den andre linjen er korrekt skrevet men inert.

Det som ble målt da rollene faktisk ble brukt (`SET LOCAL ROLE`,
`pg.test.ts:810-1035`) — og som retter 008s egen kommentar:

* app-rollen: alle writes 42501 fra grant-listen, ennå før policyen; lesing
  krever `app.user_id`, ellers tomt.
* worker-rollen: `UPDATE` på ledger er **ingen feil** — RLS skjuler alle radene,
  så setningen lyktes med 0 rader og endret ingenting. `DELETE` er 42501
  (grant-listen stopper der den gir SELECT/INSERT/UPDATE).
* owner-rollen: eierskap går forbi RLS, og blir bare stoppet av
  append-only-/immutable-utløserne i 004/006. Det er den eneste grunnen til at
  historien ikke kan skrives om.

008s kommentar sier at «utløserne i 004 slår inn før rettigheter spørres».
Målt: RLS/ACL svarer først for worker, og utløserne er det som stopper eier.
Kommentaren er **ikke** rettet i filen: `migrate.ts:58-60` låser anvendte
migrasjoner med checksum, så en kommentarredigering ville nektet all
`npm run migrate` på en database som allerede har 008. Avviket er derfor ført i
`docs/architecture/migrations/README.md`.

Hva som skal til for å gjøre linjen levende (ikke en liten endring, og ikke noe
som bør gjøres i en α-helg): en skrivesesjon må dele identitet —
read-hydrering som `punkgrid_app` med `app.user_id` satt per transaksjon, og
kanonskriving som en tjenesteidentitet med policy for INSERT. I dag er en
kommando *én* transaksjon (ADR-006), så de to identitetene får ikke plass i den
samme enheten før enten (a) policyene utvides med INSERT/UPDATE for
tjenesterollen, eller (b) enheten splittes. Anbefaling: la dette være en
beslutning før flertenant-utplassering, og hold α på én prosess der motoren er
den eneste skriveren.

### F-S5 — gjenbruk av frø dropper en hendelse i stillhet (P1, drift)

`makeIdFactory` er ren og deterministisk per frø (`core/src/domain.ts:164-177`).
En ny prosess som starter mot en database som fortsatt holder rader fra forrige
prosess med *samme* frø, mynter `event_id`-er som allerede finnes;
`core/src/db/pgStore.ts:373` har `on conflict (event_id) do nothing`, så raden forsvinner
uten feilmelding, og ledger-utløseren slår inn på neste innsetting
(`world_seq must advance by exactly one (found 14, expected 13)`).
Regelen finnes allerede i kommentaren til `AppConfig.seed`
(`core/src/server/app.ts:32-34`), men den var ubeskyttet av test.
`pg.test.ts:977` starter prosessen som gjenopptar budsjettet med et nytt frø
(`SEED + 7`) og forklarer i kommentaren hvorfor det må til: med gammelt frø blir
den neste hendelsen en gap-feil. Startskriptet tar samme forholdsregel.

### F-S7 — `/dev/token` og `devUserIds` (P1, konfigurasjon)

En signert bearer-token for hvilken som helst navngitt konto.
`security.test.ts:413` viser at den svarer 404 når prosessen ikke er konfigurert
med en allowlist, og 403 for en konto som ikke står der. Den skal aldri
konfigureres i produksjon; i dag er den eneste autentiseringsporten en
HMAC-dev-port (ADR-016), og rotasjon/refresh/utlogging er utestet.

### F-S8 — `createWorld` slo opp kommandoen før autorisasjonen (P2, rest: statuskoden)

Ruta les no den lagrede kommandoen bak sjekken på at det er eiga rad: ein commandId
som ein annan konto skreiv, svarer 409 før innhaldet i raden er lest i det heile
(`engine.ts:270`). `security.test.ts:255` bygger tilstanden direkte på lageret — same
hash, framand eigar — og viser at utan denne sjekken får innblandaren den andre kontoen
sin `worldId` og `CommandResult`. `security.test.ts:232` viser det same over HTTP for
den kroppen ruta faktisk tek imot, og at eigaren sin replay framleis svarer med si eiga
verden.

Att står oraklet i statuskoden: ein commandId som finst, gir 409; ein som ikkje finst,
gir 201. Så lenge `command_id` er global primærnykel
(`migrations/005_commands.sql:9`), kan ikkje to kontoar bruke same nykel kvar sin, og
tilfella er berre skilbare ved å gi begge 201 — som krev at idempotensnykelen blir per
konto. Det er eit brot på §11 og ein ny migrasjon, og blir teken når idempotenslaget
byggjast om. Identifikatorane kjem frå `ids('cmd')` og er UUID-ar, så oraklet gir ei
ikkje-telbar mengd å gå igjennom.

### F-S9 — avhengighetskontroll i app-treet (P2, byggetid; én pakke målt i den sendte bundlen)

`npm audit` målt 2026-10-12: **rota (kjernen) 6** (2 critical, 1 high, 3
moderate) og **`apps/mobile` 28** (18 high, 10 moderate). Skillnaden viser
`npm audit --omit=dev`, målt i samme kjøring: **0 i rota**, **28 uendret i
`apps/mobile`**. De seks i kjernen er altså produktutviklingsverktøy som ikke
følger med API-et, mens de 28 i appen ligger i de erklærte
produksjonsavhengighetene — npm teller rammeverkpakkene som installerte
avhengigheter, ikke som bundlet innhold:

* **Rota:** alle seks ligger i `vitest`-stokken — `vitest` selv er det direkte
  avhengigheten, `vite`, `@vitest/mocker`, `vite-node`, `esbuild` og `tinypool`
  er transitive. De to critical er Vitest UI-serveren som lytter (vilkårlig fil
  kan leses og kjøres) og Tinypools prototype-forurensning i
  `run()`-opsjonene (RCE) — begge krever at testkjørerens egen overflate står
  eksponert, altså en utviklers maskin, ikke tjeneren. Det som faktisk følger med
  API-et, er `kysely` og `pg` (`package.json` sine `dependencies`, målt i samme
  kjøring), og ingen av dem er flagget.
* **Mobil:** de tre direkte er `expo`, `react-native` og `expo-router`; resten er
  Metro- og `@expo/*`-verktøykjeden pluss `micromatch`/`braces` (GHSA-vfj7-8cjw-p6xm,
  DoS via mønsterdybde), `decode-uri-component` (GHSA-vcc3-ghjq-m6fr, DoS),
  `node-forge` (GHSA-86w9-cpqp-85rv, RSA-PKCS#1 v1.5-signaturverifisering) og
  `uuid` (GHSA-w5hq-g745-h8pq, buffergrenser i v3/v5/v6) under den.

**Hva som faktisk reiser med i APK-en, er målt på bundle-filen** (2026-10-12,
`apps/mobile/android/app/src/main/assets/index.android.bundle`, 1 884 929 byte — den
filen som lastes som `assets://index.android.bundle` i enhetsbygget):

* `decode-uri-component` **er der**. Signaturen er `o['%C2']='\ufffd'`, den linjen
  som bygger erstatningskartet i pakken
  (`apps/mobile/node_modules/decode-uri-component/index.js:67`), og kjeden er
  `expo-router@57.0.25 → query-string@7.1.3 → decode-uri-component@0.2.2`.
  Kallestedet er forket inn i routeren selv:
  `apps/mobile/node_modules/expo-router/build/fork/getPathFromState-forks.js:43`
  importerer `query-string`, og i samme bundle finnes `arrayFormat` (1),
  `skipEmptyString` (1) og `%[a-f0-9]{2}` (1) — altså både kjørebane og strenger.
  De tre første grepene mine på denne filen ga 0 treff og dermed en feil konklusjon:
  `decode-uri`, `query-string` og `replaceMap` finnes ikke som strengtreff, fordi
  Metro minker lokale navn og fordi pakken aldri slås opp ved navn i den kjørbare
  filen. Det som står igjen, er selve koden.
* `node-forge`, `uuid`, `micromatch` og `braces` ga 0 på signaturstrengene sine
  (`Invalid key parameter`, `Invalid password`, `0-9a-f]{8}-\[0-9a-f`, `maxNoMatch`,
  `nocase`). Et treff er bevis, et mottreff er bare svak motbevis: dette er en
  signaturkontroll, ikke en modulliste. For å erklære denne listen fullt målt må
  kontrollen byttes ut med Metros egne moduldata (eksporten skriver et modulskjema,
  og `npx expo customize` gir modul-id-ene), ikke med grep.

Konsekvensen er den spillbare: advisoryen F-S9 var skrevet som om den bare gjaldt
byggeomaskinen. Minst én av dem (`decode-uri-component`, GHSA-vcc3-ghjq-m6fr,
moderate, DoS via eksponentiell dekoding av mislykket protsentkode) kjører i
APK-en, i expo-routers egen tolkning av deep-lenker.

**`npm audit fix` skal ikke kjøres i `apps/mobile`.** Løsningsforslagene npm gir
for de to rammevernene er `expo@44.0.6` og `react-native@0.72.17` mot installert
`expo@~57.0.27` og `react-native@0.86.3` — nedgraderinger, og `fixAvailable` for
`vitest` i rota er et semver-major-hopp til 5.0.4. For `decode-uri-component` gir
npm det samme: `fixAvailable` peker på `expo-router@58.0.17`, også det et
semver-major-hopp. Det finnes et tredje valg, og det er målt: advisoryen dekker
`<= 0.4.2`, `npm view decode-uri-component@latest` gir **0.5.0**, og én
`overrides`-linje i `apps/mobile/package.json`

```json
"overrides": { "decode-uri-component": "^0.5.0" }
```

løfter den ene transitive avhengigheten over `query-string@7.1.3` sin `^0.2.0`-forespørsel.
Kostnaden er reell og må stå fram: 0.5.0 ligger utenfor `query-string` sin erklærte
semver-rekke, så dette er en avhengighetsendring som krever ny eksport, ny sjekk av
signaturen i bundlen og en ny enhetsgang — og det er deep-link-parsing som er koden
som kjører pakken. **Det er dessuten målt at 0.5.0 ikke er en drop-in:** fra og med
`0.4.x` er pakka ESM-only — `package.json` har `exports: { default: ./index.js }`,
`type: module` og **ingen `main`-linje**, og fila ender med `export default
function` — mens `query-string@7.1.3` er ordinær CJS og gjør
`const decodeComponent = require('decode-uri-component')`. Metro løser `exports`
og transpilerer begge deler, men interopet mellom CJS-`require` og ESM-`default`
er akkurat den feilen som bare viser seg på en enhet som kjører den bundlen —
deep-lenkenes parsing. En `overrides`-linje må derfor måles på enheten, ikke bare i
`npm ls`. Riktig svar for de to rammevernene er likevel en planlagt
SDK-oppgradering med en egen utgivelsesprøve, ikke en audit-fix som skriver om
rammeverket under appen.

Den som betyr noe under α: Metro-dev-serveren bandt LAN-adressen (10.0.0.9 i
kjøringen der dette ble målt, 2026-10-12), så en emulator — eller hvem som helst på
det nettverket — kunne laste bundlen. Det er en egenskap ved `expo start`, ikke ved
appen, og den gjelder bare mens utvikleren har Metro gående: enhetsbygget som er
verifisert i denne QA-en, laster `assets://index.android.bundle` og rører ikke Metro
(`useDevSupport = false` i `MainApplication.kt`). Sjekk for den som trenger dagens
svaret: `npx expo start` og se hvilken vertsadresse som står på linja «Metro waiting
on».

## 4. Hva som er tett (kontrollert, ikke antatt)

* Blueprint-opptaket er lukket for fem felt: `era`/`location`/`role` sjekkes mot
  malens lukkede mengder, og `genre` + `flags` er den eneste friteksten som
  skjermes (`engine.ts:364-385`). Det finnes ingen vei forbi med et påtenkt
  felt. Vedlikeholdsfelle: felt-listen er hardkodet på `:378`, så en mal som får
  et fritekstfelt, må huske skjermen.
* Idempotens: `Idempotency-Key` må være til stede og lik `commandId`
  (`core/src/api.ts:95-97`), ellers 400.
* Prosatekster fra provideren som forsøker instruksjon, logges som
  `narrative_injection_attempt` og utføres aldri; faktalekkasje og påtenkte
  valg-ider ender i `fallback` (`core/tests/moderation.test.ts`,
  `core/tests/ai.test.ts`, `docs/qa/EVAL-narrative.md` 8/8).
* Budsjett per konto, målt per dag, og gjenkjent etter restart
  (`pg.test.ts:977`). Trippen nedgraderer til den templaterte reserveprosaren — låser ikke ute.
* Ni verdenruter mot fremmed konto: 404, identisk legeme, `x-request-id` til
  stede, og verdenen til eieren urørt.
* Kontokvoten er delt på tvers av prosesser: to `buildApp`-instanser over én
  database gir 6 tillatte take av 10 forsøk, og tolv samtidige take gir fortsatt
  6 (`pg.test.ts:1056`, `:1078`). Bakeføring av `app.ts:130` ga 10 og 12, så
  målingen er ikke en kø i testen.
* Bøttetabellen har den minste skrivebanen kjørebanen kan brukes med: `arw` til
  `punkgrid_app`, verken `D` eller `T`, funksjonen er ikke `SECURITY DEFINER`
  (målt som `prosecdef = f`), og et direkte forsøk på å skrive
  en full bøtte stopper på `CHECK`-en (23514). Alt målt av `pg.test.ts:888`.

## 5. P0-gate for lukket alpha

| Spørsmål | Status | Begrunnelse |
|---|---|---|
| Kan en spiller lese en annen spills verden? | **Nei**, testet | F-S1–F-S3 rettet, 14 angrepstilfeller + 5 rolletilfeller grønn |
| Kan en spiller skrive historien om? | Nei | versjonslås 409, append-only-ledger, `assertActorIdentity` 403 |
| Kan brukertekst overta fortelleren? | Nei | inn- og utportskjerm, 8/8 i eval |
| Kan én konto tære på en annens budsjett? | Nei | `security.test.ts:371`, `pg.test.ts:977` |
| Er den andre forsvarslinjen i databasen aktiv? | **Nei** | F-S4. Ok for α på én prosess, ikke for flertenant-utplassering |
| Er autentisering produksjonsklar? | Nei | F-S7: dev-port. α med 5–10 testere på én server kan leve med det, men bare med `devUserIds` = testerne og en hemmelighet som roteres før deling |
| Er rate limit nettverksklar? | **Ja**, for kontokvoten | F-S6 er rettet: bøtten ligger i Postgres med radlås og databaseklokke, to prosesser gir ett svar (`pg.test.ts:1038`). Anonymbøtta er per prosess med vilje, og `x-forwarded-for` leses bare med `PUNKGRID_TRUST_PROXY=1`. Målt mot én lokal PostgreSQL 16, ikke mot en ekte lastbalanser |
| Er tilgjengelighet (NFR-07) revisert? | Nei | WCAG 2.2 AA ikke kjørt |
| Er avhengighetene i kjernetreet rene? | **Ja**, for kjøretida | `npm audit --omit=dev` gir 0 i rota; de 6 advisories som finnes der, ligger i `vitest`-stokken (funn F-S9). `apps/mobile` har 28 også i produksjonstreet, og ingen av dem er egen kode — **men én av dem, `decode-uri-component`, er målt inni den sendte bundlen**, så tallet er ikke lenger bare en byggeomaskinbekymring (F-S9) |

Anbefalt rekkefølge før utgivelse: F-S4-beslutning (del opp transaksjonen eller
videreutvikle policyene) → ekte identitetsport → WCAG. F-S5 og F-S8 er
dokumenterte, ikke blokkeringer. F-S6 er rettet og målt (§2).

## 6. Grenser for denne kjøringen

Én node, én PostgreSQL 16 i Docker, ingen Supabase/Stripe/Resend, ingen ekte
narrasjonsleverandør, ingen fuzzing utover de
ni fiendtlige legemene i `security.test.ts:230`, og ingen AV-skanning av en
utgitt APK — den er ikke bygget. Kapasitet er målt siden, i
`core/scripts/loadtest.ts`, men ikke her: den kjøringen setter rate limiten over
det hele 1 000 økter kan bruke opp, med vilje, fordi en vaktbikkje på den målte
banen måler vaktbikkja. At lastprøven går grønn, er derfor ikke bevis for at
produksjonens kapasitet 30 tåler 1 000 samtidige økter; `--bucket=30` viser det
motsatte, og vaktbikkjens egen oppførsel hører hjemme i `server.test.ts` og
`pg.test.ts`. Mobilappen er ikke tillitsgrensen: alle
avgjørelsene som står i denne rapporten, er serveravgjørelser, og klienten kan
byttes ut uten å endre dem.
