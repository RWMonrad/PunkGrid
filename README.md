# PunkGrid — Reality Engine-kanon og mobilapp (Sprint 6)

**Status:** Kanonisk kjerne, HTTP-tjener, dev-autentisering, outbox-worker,
narrasjonsadapter mot en OpenAI-kompatibel gateway, en deterministisk
modereringsport med innrapporteringsrute og en Expo-mobilapp som spiller hele
§11-flyten er bygget og testet mot både minnelager og PostgreSQL — appen er
kjørt mot API-et fra en Android-emulator, og Sprint 6 leverer angrepssuiten
(`core/tests/security.test.ts`, `docs/qa/SECURITY.md`). Adapteren er aldri kjørt
mot en betalt modell; ingen nøkkel er konfigurert.

PunkGrid er en vedvarende interaktiv simulering, ikke en chatbot med lang
minne. Valg blir gyldige, lagrede domenehendelser; tekst beskriver dem, endrer
dem ikke. Denne repo-rotens kode er den deterministiske motoren som håndhever
det: `docs/product/PUNKGRID_PREDEVELOPMENT_MASTER_v1.0.md` styrer produktomfang,
`docs/architecture/REALITY_ENGINE_CORE_CONTRACT_v1.0.md` er normativ for
simuleringsinvarianter, API og goldentester. Avvik logges i
`docs/architecture/adr/`.

## Kjøring

Krever Node ≥ 22.6 (utviklet på v24.14.0) og npm. Runtime-avhengigheter er
`pg` og `kysely`; resten er dev-verktøy.

```powershell
cd "C:\Users\Rune W. Monrad\CascadeProjects\PunkGrid"
npm install
npm run typecheck
npm test
npm run seed
```

Siste fullkjøring 2026-10-15: **349 passed** med den isolerte PostgreSQL-basen
`punkgrid_test`, 19 filer og ingen skipped; uten database **323 passed | 26 skipped
(349)**. Goldensettet har 42 tilfeller, inkludert
regresjoner for versjonsbundne tilbud, deaktiverte valg, surprise-effektflagg,
scenens 2–4-intervall og at valgt tid og rolle åpner verden.
Mobilens logikksuite har 139 tilfeller, inkludert 56 for pending-scener, avbrudd,
retry og øvrig spillkontroll, og 18 kontrast-/tilgjengelighetstester. Leseorden og
bildesjekk har henholdsvis 29 og 18 tilfeller, inkludert vern mot foreldet XML,
skjult prosessomstart og gamle koordinater etter rulling i enhetsgangen,
samt regresjoner for komplette rader, inverterte skjermbokser og faktiske bilder.
Begge typekontrollene og mobilens Expo ESLint bestod, og `npm run seed` måler
gullhash `sha256:ba95bdda…6247` lik med replay.

Testene beviser ikke full produktdekning: de to motoravvikene som sto her
2026-10-14 — at oppsettets tid/rolle ikke endret starttilstanden, og at dynamiske
tilbud ikke holdt ADR-012s 2–4-intervall — er lukket og gulltestet 2026-10-15
(ADR-022, ADR-023), og den nye atferden er målt både over HTTP og på enheten i
den vanlige flyten med ekte trykk (`docs/qa/evidence/adr-022-023/`, APK
`1bf1ced6…53bb`). På det gjenbygde enhetsbygget bestod i tillegg den fulle
strict-enhetsgangen: **136/136 ved tekstskalering 1.0**
(`docs/qa/evidence/device-walk/2026-10-14T23-48-00-392Z`) og **135/135 ved 2.0**
(`…/2026-10-15T00-03-06-711Z`), begge mot en fersk in-minne-tjener på port 3120
som målingen startet selv.
Native strict-enhetsgangen 2026-10-14 bestod på samme standalone-APK
med to ABI-er (SHA-256 `f9385bb87de509da56f1dfa3715dced15c8acb16fe970ff26176c4f00ee0a43f`)
og samme PostgreSQL-baserte API på port 3113: **135/135 ved 200 %** i
`docs/qa/evidence/device-walk/2026-10-14T20-11-58-824Z` og **136/136 ved 100 %** i
`docs/qa/evidence/device-walk/2026-10-14T20-29-25-850Z`.
Hele første valgkort er synlig ved 100 %, prosa begynner over folden ved 200 %,
og navigasjon til valgt verden er verifisert. Samlet native feiltest **bestod** på
samme APK mot isolert minnelager: pending, tapt kvittering, samme-kommando-retry
uten dobbel commit, pause/resume/archive og lesbar arkivert historikk. Bevis:
`docs/qa/evidence/ui-fault/2026-10-14T21-08-12-195Z/` — 11 ferske skjermtrær
pluss `result.json`, tre publiserte episoder ved versjon 3 og korrekt replay.
Skjermbildene gangen tok, ligger igjen på maskinen som målte; det er XML-filene
og `result.json` som står i historikken.
Kontoen er utlogget med opprinnelig serveradresse på 3113; fontskala og
animasjonsskala er kontrollert tilbakeført til 1.0. Feiltesten brukte redusert
bevegelse og bekrefter ikke ekte TalkBack, iOS, ARM64-maskinvare eller full
produktberedskap. Se `docs/qa/STATUS.md` for åpne krav.

### Mot PostgreSQL (valgfritt)

Postgres-settet er opt-in fordi det krever en kastbar database. Dev-beholderen
som brukes, får en egen kastbase ved siden av dev-databasen — settet TRUNCATEER
skjemaet, og det skal det gjøre i sin egen base:

```powershell
docker run -d --name punkgrid-pg -e POSTGRES_DB=punkgrid -e POSTGRES_PASSWORD=punkgrid_dev_pw `
  -e POSTGRES_USER=postgres -p 54330:5432 postgres:16-alpine

docker exec punkgrid-pg psql -U postgres -d punkgrid -c 'CREATE DATABASE punkgrid_test'

$env:PUNKGRID_DB_URL  = "postgresql://postgres:punkgrid_dev_pw@localhost:54330/punkgrid_test"
$env:PUNKGRID_TEST_DB = "1"    # Postgres-settet TRUNCATEER skjemaet — ikke pek på en database du er glad i
npm run build
node dist/core/scripts/migrate.js
npx vitest run                 # 349 passed (19 filer) med PUNKGRID_DB_URL + PUNKGRID_TEST_DB, ellers 323 | 26 skipped — målt 2026-10-15
```

`PUNKGRID_TEST_DB` er en andre bekreftelse: uten den skriver suiten `! Postgres
suite SKIPPED` til stdout, slik at en grønn kjøring ikke kan leses som
databasedekning.

Sett ikke i gang Postgres-settet mens `npm run serve` eller `npm run worker` løper
mot samme skjema. Testens `wipe()` truncerer hele `punkgrid`-skjemaet i den basen
pekeren navner, i `beforeEach`, og en annen prosess som claimer `outbox_jobs`
samtidig, gir `wipe left rows behind`. Det er miljøet som feiler, ikke kanon — men
`wipe()` velger å rope i stedet for å lyve (dokumentert i `docs/qa/STATUS.md`, «Feil
suitene fant»).

Den konflikten er grunnen til at kommandoen ovenfor peker på `punkgrid_test` og ikke
på dev-databasen: da er skjemaet dev-tjeneren bor i, ikke lenger felles, og settet
kan kjøre mens tjeneren går. Målt 2026-10-13, med `npm run serve` oppe hele tiden og
`/healthz` svarende 200: **300 passed (19 filer)**. Verdenene `user_demo` har i
dev-databasen, overlever altså kjøringen; hadde pekeren navnet `punkgrid`, hadde de
vært borte og måtte genereres på nytt før enhetsgangen kunne åpne UI07.

### Tjeneren som kjører

To prosesser, samme wiring: API-et svarer etter commit, workeren skriver prosaken
(ADR-006). Uten `PUNKGRID_DB_URL` holder prosessen hele kanon i minnet og
skriver prosaken inline — den veien er ment for testene og den raske demoen.

En jobb som blir liggende `claimed` fordi workeren døde mens den holdt den, blir
gjenopptatt når leasen på 60 sekunder er utløpt, og `attempts` avgrenser hvor mange
ganger (`core/src/db/pgStore.ts:602-608`). Det er formen en rullerende deploy ellers
etterlater seg: en episode som aldri blir skrevet. Målt i to-instans-form mot én
database, dokumentert i `docs/qa/STATUS.md`, «Feil suitene fant».

```powershell
$env:PUNKGRID_DEV_SECRET = "dev-only-secret-rotate-before-anything-real-touches-this"
$env:PUNKGRID_DB_URL     = "postgresql://postgres:punkgrid_dev_pw@localhost:54330/punkgrid"
$env:PUNKGRID_DEV_USERS  = "user_demo"

npm run migrate      # skjemaet må være på plass; ellers stopper serve med exit 2
npm run serve        # http://127.0.0.1:3000, med workeren i samme prosess
npm run worker       # egen workerprosess, når serve kjøres med PUNKGRID_NO_WORKER=1
```

`npm run serve` skriver ut hva det faktisk er: `canon: PostgreSQL` eller
`canon: in-memory (single process)`, `narration:`-linjen under,
`sign-in: dev tokens for user_demo` eller `bearer tokens only (no /dev/token)`,
og rate limit-linjen — `address bucket: socket peer; account bucket: shared in
PostgreSQL` er det som står lokalt, der `x-forwarded-for` ikke leses i det hele
tatt. Miljøvariablene er
`PUNKGRID_PORT` (3000), `PUNKGRID_HOST` (127.0.0.1 — `0.0.0.0` for emulator),
`PUNKGRID_SEED`, `PUNKGRID_BUDGET_USD`, `PUNKGRID_NO_WORKER` og
`PUNKGRID_TRUST_PROXY` (sett `1` bare bak én proxy du eier selv; da blir
anonymbøtta nøklet på det *siste* leddet i `x-forwarded-for`, hoppen proxyen selv
så).

Narrasjon velges av tre variabler som må være **alle** satt
(`core/src/ai/env.ts`, ADR-017):

```powershell
$env:PUNKGRID_AI_BASE_URL = "https://api.openai.com/v1"
$env:PUNKGRID_AI_API_KEY  = "din egen nøkkel — skriv den selv, commit den aldri"
$env:PUNKGRID_AI_MODEL    = "gpt-4o-mini"
```

Mangler én av de tre, kjører prosessen den deterministiske
`CompliantProvider`-testprovideren og skriver `no gateway calls, no spend` på
startlinjen. Det er den veien testene, `npm run seed` og denne README-en bruker;
repoet verken inneholder eller henter en nøkkel.

Hemmeligheten må være på minst 32 tegn; bruk en egen verdi og roter den som en
nøkkel. Ren minneprosess, uten database:

```powershell
$env:PUNKGRID_DEV_SECRET = "dev-only-secret-rotate-before-anything-real-touches-this"
$env:PUNKGRID_DEV_USERS  = "user_demo"
npm run serve            # skriver prosaken inline; ingen worker å starte
```

Klienten logger inn på dev-tokenet, og det er den eneste veien inn foreløpig —
Supabase Auth/JWT er ennå ikke koblet til (ADR-016). `/dev/token` finnes bare
når `PUNKGRID_DEV_USERS` er satt, og signerer kun de navnene:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/dev/token `
  -ContentType "application/json" -Body '{"userId":"user_demo"}'

$env:PUNKGRID_DEV_SECRET = "dev-only-secret-rotate-before-anything-real-touches-this"
npm run token -- user_demo 72      # samme token, skrevet av scriptet, gyldig i 72 timer
```

`npm run seed` bygger til `dist/` og spiller
opp referanseverdenen *The Glass Harbor* (Contract §12) gjennom den faktiske
APIen: verdenskapitel, fire åpningvalg, én surprise, ett bounded catch-up-resume,
deretter skriver den fullstendige hendelsesloggen per type, `state_hash` og
replay-verifisering. Samme seed gir samme hash — replay er beviset, ikke
formålserklæringen. Sluttresultatet er forankret som en golden hash
(`core/scripts/seed-glass-harbor.ts:120`: `sha256:ba95bdda…356247`, 28 hendelser,
versjon 7), og `npm run seed` avslutter med exit 1 ved drift. Begge veier er
sjekket: lik hash gir exit 0, en endret hash gir `DRIFT` og exit 1.

## Mobilappen (apps/mobile)

Expo SDK `~57.0.27`, React Native 0.86.3, expo-router `~57.0.25` (npm-pakken er
`punkgrid-mobile`, Android-applicationId `com.monrad.punkgrid`, `app.json:23`).
`android/` er generert av prebuild (CNG) og gitignoret — maskinen genererer den
selv. iOS er ikke generert. Appen importerer aldri `core`: §11 er et HTTP-API, alle
avgjørelsene tas på tjeneren, og klienten kan byttes ut uten å endre dem.

**Hvordan appen finner tjeneren.** `resolveBaseUrl` (`apps/mobile/src/lib/config.ts:21`) prøver i
denne rekkefølgen: (1) en URL lagret i UI10, som vinner over alle gjetninger,
(2) dev-serverens vert (`devHost`) på port 3000, men bare når den ikke er
`localhost`/`127.*` — Metro-porten er aldri engine-porten, (3)
`http://10.0.2.2:3000` på Android-emulator, som er vertsmaskinen slik emulatoren ser
den, (4) `http://localhost:3000` på simulator og ren Node. Tjeneren lytter som
standard på `127.0.0.1` (`core/scripts/serve.ts:30`), så mot en emulator må den
startes med `PUNKGRID_HOST=0.0.0.0`; ellers svarer appen «Network error» på alle kald.

**To Windows-krav for `expo run:android`.** (a) SDK-stien kan ikke inneholde
mellomrom, så `android/local.properties` peker på den romfrie kopien:
`sdk.dir=C\:/Android/Sdk`. (b) AGPs standard-CMake (3.22.1) har ninja 1.10.2, som
ikke kan statte en objektsti over 260 tegn — codegens autolenkede objekter treffer
grensen selv med LongPathsEnabled. Derfor er `cmake { version "3.31.6" }` fastsatt i
`android/app/build.gradle:94-98` (ninja 1.12.1). (a) ligger i `android/`, som er
utelatt fra git og er maskinspesifikt; (b) ligger i generert kode og må skrives om
ved en ny prebuild.

**Kjøring.** `npx expo run:android --device PunkGrid_Verify` bygger og installerer en
debug-APK. Bygget krever `JAVA_HOME` i skallet: `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`,
den eneste JDK-en denne maskinen har. Uten den stopper `gradlew.bat` på
»JAVA_HOME is not set and no 'java' command could be found« med exit 9009, og
`expo run:android` gjengir bare den meldingen. Og når bygget pipen videre til `tail`,
er det loggen som må leses, ikke returkoden: pipens egen exit er `tail`-prosessens, og
den er 0 selv når gradle stopper. Målt 2026-10-12.
Enhetsgangen har sin egen AVD, `PunkGrid_Verify` (samme skjerm som
`SFD_Verify`: 1344x2992 @ 480 dpi, og 12 GB på `/data`), og kjøres med
`PUNKGRID_SERIAL=emulator-5556`. Grunnen er målt 2026-10-12: en søsterøkt for et
annet prosjekt tok `SFD_Verify` mens gangen gikk, og gangen trykket koordinatene
sine mot det som hadde fokus — først ei `input tap` som feilet på en enhet som var
forsvunnet, så et prepare-pass som aldri nådde UI01 fordi skjermbildet hadde en
annens app i forkant. To økter som deler én emulator, måler ikke samme ting.
`npx expo start` alene er ikke kjørbart på denne maskinen, og grunnen er
målt, ikke gjet: den store bundle-responsen til Metro kommer fram **klippet** på vegen
inn i emulatoren. Den samme bundle-en hentet fra verten (`http://localhost:8081`) gir
seks chunks med sum 22 256 083 byte, hver med sin CRLF-avslutning og en hel
termineringsramme (`~/b4.raw`). Hentet *inne fra* emulatoren mot `10.0.2.2:8081`
melder den store chunk-en 22 255 544 byte, men bare 22 255 543 byte kommer fram før
boundary-teksten begynner — rammen bryter der (`~/rm.bin` og `~/resp_dev.bin`).
På en respons med `Content-Length` er tapet direkte å lese: lovet
6 159 046, mottatt 6 159 041 (`~/rp.bin`). Tapet er ikke deterministisk og
rammer bare store svar — api-et på port 3000 har aldri vist det. RN leser
boundary-tegnet `-` (`0x2d`) der det forventes en hex chunk-størrelse og melder
`ProtocolException: Expected leading [0-9a-fA-F] character but was 0x2d`; feilmeldingen
står i multipart-parseren, men det er NAT-lenka (SLIRP) som mister byteene. `adb
reverse` hjelper ikke: klienten løser `10.0.2.2` og ikke vertens localhost, og
`setprop metro.host localhost` som kunne omgått det, krevde `adb root`, som denne
`google_apis`-AVD-en nekter. Filene `~/b4.raw`, `~/rm.bin`, `~/resp_dev.bin` og
`~/rp.bin` er de lokale fangene bak disse tallene (curl med `--raw` på verten og
inne fra emulatoren); de er ikke en del av repoet.

**Slik verifiseres skjermene lokalt.** Bundle bygges inn i APK-en i stedet for å
lastes fra Metro — to midlertidige endringer som ikke skal følge med inn:

```powershell
cd apps\mobile
$env:NODE_ENV = "production"
npx expo export -p android --no-bytecode --output-dir "$env:USERPROFILE\expoexport"
node scripts\copy-assets.mjs
New-Item -ItemType Directory -Force android\app\src\main\assets | Out-Null
Copy-Item "$env:USERPROFILE\expoexport\_expo\static\js\android\entry-*.js" "$env:USERPROFILE\CascadeProjects\PunkGrid\apps\mobile\android\app\src\main\assets\index.android.bundle"
```

`copy-assets.mjs` er den andre halvdelen av løkka: etterspurt bilde ligger ikke i
`assets/` i en Android-bundle, men som ressursfiler under `res/`. Skriptet leser
`registerAsset({...})`-kallene ut av den eksporterte bundlen og legger hver skala i
`drawable-<dpi>/<navn>.<type>` akkurat der `AssetSourceResolver` leter. Uten dette
måles skjermene mot en svart firkant der kunsten skal være.
I `MainApplication.kt` settes `useDevSupport = false` på
`ExpoReactHostFactory.getDefaultReactHost(...)`, da laster RN
`assets://index.android.bundle`. Verifikasjonsbygget beholder denne innstillingen,
JavaScript-bundlen og de kopierte ressursene. Fra `android` bygges de to mål-ABI-ene
med `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64`.
Dette bestod 2026-10-14; `android/build.gradle` angir C++-standardbiblioteket
uttrykkelig for de berørte native modulene. Tidligere ninja-/lenkefeil er ikke
lenger en begrensning for dette bygget. Bare x86_64 er kjørt på enhet.
En bundle bygget med `dev=true` kan ikke ligge inni (den ender med `Cannot create
devtools websocket connections in embedded environments.`), og en rå Metro-URL med
`dev=false` gir `No routes found` fra expo-router — det er `expo export` som gir
riktig produksjonsartefakt. Innlogging skjer med dev-tokenet (`npm run token -- user_demo 72`), og
startes tjeneren med en ny `PUNKGRID_DEV_SECRET`, er det lagrede tokenet ugyldig —
appen må Sign out og Sign in på nytt.

Rute- og transportlogikken er testet uten emulator: 139 tilfeller i
`apps/mobile/src/lib/*.test.ts` (api 16, play 56, session 12, config 9, telemetry 9,
setting 10, preview 9, contrast 18), kjørt av rotens `npm test`. Skjermene dekker hele Masterens UI-liste:
UI01 velkomst (`app/index.tsx`), UI02 genesis-valg (`genesis.tsx`), UI03 guidet
oppsett (`setup.tsx`), UI04–06 og UI08/12 i én samlet spillflate
(`world/[worldId].tsx`: åpning, lesing, beslutningskvittering, surprise og
pendende/feiltilstander), UI07 verdensliste (`library.tsx`), UI09 historikk
(`history/[worldId].tsx`), UI10 konto og personvern — inkl. base-URL-feltet som
overstyrer alle gjetninger (`account.tsx`, `baseUrlOverride`) — og UI11 betalingsmur bak et flagg
(`paywall.tsx`). I tillegg kommer `sign-in.tsx` og F02's lokale gjeste-preview
(`preview.tsx` + `lib/preview.ts`), som spiller én scene på enheten uten konto,
 uten nettverkskall og uten å sende noe. Hele flyten er gått for hånd på
emulatoren, og den samme flyten kjøres automatisk mot tjeneren i
`core/tests/e2e.test.ts` — over ekte sockets, men i én prosess med kanon i minnet.
Skjermene har nå også en automatisk gang: `apps/mobile/scripts/device-walk.mjs`
(`npm run walk:device --prefix apps/mobile`) styrer en emulator med `adb` og
påstår det som står i accessibility-treet, ikke det som står i kilden — 136/136 sjekker
ved 100 % og 135/135 ved 200 % tekst, målt 2026-10-14,
på UI10 → UI01 → F02-preview → F02-konsekvens → UI01 → dev-innlogging → UI07 → UI04 → ett
valg → UI04 → UI09 → UI02 genesis → UI03 setup, der hvert tre i tillegg
måles på at det bare inneholder noder fra egen pakke, at alle klikkbare noder har
et navn, at de er minst 44 dp, og at noder med tekst eller innholdsbeskrivelse
kommer i den rekkefølgen geometrien sier (SC 2.4.3). Play-skjermen måler i tillegg
*hvor* teksten havner: episodeoverskrifta og det første prosavsnittet skal ligge
innenfor første viewport uten å bli rørt, og døra som blir trykt, blir målt mot 44 dp
fra det dumpet som viser henne på skjermen. Grunnen er målt: sjekken som leter etter
prosa, så bare etter at teksten fantes, og ei node som viewporten klipper, kommer
tilbake med et snudd bounds (`[48,1307][1296,1161]`) — altså med null pixels — mens
skjermen likevel sier «offers prose». Kunsten måles på pixler: gangen leser skjermbildet
det nettopp skrev og teller ulike farger i beltet kunsten skal fylle, grensa står på 64 og
ei flat plate er én, så en fil som ikke ankom enheten, blir en feiling og ikke en svart
firkant; samme slot-tabell måles på bevismaterialet uten emulator av
`apps/mobile/scripts/art-check.test.mjs`, og besetningsrekka på UI03 måles i tillegg som
navn i treet, seks stykk, lest fra regelsettet på disk. `docs/design/ART.md` forklarer
hvorfor målingen trenger to ankermetoder for rekker. Skriptet er valgfritt fordi det krever
maskinvare: en emulator med APK-en, en tjener nåbar på `PUNKGRID_BASE_URL` fra
emulatoren (lokalt `http://10.0.2.2:3100`) med `PUNKGRID_DEV_USERS=user_demo`, og
`adb` på stien. Det starter med `pm clear`, så
kontoen logges ut underveis, og det etterlater verden ett versjon nummer høyere
for hver kjøring. Skjermbildene legges i
`docs/qa/evidence/device-walk/<tidsstempel>/`. Tilgjengelighet er målt:
`apps/mobile/src/lib/contrast.ts` regner ut WCAG 2.2-relasjonene og
`contrast.test.ts` måler 115 tekstpar, 41 kanter, 98 `Text`-elementers
tekstskalering, 17 `Pressable`-elementers touch-mål og kontrollsemantikken rett fra kilden, og krever at
alle 20 fokuskontrollene tegner sin egen ring (SC 2.4.7). Svakeste tekstpar er 5,82:1,
svakeste kant 3,59:1. To målinger er målt i
bevegelse: den pustende statusprikken på UI04 skal måle 3:1 også i bunnpunktet av
pusten (4,04–4,29 mot de to bakgrunnene en strip kan ligge på), og UI10s egen
«Reduced motion»-bryter må bli lest av det som beveger seg — målt 2026-10-12 skrev
raden en flaggverdi ingen komponent leste, mens spinneren gikk videre. De to gjenstående
avvikene — skjermleserens *kunngjøring* er ikke testert, og iOS er ikke bygget —
står i `docs/qa/STATUS.md`.

## Omfang målt i filer

| Lag | Inneholder |
|---|---|
| Kjernen (`core/src`) | 27 TypeScript-filer på fem lag: domene/reducer/regelapakke, motoren, den rammeverksuavhengige API-en, node:http-adapteren med auth/rate limit/worker, Postgres-laget og narrasjons-/moderasjonslagene |
| Testene (`core/tests`) | 9 testfiler pluss `helpers.ts`, 159 tilfeller, inkludert 27 i det valgfrie PostgreSQL-settet |
| Kjørbare script (`core/scripts`) | 7: seed, narrasjonseval, lasttest, migrasjon, serve, worker og token |
| Databasen | 12 SQL-filer: 11 migrasjoner (001–011, der 011 binder en arc-identitet til én verden) + `validate_invariants.sql` med 20 negative blokker |
| Beslutningsloggen | 11 ADR-er (011–021) pluss indeks for ADR-001–010 |
| Kvaliteten | 3 dokumenter i `docs/qa`: sprintstatus, sikkerhetsrapport og narrasjonseval |
| Mobilappen (`apps/mobile/src`) | 44 filer: 10 ruter pluss `_layout`, 7 komponenter, 3 hooks, 21 lib-filer (13 moduler pluss de 8 testfilene deres) og 2 plattformbindinger |

Tallene er optalte på dette treet, ikke anslått — `find core/src -name '*.ts' | wc -l`
og maken for de andre radene. Endrer du omfanget, endrer du raden.

## Hva som finnes

| Sti | Innhold |
|---|---|
| `core/src/domain.ts` | Typer, kanonisk JSON, `state_hash` (SHA-256 over sorterte nøkler), clamp for relasjoner, deterministisk RNG/-id-fabrik |
| `core/src/errors.ts` | Feilkodene fra Contract §11 som `EngineError` med status |
| `core/src/reducer.ts` | `applyEvent` for de 13 kanoniske hendelsestypene, `replay`; ukjente type forkastes (T11) |
| `core/src/store.ts` | Relasjonsformer fra §3 pluss minnelager med per-verden-lås |
| `core/src/rulepack.ts` | Deklarativ regelapakke: preconditions, effekter, surprise-familier, setting-avgrensninger, tidspolicy |
| `core/src/glassHarbor.ts` | Referansefixtureen §12, inkl. startressurser og T03–T06-tall |
| `core/src/narrative.ts` | Ubetrott-narrasjonsgrense: streng utdataschema, valideringskoder, templert fallback |
| `core/src/moderation.ts` | Den deterministiske modereringsporten (§15): blokkerende og flaggende kategorier med ordgrenser, injeksjonsgjenkjenning, `clip`/`minimiseForCase` som holder saksutdraget innenfor grensen |
| `core/src/engine.ts` | Kommandorør (idempotens, optimistisk versjonslås, ett skriverpunkt per commit), genesis, klokker, surprisemotor, POV-filter, budsjett, moderering ved inn- og utgang, `reportEpisode`/`listModerationCases` |
| `core/src/api.ts` | De ti normative `/v1`-ruttene (§11) pluss den ellevte — `POST …/episodes/{id}/reports`, registrert som avvik i ADR-018 — rammeverksuavhengig, med `scopeOf()` som sier hvilken verden en forespørsel angår før utførelsen og `EngineRunner`-porten som binder ruttene til enten minnelageret eller en transaksjon |
| `core/src/server/http.ts` | node:http-adapteren: kroppsgrense, request-id, `/healthz`, `/dev/token` og oversettelse mellom socket og `ApiRequest` (ADR-016). `peerAddress()` avgjør hvilken adresse vakten nøkler på — socket per default, siste ledd i `x-forwarded-for` når `PUNKGRID_TRUST_PROXY=1` |
| `core/src/server/auth.ts` | `AuthPort` og `HmacDevAuth` — HMAC-signert dev-bærertoken, timing-safe sammenligning, utløp med klokkespilltoleranse |
| `core/src/server/rateLimit.ts` | Det felles vokabularet for vaktene: `RateLimiter`-grensesnittet, `Limiters` (anonim adresse før auth, konto etter) og `TokenBucket` — per prosess, der `idleTtlMs` er taket på antall adressenøkler |
| `core/src/server/pgRateLimit.ts` | `PgTokenBucket`: samme grensesnitt mot PostgreSQL — ett `punkgrid_rate_limit_take()`-kall per avgjørelse, ingen fail-open-vei (ADR-020, F-S6) |
| `core/src/server/runner.ts` | `SessionRunner`: samme `Api`, Postgres som kanon — lesing i én transaksjon, skriving som enhetsarbeid med verdenene fra `scopeOf()` |
| `core/src/server/worker.ts` | Outbox-drain: claim med lease, skriv prosak per verden, lukk jobben; `retry`/`failed` avgjøres av radens forsøksbudsjett, og et `claimed`-ledd med utløpt lease blir gjenopptatt av neste worker |
| `core/src/server/app.ts` | Komposisjonsroten: `buildApp`/`buildWorker` velger lager, provider, budsjett, auth og flush-policy, slik at test, emulator og sikkerhetsuite starter det samme objektet |
| `core/src/providers.ts` | Testprovider: compliant, timeout, kast, lekkasje, valg-inventor, policy-blokkert, og `ScriptedTextProvider` som leverer en gitt tekst uten egne flags — den som beviser at motoren screener i tillegg til provideren |
| `core/src/ai/prompt.ts` | §10-payloaden som versjonert prompt: `PROMPT_VERSION`, `EPISODE_SCHEMA`, system/bruker-meldinger med data som ubetrott innhold |
| `core/src/ai/openai.ts` | `OpenAiCompatibleProvider`: `/chat/completions` over `fetch`, `AbortSignal.timeout`, `response_format`, 429/5xx-gjenprøving med `retry-after`, alltid `{failure}` i stedet for unntak (ADR-017) |
| `core/src/ai/env.ts` | `providerFromEnv`: gateway krever alle tre `PUNKGRID_AI_*`-variablene, ellers deterministisk testprovider uten nett eller utgift |
| `core/src/db/schema.ts` | Kysely-tabelltyper som speiler DDL én-til-én — kolonnenavnene adapteren bruker |
| `core/src/db/client.ts` | Connection pool med låst søkebane som startparameter; admin-pool for migrasjonskjøring; `SET ROLE` for RLS-test |
| `core/src/db/migrate.ts` | Node-migrasjonsløper med sjekksumlogg i `public.punkgrid_migrations`; avviser endret migrasjon |
| `core/src/db/pgStore.ts` | Hydrering/persist per enhet-of-work: advisory-lås per verden, ett commit-punkt, avledede projeksjoner fra snapshot, outbox-livsløp fra episodestatus |
| `core/src/db/session.ts` | `Sessions`: ny `Engine` per kommando mot et hydrert `Store`, med `EnginePorts` for budsjett, episode-kursor og gjenopptaksanker; `forWorld` er workerens enhetsarbeid uten request-aktor |
| `core/tests/` | 159 tilfeller i ni filer: `golden.test.ts` (38: T01–T20 + invariantregresjoner), `api.test.ts` (9 ruttester), `server.test.ts` (9 transporttester over ekte sockets), `e2e.test.ts` (14 tilfeller: hele spillflyten over ekte sockets, fra sign-in til replay og kvittering, inkl. NFR-01 og NFR-02 i minneformen), `worker.test.ts` (8 outbox-tester), `ai.test.ts` (15 narrasjonstester mot en lokal HTTP-stub), `moderation.test.ts` (23 tester for screen, inn-/utport og rapport), `security.test.ts` (16 angrepstilfeller over ekte sockets), `pg.test.ts` (27 databasetester inkl. HTTP + worker med NFR-måling i utplassert form, de utplasserte rollene og den delte rate limit-bøtta, opt-in), `helpers.ts` |
| `core/scripts/seed-glass-harbor.ts` | Kjørbar seed og determinismerapport |
| `core/scripts/eval-narrative.ts` | FR-19-evalueringen av §10-grensen: 8 tilfeller gjennom motoren + 4 angrepstekster og 6 rolige tekster mot screenen, skriver `docs/qa/EVAL-narrative.md`, exit 1 ved avvik (`npm run eval:narrative`) |
| `core/scripts/migrate.ts` | CLI for migrasjonsløperen (`PUNKGRID_DB_URL`, `--dry-run`) |
| `core/scripts/serve.ts` | Starter API-et fra miljøet; nekter å tjene et halvt bygget skjema (exit 2) |
| `core/scripts/loadtest.ts` | NFR-12: 1 000 økter × 4 slag gjennom `buildApp` i en egen prosess, begrenset arbeidskø, simulert generering; skriver gjennomstrømning, per-rute percentiler, statusstimming og bøttepolitikk, og feiler (exit 1) på 5xx, manglende `x-request-id`, 429, GET-p95 over NFR-01 eller p75 fra commit til publisert over NFR-02 i køforma (`npm run loadtest`, `--sessions=`/`--workers=`/`--rounds=`/`--bucket=`). `--db=<url>` bytter kanon til PostgreSQL og narrasjon til outbox-workeren i tjenerprosessen, med målt tid fra commit til lesbar prosa; skriv 1 000 kontoer og 5 000 verdener, så pek på en kastbar database som er migrert først (`PUNKGRID_DB_URL=<url> npm run migrate`). Serverens feil og utløpte jobber går til stderr, utskriften av selve forespørslene er taus, fordi én linje per forespørsel i en kjøring på 32 000 forespørsler måler skriveren, ikke tjeneren |
| `core/scripts/worker.ts` | Starter den egen outbox-prosessen mot `PUNKGRID_DB_URL` |
| `core/scripts/token.ts` | Skriver et dev-bærertoken for ett navn, uten å starte en tjener |
| `docs/architecture/migrations/` | SQL for §3-modellen (11 migrasjoner, 001–011, + README + `validate_invariants.sql`, 20 negative blokker). Kjørt 001→010 mot en fersk database og verifisert mot PostgreSQL 16, ikke mot skyen |
| `docs/architecture/adr/` | 11 ADR-er (011–021) pluss indeks for ADR-001–010 |
| `docs/qa/STATUS.md` | Sprintstatus med målte testantall, kjørte plattformer og feil suitene fant |
| `docs/qa/SECURITY.md` | Sprint 6: angrepssuiten, de tre P0-funksjonene som er rettet (målt baklengs), de seks funnene alpha må kjenne, og P0-gate-tabellen |
| `docs/qa/EVAL-narrative.md` | Skrevet av `npm run eval:narrative`: 8 tilfeller gjennom motoren + 10 tekster mot screenen |
| `apps/mobile/src/lib/api.ts` | De elleve `/v1`-ruttene som en `fetch`-klient uten React-avhengighet, så den kjøres i vitest i roten og beviser wire-contract uten enhet |
| `apps/mobile/src/lib/play.ts` | Spilløkken som en egen klasse: last verden, commit valg, poll etter prosa. Versjonsbinding, idempotent retry og `pending`-episoder testes uten enhet |
| `apps/mobile/src/lib/session.ts` | Innlogget person, valgt tjener og klienten som bærer begge. Subscriberbart store med plattform-lagring injectert (SecureStore på enhet, minnelager i test) |
| `apps/mobile/src/lib/config.ts` | `resolveBaseUrl` og `isHttpUrl` — ren logikk for hvilken tjener som velges, testbar uten emulator |
| `apps/mobile/src/lib/setting.ts` | Det avgrensede oppsettets ordliste for UI03: malene som data, med avvisningsgrunner gitt før en kvote brukes |
| `apps/mobile/src/lib/telemetry.ts` | Master §8.3s hendelsesordbok som type, uten fritekstfelt; `worldRef` følger serverens operasjonelle pseudonym |
| `apps/mobile/src/lib/flags.ts` | Premium-flagget (Master §5.3): `premium: false` er den utgitte tilstanden, og ingen skjerm kan slutte at betaling finnes |
| `apps/mobile/src/lib/theme.ts` | Designsystem v0 (§5.5): tokens er eneste kilde til farge, størrelse og mellomrom. `color.line` er skilt ut fra `color.raised` fordi en 1 px kant må måle 3:1 mot begge bakgrunnene (SC 1.4.11) |
| `apps/mobile/src/lib/contrast.ts` | WCAG 2.2-relasjonene uten React Native: luminans, ratio, stor-tekst-regelen og flattening av opasitetstilstander |
| `apps/mobile/src/components/` | `kit.tsx` (§5.5-komponentene, aldri tilstand bare i farge; `Section` er et brackette panel), `Button.tsx` (varianter som betyr noe: `accent` er den ene døra som starter et liv, `primary` er skjermas egen bekreftelse), `cards.tsx`, `hud.tsx` (bakgrunnsrampen, statusfeltet, den pustende prikken, `DoorCard` og `CornerTicks` — hjørnetegn som er dekorasjon og aldri kommer inn i accessibility-treet), `art.tsx` (kunstSlots fra `docs/design/ART.md`), `ReportSheet.tsx` (FR-11/US13), `nav.tsx` |
| `apps/mobile/src/hooks/` | `useApp.ts` (session-snapshot pluss bevegings- og skjermlesertilstand — beveging er plattformens svar **eller** UI10s egen bryter, den som har animasjon spør bare denne hooken), `usePlay.ts` (kontroller bundet til én skjerm, polling avbrutt ved navigation vekk) og `useLastWorld.ts` |
| `apps/mobile/src/platform/` | `bootstrap.ts` (én `Session` per prosess med enhetens lagring og analytics-sink før første render) og `storage.ts` (token i SecureStore, resten i AsyncStorage) |
| `apps/mobile/src/app/` | Skjermene for UI01–UI12 pluss `sign-in.tsx`, Expo-router som filruter |
| `apps/mobile/src/lib/*.test.ts` | 139 tilfeller: api 16, play 56, session 12, config 9, telemetry 9, setting 10, preview 9, contrast 18 (115 tekstpar, 41 kanter, 98 tekstelementers skalering, 12 bakgrunnsplater mot ankerfargen, 20 fokusringer, touch-mål for 17 `Pressable` og kontrollsemantikk målt i kildekoden, den pustende prikkens laveste ramme, og at UI10s bevegelser-bryter faktisk blir lest av det som beveger seg). De to siste setting-tilfellene leser regelsettet fra disk: besetningen i `setting.ts` skal ha samme navn, rekkefølge og `isPlayer` som `core/src/glassHarbor.ts`, i begge retninger, og hvert navn må ha en portrettfil i `assets/img/` |
| `apps/mobile/scripts/art-check.test.mjs` | 18 tilfeller: ett per ramme det nyeste stempelet skriver, og inne i hver ramme måles kunstsloten sin mot pixlene, pluss vaktbikkjene som viser at grensen slår — en håndskrevet flat plate er én farge, fotografiet tre størrelsesordener over, og et slot uten anker eller ramme er en feiling, ikke et hopp |
| `apps/mobile/scripts/device-walk.mjs` | 136/136 sjekker ved 100 % tekst, 135/135 ved 200 %, målt 2026-10-14: kjørt mot en emulator via `adb` — Accessibility-treet per skjerm, navn og 44 dp på hver klikkbare node, leseorden, fokusring, folden som geometri, kunsten som pixler og ett trykk som flytter versjonen. Skriver skjermbilder og trær til `docs/qa/evidence/device-walk/<tidsstempel>/` |
| `apps/mobile/scripts/reading-order.test.mjs` | 29 tilfeller i dag (16 skjermtre fra det nyeste stempelet + 13 faste): måler leseordenen (SC 2.4.3) på hvert skjermtre enhetsgangen la i bevismappa, ett tilfelle per tre, pluss faste regresjoner som nekter å måle mot ei tom mappe og viser at regelen kan slå feil |

## Grenser som er håndhevet i koden

- Hendelser er append-only; `world_seq` +1 per hendelse, `worlds.version` +1 per
  kommandobatch; snapshot nøkles på (world, version) og verifiseres mot replay.
- Kommandoer er idempotente: lik kropp gir lagret resultat, lik idempotennøkkel
  med ulik kropp gir `IDEMPOTENCY_PAYLOAD_MISMATCH`, utdatert versjon gir
  `WORLD_VERSION_CONFLICT` med `currentVersion`.
- Narrasjon AI har ingen write-vei: episodeprosakvalitet avgjør
  `published`/`fallback`, men kanonisk state er uendret av en forkastet episode
  (T13, T18).
- Moderering skjer i motoren, ikke i provideren: blueprint-et screenes før
  verdenskallet reiser seg (§15), all prosa screenes etter §10-valideringen og
  **i tillegg til** providerens egne `content_flags`, og en injeksjonssetning i
  prosa logges som `narrative_injection_attempt` uten å noen sinne bli utført. En
  rapport er ingen kommando — den skriver ingen hendelse og øker ingen versjon —
  men den er idempotent på `commandId` og lagrer et klippet utdrag, ikke
  episode-teksten (ADR-018).
- Fakta filtreres per karakter-POV; hemmeligheter krever `fact.disclosed` (T14).
- Surprise har cooldown, causal hook og budsjett; ingen gyldig kandidat gir
  `no_op: NO_ELIGIBLE_SURPRISE` (T15, T16).
- Fri verdenskvote håndheves atomisk i `world.create` (ADR-012) og ukjente
  kommando-/hendelsestyper forkastes (V1 MUST).
- Postgres er autoritativ: én transaksjon per kommando med advisory-lås på
  verdenen, append-only-handelser med sekvenskontroll i trigger, publisert prosa
  som ikke kan overskrives, og projeksjoner som bygges fra snapshot — aldri
  lappet i etterkant (§3, ADR-006/015). Gullhashen er den samme på begge
  backender.

## Hva som ikke er gjort ennå

- **Ekte autentisering mangler.** `HmacDevAuth` er en dev-port (ADR-016): den
  erstatter Supabase Auth/JWT til noen implementerer en ny `AuthPort`.
  `/dev/token` er avhengig av en
  allowlist og må ikke konfigureres i produksjon. Provisionering av Supabase er
  ikke gjort — det koster penger og endrer tilstand, og er bedt om godkjent
  først.
- **Intet rammeverk i tjeneren.** node:http-adapteren er bevisst valgt framfor
  ADR-011s NestJS-default; veien tilbake er én fil, men den er ikke gått.
- **Narrasjonen er bygget, men ikke kørt mot en levende gateway.**
  `core/src/ai/openai.ts` er en ekte adapter (ADR-017) testet mot en lokal
  HTTP-stub over ekte sockets — prosessene i denne README-en bruker
  testprovideren fordi ingen `PUNKGRID_AI_API_KEY` er konfigurert, og det
  besluttes av deg når nøkkelen skal inn. Modereringsporten er bygget og testet
  (§15, FR-11/US13, ADR-018); det som gjenstår er bare prosekvalitetsevalueringen
  hos en levende modell, fordi den kjøringen krever nøkkelen din.
- **Mobilappen finnes, men er ikke utgitt.** Den er kjørt på en
  Android-emulator (AVD `PunkGrid_Verify`, debug-APK) og dekker UI01–UI12.
  Skjermene er automatisk gått gjennom i `apps/mobile/scripts/device-walk.mjs`
  (136/136 sjekker ved 100 % og 135/135 ved 200 % tekst, begge målt grønne 2026-10-14), og spillflyten
  over de elleve ruttene er automatisk testet i `core/tests/e2e.test.ts`. Det
  som gjenstår er utgivelseslisten: release-build med signing, push-varsel (ingen
  varsler er bygget), ekte betalingsleverandør (UI11 er en flaggestyrt skygge) og
  eksport og sletting i henhold til ADR-014. WCAG 2.2 AA (NFR-07) er målt i
  `contrast.test.ts`, og leseordenen og fokusindikatoren er målt mot de faktiske
  skjermbildene (`apps/mobile/scripts/reading-order.test.mjs`, og punkt 2.4.3,
  2.4.7 og 2.1.1 i enhetsgangen); det som ikke er kjørt, er en ekte
  skjermleser-operatør og iOS-delen av revisjonen.
- **RLS er en andre linje som ikke nås** (SECURITY.md F-S4): migrasjon 008 gir
  roller og policyer, men kjørebanen bruker dem aldri — `assumeRole`
  (`core/src/db/client.ts:19,24`) er død kode og ingen plass setter
  `app.user_id`. Autoriseringen i motoren (§1.7) er derfor det eneste vaktholdet
  over kanon. Det er greit for alpha på én prosess, og en beslutning før
  flertenant-utplassering.
- **Rate limiten er delt for kontoer, per prosess for anonyme** (SECURITY.md
  F-S6, ADR-020): kontokvoten tas i `punkgrid_rate_limit_take()` mot PostgreSQL —
  databaseklokke og radlås, målt likt over to `buildApp`-instanser
  (`core/tests/pg.test.ts:1038`). Anonymbøtta er værende i prosessen som en
  beslutning, og `x-forwarded-for` leses bare med `PUNKGRID_TRUST_PROXY=1`, da som
  det siste leddet. Gjenstår: måle ordningen mot en ekte lastbalanser, ikke to
  instanser i en testprosess.
- **Overskytende sikkerhetsfunn er åpne** (SECURITY.md §3 og §5):
  `/dev/token` er den
  eneste innloggingsporten (F-S7), gjenbruk av frø mot en database med rader fra
  forrige prosess mynter duplikate `event_id` som `on conflict do nothing` slurper i
  stillhet (F-S5), `createWorld` leser ikke lenger en annen konto sin kommando men gir
  fortsatt 409 mot 201 og er damit et commandId-orakel uten å lekke data (F-S8), og
  `apps/mobile` har 28 advisories i
  avhengighetstreets verktøykjede mens Metro-dev-serveren binder LAN-adressen (F-S9).
- `docs/qa` har status, sikkerhetsrapport og narrasjonseval; `docs/ux` har bare
  statusnotatet sitt. Sprint 0-leveransene (klikkbar prototype, intervjuer,
  event-dictionary, testplan) er ikke startet.
