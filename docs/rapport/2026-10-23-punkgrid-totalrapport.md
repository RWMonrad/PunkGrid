# PunkGrid — totalrapport for ekstern gjennomgang

**Dato:** 2026-10-23 · **Kilde:** `main` ved commit `b826b79`, men worktree har én endring: denne rapporten, som ennå ikke er commitet
**Formål:** en komplett, frittstående forklaring på hele appen — med særskilt vekt på
spillmotoren, på hva som skal drive spillutviklingen videre, og på hvordan
PunkGrid-verdenen er illustrert i dag: typografi, stil, farger, hvor, hvor ofte og
hvor store. Rapporten er skrevet for at noen utenfor prosjektet skal kunne gi
tilbakemelding på forbedringsområder uten å åpne koden først.

**Slik leser du dette:** Seksjon 3 og 4 er kjernen (motoren og
utviklingsmaskineriet). Seksjon 5 er den visuelle identiteten, målt fil for fil.
Seksjon 6 er det vi vet står åpent. Seksjon 7 er de konkrete spørsmålene vi ber om
svar på. Alle tall er målt på disk denne dagen, ikke hentet fra minnet eller fra
gamle rapporter; målemetoden står oppgitt der det har betydning. Der et gammelt
tall i dokumentasjonen avviker, er det merket (§5.7).

---

## 1. Appen i ett bilde

PunkGrid er en **vedvarende, deterministisk verdenssimulering der tekst
forteller hva som har skjedd** — ikke en chatbot med langt minne. Spilleren
oppretter en privat verden (hvilken by, hvilket år, hvilken rolle), leser en scene,
velger én av 2–4 handlinger, og valget blir en **lagret domenehendelse**. Teksten
som blir skrevet om valget, *beskriver* hendelsen; den endrer den ikke. Dette er
hele arkitekturens grunnsetning, og alt nedenfor er avledninger av den.

Fire flater, én kjerne:

| Sted | Hva det er | Omfang (målt) |
|---|---|---|
| `core/src/` | Den deterministiske motoren: domene, reduksjon, regelmaskin, narrasjon, HTTP-adapter, Postgres-lager, outbox-worker | 242 kB TypeScript; `engine.ts` alene 1 224 linjer |
| `apps/mobile/` | Expo / React Native 0.86-spiller: 9 ruter, komponentlag, enhetsgang | 36 kildefiler (`.ts`/`.tsx`, før tester) |
| `apps/web/` | Statisk landingsside, 1 596 linjer HTML, 9 seksjoner | 23 bildefiler, 15 184 463 B |
| `docs/` | Master, Core Contract, 23 ADR-er, kunstkontrakt, QA-bevis | se §4.1 |

Kjører med Node ≥ 22.6:

```powershell
cd "C:\Users\Rune W. Monrad\CascadeProjects\PunkGrid"
npm install
npm run typecheck
npm test
npm run seed
```

**Ferske målinger fra i dag** (kjørt på denne maskinen, uten database):
`npm test` gir **323 passed | 26 skipped (349)** i **19 filer** på 5,9 s. De 26
hoppede er Postgres-settet, som er opt-in. `npm run typecheck` uten output.
Med database mot kastebasen `punkgrid_test`: **349 passed**, ingen hoppet
(målt 2026-10-15, dokumentert i `docs/qa/STATUS.md:19–26`).

---

## 2. Repo-kart

```
core/src/
  domain.ts        typer, DomainEvent, canonicalJson, stateHash, mulberry32
  reducer.ts       applyEvent — den eneste måten en hendelse endrer state på
  engine.ts        kommandoport, tid, scene, surprise, narrasjon
  rulepack.ts      typene på et regelsett (det som er innholdsformatet)
  glassHarbor.ts   referanseverden: Glass Harbor, Singapore 2034
  narrative.ts     promptbygging, validering, storedProse-fallback
  moderation.ts    deterministisk modereringsport + injeksjonskontroll
  api.ts           de elleve routene, transportuavhengig
  providers.ts     CompliantProvider (testprovider som bruker samme stemme)
  ai/                gateway-adapter: openai.ts, prompt.ts, env.ts
  server/          node:http-adapter, dev-autentisering, rate limit, worker
  db/              kysely/pg-lager, skjema, migrasjoner
apps/mobile/
  src/app/         ruter: index, genesis, setup, world/[id], history/[id],
                   library, account, paywall, preview, sign-in
  src/components/  Button, cards, hud, kit, nav, art, ReportSheet
  src/lib/         theme, fonts, art, plates, play, api, session, config, telemetry
  scripts/         device-walk.mjs (enhetsgangen), reading-order, copy-assets, art-check
docs/
  product/         PUNKGRID_PREDEVELOPMENT_MASTER_v1.0.md  (produktomfang)
  architecture/    REALITY_ENGINE_CORE_CONTRACT_v1.0.md + adr/ + migrations/
  design/          ART.md, brand/, inspiration/stitch-2026-10-12/
  qa/              STATUS.md, SECURITY.md, EVAL-narrative.md, evidence/, harness/
  ux/              STATUS.md (UX-loggen, ikke dekket i denne rapporten)
  rapport/         denne rapporten
```

---

## 3. Spillmotoren

Dette er den delen vi helst vil ha kritikk på, fordi den er det dyreste å endre
senere.

### 3.1 Den grunnleggende avtalen

> Verden er hendelseslogg. Alt annet er avlest.

`WorldState` er **algoritmens resultat**, ikke et tabellverk noen oppdaterer. Det
finnes én og bare én skrivevei: `commit()`. Alle kommandoer — valg, pause, arkiv,
surprise — går gjennom `executeCommand`, som sjekker autorisasjon, idempotens og
versjon, bygger ett sett hendelser, folder dem gjennom reduktoren, og skriver
**hendelser + snapshot atomisk** i ÉN databasetransaksjon (ADR-005). Det finnes
ingen vei utenom.

Konsekvensen som gjør dette verdt å lese: en episode som ble skrevet i 2034, kan
leses tilbake fem år senere og gi nøyaktig samme verden, fordi verden *er*
loggens rekkefølge, ikke en tilstand som har driftet.

### 3.2 Verdenstilstanden

`WorldState` (typene i `core/src/domain.ts`) bærer:

- `identities` — aktørene som deltok i verden, med `roleIds`
- `characters` — besetningen med `location`, `status`, `mood`
- `relationships` — nøyaktig én rettet kant per par (`relationshipKey`), klemmet
  mellom `-100` og `+100` (`clampRelationship`)
- `resources` — tall per aktør per ressurs (`cash`, `influence`, `credibility`)
- `facts` — påstander med `knownBy[]`, `verified`, `visibility` (`owner` |
  `participants` | `world`) og valgfri `sensitivePhrase`
- `arcs` — fortellingsbuer med status `locked | open | resolved | failed`
- `flags` — booleanske og verdibærende nøkler, blant annet `offerable:<choiceId>`
- `worldTime` — verdens eget klokkelag (ISO-streng), **separat fra virkelig tid**
  (ADR-010)
- `lastEventSeq`, `stateVersion`

**Ikke i `WorldState`:** profiletts tittel, fact-labels, de tilbudte valgene
(`offered_choices`) og `location` i blåtrykket. Disse er **visningsrader** —
avledete projeksjoner (ADR-015) — og de er derfor **ikke en del av** `stateHash`.
Denne skillen er det viktigste arkitektoniske valget i motoren: alt som skal kunne
replayes, må være hashbart, og det som bare er tekst på skjermen, må ikke det.

### 3.3 Loggen, reduksjonen og replay

**13 hendelsestyper**, låst i `core/src/domain.ts:51` (`EVENT_TYPES`):
`world.created`, `world.time_advanced`, `identity.entered_world`, `choice.resolved`,
`relationship.changed`, `resource.changed`, `fact.created`, `fact.disclosed`,
`story_arc.opened`, `story_arc.progressed`, `story_arc.closed`, `surprise.triggered`,
`scheduled_event.resolved`.

Hver `DomainEvent` har `schemaVersion: '1.0'`, `eventId`, `worldId`, `sequence`,
`commandId`, `type`, `actorCharacterId`, `causedByEventIds[]`, `payload`, `stateHash`
og tidsstempel. `sequence` er monotont per verden, og `causedByEventIds` lagrer
**årsakskjeden** — det er det som gjør historikken (UI09) mulig å skrive om uten å
 Gjette.

Reduksjonen er `applyEvent(state, event)` i `core/src/reducer.ts` (133 linjer). Ren
funksjon: `structuredClone` + en switch. Ingen I/O, ingen klokke, ingen tilfeldighet.

**Snapshot per versjon.** `world_snapshots` har **én rad per `stateVersion`** og er
ufravikelig. Det gir to egenskaper som en vanlig «siste tilstand»-tabell ikke gir:
`snapshotAt(worldId, version)` kan lese verdenstilstanden *slik den var* da episoden
ble lagt i køen, og `verifyReplay(worldId)` (`core/src/engine.ts:268`) kan folde hele loggen
på nytt og sammenligne:

```
verifyReplay → { storedHash, replayedHash, equal }
```

Dette er NFR-04 («0 ikke-deterministiske replayfeil») som en kjørbar påstand, ikke
som en intensjon. `npm run seed` avslutter med exit 1 ved drift.

### 3.4 Determinisme

Fire låser, alle målte:

1. **Kanonisk JSON.** `canonicalJson()` (`domain.ts:190`) sorterer nøkler og
   serialiserer deterministisk; `stateHash(s) = "sha256:" + sha256(canonicalJson(s))`
   (`domain.ts:207`). To hendelsesrekker som gir samme state, gir samme hash; to
   stater som skiller seg én boolean, gir helt ulik hash.
2. **Frø.** `mulberry32(seed)` (`domain.ts:151`) er den eneste tilfeldige kilden.
   Engine sin literal-default er **`20261011`** (`engine.ts:106`), overførbar med
   `PUNKGRID_SEED`. Id-er trekkes fra rng-en (`makeIdFactory`, `domain.ts:178`),
   ikke fra `randomBytes` eller klokken.
3. **Frø per prosess.** ADR-021: to prosesser som delte klokkefrø, delte hele
   id-rommet og kolliderte — det er rotårsaken til den navnløse HTTP 500-en i
   verdenoppretting. Frøet er derfor nå én trekning per prosess.
4. **Simuleringer trekker ikke id-er.** `assertSceneFloor` projiserer framtidige
   effekter med `() => 'evt_simulated'` (`engine.ts:1008`) — en øving må ikke flytte
   den deterministiske telleren, ellers vil selve sjekken endre verden.

Det gylne hash-festet er `sha256:ba95bdda…6247`
(`core/scripts/seed-glass-harbor.ts:120`), oppnådd med 28 hendelser, versjon 7,
`replay equal: true`.

### 3.5 Kommandoporten

Hver mutasjon krever **tre** ting (`core/src/api.ts:92–98`, `:162–166`):

```
Idempotency-Key  ==  body.commandId        (mismatch → INVALID_SCHEMA)
expectedWorldVersion                       (CAS: optimistisk lås)
actorIdentityId                            (hvem som spiller)
```

`requestHash({kind, worldId, …})` (`domain.ts:212`) lagres med kommandoen. En
identisk kommando på nytt gir **samme kvittering uten ny hendelse** — det er
NFR-06, og det er målt native på ekte emulator ved «tapt kvittering + retry»
(`docs/qa/evidence/ui-fault/2026-10-14T21-08-12-195Z/`).

### 3.6 Tidsmodellen

```
time: { tickMinutes: 360, maxCatchupTicks: 5,
        maxWorldTimeJumpMinutes: 1440, ambientProgressPerTick: 1 }
```
(`glassHarbor.ts:9`)

Verdens klokke går i **6-timers steg**. Når en spiller kommer tilbake etter tre
dager, tar catch-up **maks 5** ticks — verden venter ikke på spillere som er borte,
men den går heller ikke baklengs. `world.time_advanced` er en helt vanlig
logghendelse, så tiden i seg selv er replikerbar.

> **Observasjon for gjennomgåreren:** `ambientProgressPerTick` er erklært i
> regelsettet og i typen (`rulepack.ts:104`), men **leses ikke av motoren noen
> sted**. Funnet er verifisert med grep over hele `core/src` og `apps/mobile/src`:
> to treff, begge definisjoner. Det er altså én parameter som ser ut som en del av
> tidssystemet, men som ikke gjør noe.

### 3.7 Scene-produksjonen — det som faktisk er spillet

Dette er motoren sitt svar på «hva kan spilleren gjøre nå», og det er der vi tror
at en ekstern gjennomgang har mest å si.

Kjeden (`core/src/engine.ts`):

```
eligibleOffers(state, worldId)          :926   alle flagg offerable:<id> == true,
                                               hva regelen krever, hva verden råder
capOffers(list, worldId, upToSequence)  :945   kutt ned til max, sortert med
                                               offerHistory(:969) og declared-rekkefølge
choicesAt(worldId, version)             :921   alt sammen, fra SNAPSHOTET for versjonen
submitChoice(...)                       :455   neker uutstedt valg: CHOICE_NOT_OFFERED
assertSceneFloor(...)                   :997   neker trekk som ville tatt scenen
                                               under min: SCENE_CHOICE_FLOOR
```

**Intervallet er 2–4** — `offerPolicy: { min: 2, max: 4 }` (`glassHarbor.ts:11`,
ADR-022, vedtatt 2026-10-15). Det var lenge et løfte uten vakt: målt brøt Glass
Harbor det i **begge ender** (5 tilbud og 1 tilbud). Nå håndheves det:

- **Taket er et *kutt*, ikke en nekt.** `capOffers` skriver ingen flagg — det er en
  visning over kanonisk state, så replay og alle hash-verdier er urørte.
- **Rekkefølgen i kuttet er meningsfull:** «nytt åpnet» først (`opened`-sekvens
  høyest), så «aldri brukt» (`used` lavest), så rekkefølgen i regelsettet. Altså:
  verden byr på det den nettopp låste opp, og det spilleren nettopp valgte, får vente.
- **Gulvet er en *nekt*,** og her er regelpakkens svar på «låst spiller»: før en
  handling skrives, projiserer motoren hvilken state den vil gi, og **neker den
  bare dersom ett annet utstedt tilbud holder gulvet**. Verden kan stå med ett
  tilbud; den kan aldri låse seg. `:1013`: `SCENE_CHOICE_FLOOR — "That move would
  leave you with nowhere to go. Try another one."`

**Målt, på disk, 2026-10-15** (`docs/qa/STATUS.md:27–40`): genesis 4 → etter
`open_negotiation` **4** (var 5) → gjentatt `open_negotiation` nektet uten ny
hendelse → etter ti `brief_staff` fra tomt `cash`/`influence` holder scenen **2**
(var 1) → den ellevte nekes med `SCENE_CHOICE_FLOOR` mens `confront_mara`
gjenoppretter scenen. 47 versjoner, `verifyReplay` lik. Read-only SQL-scan av
dev-basen: maks **3** tilbud per versjon, **0** rader over `max`.

**Mutasjonssjekk** (derfor tror vi på tallet): `offerPolicy` satt til
`{ min: 0, max: 99 }` gjør de to policy-gullentestene og cap-nektingen **røde**.
Pakken er stilt tilbake.

**Én bestemt unntakssituasjon:** `eligibleOffers` og `capOffers` sorterer på
`a.choiceId.localeCompare(b.choiceId)` (`:942`, `:965`, `:967`). `localeCompare` er
ICU-avhengig. Prosaen for øvrig er språkuavhengig (`style.language: 'en'`), så
valgrekken er det eneste stedet der en internasjonalisert sorteringsrekkefølge kan
skille seg mellom kjøremiljøer. Gulltestene fanger det ikke i dag.

### 3.8 Genesis — slik en verden åpnes

`createWorld` med `mode: 'create'` går: valider blåtrykk → slå opp mal → bygg
startstate → logg `world.created` → skriv snapshot versjon 1 → legg første episode
i køen.

**ADR-023 (vedtatt 2026-10-15) er det viktigste produktvedtaket vi har tatt i
senere tid.** Før dette: oppsettsskjermen *validerte* tid og rolle, og `createWorld`
åpnet **alle** verdener på §12 sine referanseverdier (2034 + founder/CEO). Spilleren
hadde et valg som ikke valgte noe. Nå:

- `template.eraStarts` (`glassHarbor.ts:43–47`) — 2034, 2019, 1888, alle
  `09:00`, slik at en valgt æra **flytter klokken verden åpner på**
- `template.roleGrants` (`:53–57`) — founder-ceo / investigator /
  operations-director, hver med sin `roleIds` og sin tittel
- oppslag i `engine.ts:326–328`; en mal som erklærer en tid eller rolle den ikke kan
  starte på, nekes som `INVALID_BLUEPRINT` (`:421–422`) — **pakkefeil, ikke
  spillerfeil**
- målt i gulltesten «opens a world on the era and role the player chose»:
  `1888 / copenhagen / investigator` gir `worldTime = 1888-09-15T09:00:00.000Z`,
  `roleIds = ['investigator']`, tittel «Investigator, Helix Transit», replay lik.
  Gullhashen er **urørt** — endringen er nøytral for alle verdener som allerede
  finnes.

**Blåtrykket er fortsatt pipeline, ikke kanonisk state** (ADR-023 punkt 5):
`location` fra oppsettet styrer premiss, kunst og stedstavler — men det står ikke i
`WorldState` og ikke i `stateHash`. Det er med andre ord **med vilje** en
ikke-replikerbar oppsettsparameter, og det er en åpen beslutning en gjennomgår bør
ha en mening om.

### 3.9 Surprise Me og overraskelsesmaskinen

To ting: **genesis-surprise** (étt trykk, verden blir laget for deg) og
**surprise families** underveis.

```
surpriseBudgetPerDay: 2      (glassHarbor.ts:12)
cooldownWorldHours: 24       (:188, per familie)
freeWorldQuota: 1            (:13)
```

`requestSurprise` → `engine.ts:535`: uten gyldige familier returneres
`noOpReason: 'NO_ELIGIBLE_SURPRISE'`; `:836` sjekker nedkjøling i *verdens* tid,
ikke i virkelig tid; `:842` sjekker dagsbudsjett. Effektene skrives via
`buildEffectEvents` (`:544`) med statusflaggen `surprise:<familyId>:at` i
`WorldState.flags` (`:551`), lest tilbake i `:825` og `:835`.

`freeWorldQuota: 1` er kvoten som gjør at «Surprise Me»-døren på UI02 kan si hva
den koster i kvote (§6).

### 3.10 Narrasjon — ut av bandet, inn igjen som tekst

Dette er delen av systemet som koster penger, og derfor den mest regelstyrte.

```
commit()  →  world + episode-rad (status: pending)  →  outbox-jobb
outbox-worker (core/src/server/worker.ts)
  ├─ leser episode sin egen verdensversjon (IKKE nyeste snapshot)
  ├─ choicesAt(worldId, version) → allowedChoiceIds for den versjonen
  ├─ bygger prompt (core/src/ai/prompt.ts)
  ├─ providerforsøk (core/src/ai/openai.ts), OpenAI-kompatibel gateway
  ├─ validerer svar mot schema: bare valg fra allowedChoiceIds, bare navn som
  │  finnes, ingen brudd på forbudte ord, injeksjonssjekk
  ├─ modereringsport (core/src/moderation.ts:79 screenText, :92 containsInjection)
  └─ skriver prosa: published  ELLER  fallback
```

**Budsjett** (målt fra kilde, `engine.ts:1057–1090`):

| Regel | Verdi | Sted |
|---|---|---|
| Eneste kostnadstall per episode | `unitCost = 0.004` USD | `engine.ts:1057` |
| Hard tak per bruker per dag | `usdBudgetPerUserPerDay = 2` | `engine.ts:108` |
| Token-tak per forespørsel | `tokenBudget = 2000` | `engine.ts:1078` |
| Ut-data-tak | `min(1024, max(128, floor(budget/2)))` | `ai/openai.ts:164` |
| Forsøk per provider | 2, deretter fallback | `engine.ts:1090` |
| Registering | `registerRun(...)` med `validationStatus` (`checked`, `rejected:<kode>`, `provider_failure`) | `:1090`, `:1114` |
| Promptversjon | `provider.promptVersion ?? 'p1'` | `:1060` |

**Fallbackstemmen.** Uten `PUNKGRID_AI_*`-nøkler er den eneste teksten en spiller
noen gang får, `storedProse()` (`core/src/narrative.ts:99`) — brukt av **både**
`CompliantProvider` (`providers.ts:20`) og engine sin fallback-vei (`:1016`). Det er
**én mal, ikke to**, med vilje. Malen sier bare det loggen faktisk inneholder:
verdenstid i UTC uten locale, én setning per **hendelsestype** i den rekkefølgen
typene først opptrer, inntil tre andre aktørnavn, og til slutt hvilket tilbud
recorden lar spilleren stå på. Tidligere skrev den `2 committed event(s) recorded.`
og `Available actions: a_brief_staff, …` — regelsettets identifikatorer rettet mot
en utvikler. Det er nå målt bort: tre porter i `core/tests` krever at teksten har
markøren `own words, with nothing added`, er nøyaktig **tre avsnitt**, og ikke
inneholder én eneste `liten_liten`-identifikator (`not.toMatch(/[a-z]+_[a-z]+/)`).

**Dokumentert drift, lukket:** en episode som lå i køen mens verden gikk videre,
ble narrert fra **nyeste** snapshot. Nå leser alt episodeversjonen sin:
`Store.snapshotAt` → `Engine.choicesAt` → `generateEpisode`. `currentChoices` er
`choicesAt` ved hodet, så `GET /v1/worlds/{id}` er uendret. Testen binder begge
ender: episode 1 får versjon 1 sine fire tilbud og fakta, episode 2 får `reject_sale`
og `fact_exclusivity_demand`.

**Payload-berikelse (ADR-024, 2026-10-24).** Prompten som gikk til gatewayen
inneholdt bare ID-er — `authorized_pov_facts: ['fact_offer']`, tomme
`character_profiles`, ingen relasjonstall, ingen ressursverdier, ingen
buestatus. Det gjorde det umulig for gatewayen å skrive scene-prosa som refererte
til hva spilleren faktisk visste, hvilke mål figurene hadde, eller hvordan
relasjonene sto. `NarrativeRequest` har nå fem valgfrie berikelsesfelt:
`authorizedFactLabels`, `characterTitlesAndGoals`, `relationshipValues`,
`resourceValues`, `arcStatuses`. `engine.ts:1055–1095` bygger dem fra
snapshot-et; `ai/prompt.ts` sender dem videre som `authorized_fact_labels`,
`character_titles_and_goals`, `relationship_values`, `resource_values`,
`arc_statuses`. Alle er additive og bakoverkompatible — uten dem forblir
payloaden den gamle ti-nøkkel-versjonen. Testen i `core/tests/ai.test.ts`
teller nå 15 nøkler i `data`-blokken og sjekker at `authorized_fact_labels`
inneholder `fact_offer`, at `character_titles_and_goals.char_player` har
`tittel` og `mål`, og at `relationship_values` og `resource_values` er
populert fra snapshot-et.

**Stilbinding** (`glassHarbor.ts:15–21`):

```
pov: 'second person, present tense'
tone: 'dry, tense, near-future noir'
language: 'en'
lengthTarget: 140
forbidden: ['system','prompt','token','model']
```

### 3.11 API-et: elleve ruter, ikke flere

`core/src/api.ts` er transportuavhengig; `server/http.ts` + `server/app.ts` er
node:http-adapteren (ADR-016). Rutene:

```
POST /v1/worlds                                  opprett (create | surprise)
GET  /v1/worlds                                  liste (IKKE paginert)
GET  /v1/worlds/{id}                             {world, stateVersion, summary, choices}
GET  /v1/worlds/{id}/episodes[/{episodeId}]      paginert, nextCursor
POST /v1/worlds/{id}/episodes/{eid}/reports      ADR-018, den eneste ikke-kommandoen
POST /v1/worlds/{id}/choices                     velg
POST /v1/worlds/{id}/surprises                   be om overraskelse
POST /v1/worlds/{id}/resume                      |
POST /v1/worlds/{id}/pause                       |
POST /v1/worlds/{id}/archive                     |
```

Alle POST utenom reports krever `Idempotency-Key` + `commandId` +
`actorIdentityId` + `expectedWorldVersion`. `POST /v1/worlds` svarer **202** om
episoden er `pending|generating|retrying`, **201** om den er skrevet.

> **Observasjon:** `episode.acknowledge` finnes som kommandotype i
> `engine.ts:582` (`acknowledgeEpisode`) og som event-kode i `domain.ts:45` og
> `db/schema.ts:44` — men **det finnes ingen HTTP-rute for den**. Den er ikke
> tilgjengelig for noen klient, og `core/tests/api.test.ts:193` fatter at
> `/v1/worlds/{id}/acknowledge` gir **404**.

### 3.12 Regelpakken er innholdsformatet

`rulepack.ts` er typen som avgjør hva en **ny verden** er. En ny verden er ikke ny
kode; den er en ny `RulePack` med:

```
id, version
time          { tickMinutes, maxCatchupTicks, maxWorldTimeJumpMinutes,
                ambientProgressPerTick }
offerPolicy   { min, max }
templates[]   allowedLocations/Eras/Roles, constraints, eraStarts, roleGrants,
              characters, facts, arcs, worldTime, playerGoals, genesisChoiceIds
choices[]     { id, label, copy, requires, effects }
surprises[]   { id, cooldownWorldHours, effects }
surpriseBudgetPerDay, freeWorldQuota, style
```

**Glass Harbor** (`core/src/glassHarbor.ts`, 201 linjer) er den eneste pakken som
finnes. 28 hendelser, 4 steder (Singapore 2034, Copenhagen, Lagos, Mars), 3
æraer, 3 roller, 6 skuespillere, 42 gulltesttilfeller mot den. To `constraints`
viser hvordan plausibilitet håndheves uten AI:
`mars-needs-alternate-history` og `victorian-mars-impossible` krever
`requireFlags: ['alternate_history']`.

**Dette er maskineriet som skal drive spillutviklingen:** framtidige spill = flere
regelpakker. `docs/product/…MASTER…` §4.5 og ADR-003 sier det samme på produktmål:
**avgrensede valg før fri tekst**. Motoren er bygget for at en innholdsprodusent
skal kunne skrive en verden uten å skrive en linje TypeScript.

---

## 4. Hva som driver utviklingen

### 4.1 Dokumenthierarkiet (normativt)

```
PUNKGRID_PREDEVELOPMENT_MASTER_v1.0.md   produktomfang, brukarforsking, MVP-grense
  ↓ styrer
REALITY_ENGINE_CORE_CONTRACT_v1.0.md     normativ for simulering, API, gulltester
  ↓ presiseres av
docs/architecture/adr/ADR-0NN-*.md       hvert avvik logges som ADR FØR implementasjon
  ↓ verifiseres av
docs/qa/STATUS.md + SECURITY.md + evidence/    målte tall, ikke intensjoner
```

Regelen (Master §9.1 steg 1 + Contract §18): **ethvert avvik mellom dokumenter,
eller arkitektur-/produktvedtak som endrer normative kontrakter, skal registreres
som ADR før implementasjon, og begge dokumenter rettes.** Det er grunnen til at vi
vet hva som er endret, og hvorfor.

### 4.2 MVP: F01–F17

Master sin featureliste med Must/Should. **MVP-grensen er F01–F17**
(`PUNKGRID_PREDEVELOPMENT_MASTER_v1.0.md:170`); F18 kan ligge bak feature flag inntil
kjøpsflyten er testet, og det står uttrykkelig: *ikke lov å kalle gratisprototypen
«freemium-lansert» før kjøpsflyten er testet.*

| | Feature | Krav | Str | Avhengighet |
|---|---|---|---|---|
| F01 | Onboarding + 18+-port | Must | M | Auth/policy |
| F02 | Gjestepreview → konto | Must | M | F01 |
| F03 | World Genesis-mal og validering | Must | L | Core |
| F04 | Create a Life: WHO/WHEN/WHERE | Must | M | F03 |
| F05 | Surprise Me-start | Must | M | F03 |
| F06 | World home / resume | Must | M | F03/F08 |
| F07 | Episode reader / choice cards | Must | L | F08/F10 |
| F08 | Verdenstilstand + event-sourcing | Must | XL | DB |
| F09 | Regelmotor / konsekvens / relasjoner | Must | XL | F08 |
| F10 | AI-narrasjon + schema/fallback | Must | XL | F09 |
| F11 | Minne + POV-kunnskap | Must | L | F08 |
| F12 | Surprise-engine med nedkjøling | Must | L | F09/F11 |
| F13 | Tid/catch-up ticks | Must | L | F08/F09 |
| F14 | Rapport, moderering, sikkerhetsfilter | Must | L | F10 |
| F15 | Sletting/eksport/personvern | Must | L | DB/Auth |
| F16 | Analyse av aktivering, D7, kostnader | Must | M | Event spec |
| F17 | Feature flags + config | Must | S | Hosting |
| F18 | Betaling / free limits / entitlements | Should | L | Auth/IAP |
| F19 | Episodebilde / cache | Should | M | F10/Media |
| F20 | Konsekvensoversikt / beslutningsjournal | Should | M | F08 |

### 4.3 NFR-01 … NFR-12: mål mot målt

| NFR | Krav | Hva vi faktisk målte |
|---|---|---|
| 01 | p95 < 500 ms på databasebaserte GET | **i minne:** p95 57 ms (1 000 økter). **Mot Postgres + worker: p95 46 ms.** Men: 1 000 *samtidige forespørsler* over én prosess gir **p95 1 031 ms**, metning ~2 600 req/s → **FAILED** |
| 02 | p75 < 20 s fra opprettelse til første scene | **p75 3,7 s** commit → publisert prosa, mot Postgres med outbox på banen |
| 03 | ≥ 99,5 % oppetid | ikke målt (krever produksjon) |
| 04 | 0 tapte commits, 0 replayfeil | `verifyReplay` lik over 47 versjoner; gullhash match |
| 05 | 0 tverrbrukerlesinger | 20 negative blokker + RLS-positiver, kjørt mot lokal PostgreSQL 16 med `SET LOCAL ROLE` |
| 06 | retry uten duplikat | idempotens-suite; målt native med tapt kvittering |
| 07 | WCAG 2.2 AA | se §5; to punkter gjenstår (skjermleser, iOS) |
| 08 | all UI-copy eksternt nøkkelstyrt | **ikke oppfylt** |
| 09 | request id, pseudonym world id, latency, tokenkostnad | responsene bærer `requestId`; `registerRun` logger tokens og kostnad |
| 10 | varsel + hard tak før provider-spend | `unitCost 0.004`, `usdBudgetPerUserPerDay 2` håndheves i `engine.ts:1068` |
| 11 | PITR/backup, RPO ≤ 24 t, RTO ≤ 8 t | **ikke øvd** |
| 12 | 1 000 samtidige økter | kjørt i begge former, se 01 |

Master sin fotnote står, og vi holder oss til den: D1/D7/D30-tallene og
responsmålene i masterdokumentet er **prosjektkrav, ikke dokumentert ytelse**
(`docs/qa/STATUS.md:870–871`).

### 4.4 ADR-loggen: 23 vedtak

Fullstendig register i `docs/architecture/adr/README.md`. Gruppert etter hva de
avgjør:

**Spilllogikk (5):**
- **ADR-003** Avgrensede valg før fri tekst
- **ADR-006** Async episodegenerering, stabil polling
- **ADR-010** Verdensklokke separat fra virkelig tid
- **ADR-022** Scenens intervall (2–4) håndheves av motoren: tak, gulv, ingen låst
  spiller
- **ADR-023** Valgt æra og rolle åpner verden — blåtrykket er pipeline, ikke state

**Datamodell og integritet (7):**
- **ADR-001** PostgreSQL er autoritativ; AI har **aldri** skriverettighet
- **ADR-004** Verdenseier ≠ identitet ≠ medlemskap
- **ADR-013** Målesemantikk: førstespill og NFR-02-tid er to ulike mål
- **ADR-014** Sletting/retensjon — **`Proposed`**, juridisk godkjenning er grind før
  F15-implementasjon
- **ADR-015** Avledete projeksjonstabeller (`world_facts`, `offered_choices`)
- **ADR-021** Frø per prosess + eiervernet world-claim

**Plattform og transport (4):**
- **ADR-002** Modulær monolitt, ikke mikrotjenester
- **ADR-011** Client- og plattformstack-defaulter (Expo/RN, node:http)
- **ADR-016** node:http-adapter, transportvokabular, dev-autentiseringsport
- **ADR-019** `rulepackId` i verdenslista — klienten skal ikke vise en rå id

**Kostnad, sikkerhet, moderering (6):**
- **ADR-007** Bare private verdener i release A
- **ADR-008** Modelladapter og provider-budsjett **før** generering
- **ADR-009** Aldersport 18+ i første offentlige release
- **ADR-017** Narrasjonsadapter mot OpenAI-kompatibel gateway
- **ADR-024** Narrasjons-payload beriket med faktaetiketter, tittel/mål,
  relasjonstall, ressurser og buestatus — fem valgfrie felt i `NarrativeRequest`
- **ADR-018** Innrapporteringsrute + deterministisk modereringsport
- **ADR-020** Rate limit-bøtten i PostgreSQL, delt på tvers av prosesser

**Prosess (1):** ADR-012 Dokumentharmonisering (FR-04 mot Contract §5: antall valg
og gratiskvote) — med andre ord: **det første ADR-et vi tok, var at dokumentene
motsa hverandre.**

### 4.5 Utviklingsmaskineriet

Fire ting som gjør at vi faktisk kan endre motoren uten å ødelegge verden:

1. **Gulltestene** — `core/tests/golden.test.ts`, **42 tilfeller**, inkludert
   regresjoner for versjonsbundne tilbud, deaktiverte valg,
   surprise-effektflagg, 2–4-intervallet, og at valgt tid/rolle åpner verden.
   Fast hash: `sha256:ba95bdda…6247`.
2. **Mutasjonssjekk.** Hver sikkerhetsregel verifiseres med å gjøre den med vilje
   gal og se hva som blir rødt. Eksempler: `offerPolicy {min:0,max:99}` → rødt;
   reversert låsenøkkel i arc-fiksen → `expected 3 to be 6`. En grønn test som ikke
   biter, er ikke et bevis.
3. **Enhetsgangen** — `apps/mobile/scripts/device-walk.mjs` kjører spillet på en
   ekte Android-emulator med `adb`, dumper tilgjengelighetstreet, og påstår
   geometri og rekkefølge, ikke at knappen finnes i kilden. **136/136** ved
   tekstskalering 1.0 og **135/135** ved 2.0 (2026-10-15). Hver kjøring etterlater
   seg treet (`.xml`) + `walk.json` i `docs/qa/evidence/`; disse **ligger i git**
   (921 filer, 23,5 MiB — 865 `.xml`-dumper, 43 JSON, 9 små vidder, 3 TXT, 1 MJS).
   Skjermbildene (914 PNG, 654,4 MiB på disk) er **ignorert** av git med vilje; de
   ni PNG-ene som ligger i historikken, er de små viddene oppsummert over.
4. **Bevisregisteret** — `docs/qa/STATUS.md` (871 linjer) er loggen over hva som er
   målt, når, på hvilken hash, og hva som ikke er det.

### 4.6 Det som egentlig driver spillutviklingen — og hva som ikke driver den

Vi vil ha kritikk nettopp her. Vår egen vurdering:

**Det som driver:**
- Motoren er **lav, deterministisk og ferdig**. Påstanden «valg er lagrede
  domenehendelser» er innfridd og verifiserbar.
- **Regelpakken er et reelt innholdsformat.** Ny verden = ny JSON, ikke ny
  TypeScript.
- **Kontraktstyrt utvikling** har allerede funnet og lukket to funksjonstabber som
  ikke syntes i koden (ADR-022, ADR-023).
- **Tilgjengelighet og geometri er målt, ikke håpet.**

**Det som IKKE driver, ennå:**
- **Det finnes én verden.** Glass Harbor er en *testfixture* — alle tallene i den
  er kontraktverdier fra §12, «ikke spillbalanse» (står i `glassHarbor.ts:2` selv).
  Vi har ikke ett eneste bevis på at en spiller vil bli i verden.
- **Ingen prøvekjøring med ekte modell.** `CompliantProvider` er vår egen
  teststemme. `storedProse` er det en spiller faktisk får. Prosekvaliteten hos en
  levende modell er **aldri målt** (FR-19, se §6D).
- **Innholdsproduksjon er ikke definert utenfor kode.** Rulepack er
  TypeScript/JSON i `core/src/`. Det finnes ikke editor, validerings-UI eller en
  prosess for at noen som ikke er utvikler, skal kunne lage en verden.
- **Meknikken for «mening» er tynn.** 6 skuespillere, 3 ressurser, 17 buer i én
  mal. Motoren kan håndheve 2–4 valg og en årsakskjede; den kan ennå ikke svare på
  om valget kjennes som noe.

---

## 5. Hvordan PunkGrid-verdenen er illustrert i dag

Alt nedenfor er målt i denne omgangen: tokena er lest fra
`apps/mobile/src/lib/theme.ts` og `plates.ts`, bruken er tallet med grep over
`apps/mobile/src` (`.ts`+`.tsx`, antall `color.X`-referanser), kunsten er dekodet
for pikselmål og bytes, og skjermkartet er avledet fra `device-walk.mjs`,
`docs/qa/STATUS.md` og Master §5.3.

### 5.1 Farge: 14 token, ett system, to verdener

Appens palett er «Cyber-Tactical HUD» — hentet fra Stitch-mockupene
(`docs/design/inspiration/stitch-2026-10-12/`, `DESIGN.md`), **men med målte
kontrastforhold i stedet for deres eget tall**. Begrunnelsen står i `theme.ts` selv:
mockupenes egne teal-på-void-par **failer** SC 1.4.3 og 1.4.11 i de størrelsene de
tegner dem. Det vi tok derfra, er signalet, ikke forholdstallet.

| Token | Hex | Betydning i verden | Bruk (antall / filer) |
|---|---|---|---|
| `ink` | `#0D1223` | Tekst-skriftfarge, taket i bakgrunnsrampen, tekst på accent | 19 / 7 |
| `deep` | `#070A14` | Golvet i bakgrunnsrampen (kantene) | 6 / 5 |
| `surface` | `#18213A` | Flaten: panel, kort, fliser | 32 / 16 |
| `raised` | `#24314E` | Fyll alene: knapp, toast, trykt tilstand | 13 / 6 |
| `violet` | `#A58BFA` | **Bekreftelse** — skjermas eget «ja» | 16 / 10 |
| `cyan` | `#00F5D4` | **Døren som starter et liv**, instrumentavlesning, fokusring | 39 / 15 |
| `magenta` | `#F72585` | Fiendtlig fyll/kant (aldri lesbar tekst) | **0 / 0** |
| `pink` | `#FFB1C6` | Det fiendtlig lagets lesbare tone | **0 / 0** |
| `amber` | `#FFB703` | Verken/ikke: ventende episode, pauset motor | 2 / 1 |
| `danger` | `#FF8F99` | Feilmelding | 8 / 5 |
| `success` | `#8BE0B0` | Suksess, og ressursen `cash` | 7 / 4 |
| `text` | `#F5F7FF` | Brødtekst | — |
| `muted` | `#BDC8E1` | Etiketter, sekundær tekst, `label`-tone | 46 / 15 |
| `line` | `#66789C` | **Kanten som viser hvor en kontroll er** | 29 / 13 |

`onAccent = color.ink`. Grunnen: på cyan og violet er **mørk ink det eneste** som
når 4,5:1 i brødtekststørrelse — så de to parene er låst her, ikke overlatt til
hver skjerm.

**Kontrast, målt** (`apps/mobile/src/lib/contrast.test.ts`, 18 tilfeller, grønt):
**95 tekstpar** mot SC 1.4.3 — svakste **5,82** (`cards.tsx · episodeKicker` og
`preview.tsx · kicker`, begge violet på surface). **33 kanter** mot SC 1.4.11 —
svakste `color.line` **3,59** mot surface (4,20 mot ink). 12 bakgrunnsplater mot
ankerfargen. 8 trykktilstander flattet med opasitet — svakste **5,23**.
`accent`-flaten måler **8,35** i trykt tilstand. Fokusringen måler **7,83–11,27**
mot alle tre flatene en kontroll kan ligge på.

**To farger er definert og brukt i null skjermer.** `magenta` og `pink` eksisterer i
systemet som «det fiendtlige laget», med full dokumentasjon på hvorfor de ikke kan
brukes som tekst — men **ingen komponent bruker dem**. Amber står med to treff i én
fil. Dette er vår egen konstatasjon: **paletten vår er større enn språket vårt.**

### 5.2 Typografi

**To familier, fem snitt**, lastet én gang i router-rota
(`apps/mobile/src/lib/fonts.ts`, fra `@expo-google-fonts/*`, ikke lokale
`.ttf`-filer):

| Snitt | Nyttelast |
|---|---|
| `PlusJakartaSans_400Regular` | alt en spiller **les**: prosa, titler, brødtekst |
| `PlusJakartaSans_700Bold` | valgbrikker, knappetekst, overskrifter |
| `PlusJakartaSans_800ExtraBold` | **én** plass — ordmerket |
| `JetBrainsMono_400Regular` | tall og adresser som skal leses tegn for tegn |
| `JetBrainsMono_700Bold` | **telemetri**: alle HUD-avlesninger, etiketter, chips |

Bruk (antall `face.X`-referanser): `monoBold` **22**, `mono` **12**, `sansBold`
**11**, `sans` **10**, `sansHeavy` **1**. Mono er altså **tett** i bruk — den er
skrifttypen som sier «dette er instrumentet», og den brukes mer enn lesetekstens
eigen regular-vekt.

**Type-skala** (`theme.ts`, 6 trinn, i dp):

```
caption 12 · label 14 · body 16 · lead 20 · title 24 · display 32
```

**Viktige detaljer:**
- Mono-snittene brukes med **`letterSpacing` 0,4–0,8** og `fontWeight: '700'`
  eksplisitt. Begrunnelsen i `theme.ts`: vekt-paaste familier, «because a
  synthesized bold is a lie a fixed-width face especially refuses to tell».
- **`maxFontScale = { body: Infinity, chrome: 2 }`**. Lesetekst følger
  plattforminnstillingen uten tak; chrome stopper på standardens eget tall (200 %).
  At taket **kan** være 2 og ikke 1,6 som før, er målt på enheten. Layouten som
  skulle til er fikset i stedet: `Row` i `Button.tsx` har `flexWrap: 'wrap'`,
  valgbokstaven i `cards.tsx` er størrelsesbestemt av padding i stedet for en
  26×26-boks, `minWidth: 132` i stedet for `width: 132` med `overflow: 'hidden'` i
  `setup.tsx`, `flexShrink: 0` på bunntekstfeltet i `Screen`, og handlingene i
  `ReportSheet.tsx` brytes likt.
- **84 `Text`-elementer** i appen må **alle** si sin maksimale multiplikator — det
  er en test som blir rød om noen skriver ny tekst uten å ta stilling til skalering.

### 5.3 Stil: den visuelle grammatikken

Dette er det viktigste avsnittet i seksjon 5. Appen har et **låst språk** for hva
farge og hjørnetegn *betyr*, bygget inn i komponentlagene — ikke i skjermene — slik
at en skjerm ikke kan vike fra det alene.

| Signal | Betydning i verden | Hvor det er målt |
|---|---|---|
| **Fylt cyan `accent`** | **Den ene døren som starter et liv** | `Create a Life` (UI01), `Surprise Me` (UI02), `Begin a new life` (UI07) — og **ingen** annen plass |
| **Violet `primary`** | Skjermas egen **bekreftelse** | standardvarianten i `Button.tsx`: `Back to the scene` (UI09), `Go to the welcome screen` (UI10), `Retry this decision`/`Reload the world` (UI04), `Create world` (UI03) |
| **Cyan `CornerTicks`** | **Instrumentavlesning** | `StatTile`, scenevinduet i UI04, `WorldCard`, avlesningspanelet i UI07 |
| **`color.line`-hjørner** | **Innstillingspanel** | `Section` i UI10/UI03/UI11, utvidelsen av handlingene i UI04, diagnostikken i UI10 |

**Delte regler:**
- **Én lys dør per skjerm.** De fire valgdørene i UI04 får derfor **ikke** accent —
  ingen av dem er prioritert, **valget er selve spillet.**
- **Ressursfarge på `StatTile`** sin venstre-rail (3 dp): `cash` = success,
  `influence` = cyan, `credibility` = violet. Tre fliser i en rad leses som **tre
  slag tall** uten at spilleren leser navnet.
- **Valgfargen på `ChoiceCard`** A/B/C/D: cyan, violet, success, muted. Fire kort i
  en kolonne leses som **fire ulike dører** uten at spilleren leser bokstaven.
- **Glow** (`theme.ts::glow`) — `textShadowRadius: 12`, null offset, samme tone som
  tallet selv: tallet som betyr noe får en myk krone **under** glyfen, der den ikke
  rører en kant. Android ærer `textShadowColor`. **Dekorasjon alene** — meningen er
  i labelen, aldri i gløden. Brukt i **1** fil (`hud.tsx`).
- Alt som er dekorasjon, er målt **utenfor lesetreet**: `CornerTicks` og all kunst
  har `accessibilityElementsHidden`.

**Bakgrunnsrampen** (`apps/mobile/src/lib/plates.ts`): React Native har ikke gradient
uten en avhengighet, og det mockupene vasker, er **en luminansramp med en horisont,
ikke en farge**. Derfor: `plates(6)` bygger **13 bånd** som går `deep` → `ink`
(6 steg) og speiles tilbake ned til `deep`. Taket er regelen som holder dette
ærlig: **rampen går aldri høyere enn `ink`** — den fargen tekstparene er ankret til
— så hvert band siden maler, er høyst like lyst som ankeret `contrast.test.ts`
måler mot. `rampSteps = 6`: nok til at steget ikke leses som striper på en vanlig
telefon.

### 5.4 Mål og geometri

```
space:      xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32    (dp)
radius:     sm 8 · md 12 · lg 20                            (dp)
touchTarget: 44                                              (dp, SC 2.5.8)
focusRing:  { borderWidth: 2, borderColor: cyan }             (SC 2.4.7)
```

Representative geometrier målt i `hud.tsx`:
`tile { minWidth: 96, padding: 12, borderWidth: 1, borderLeftWidth: 3, radius: 12 }` ·
`liveDot 10×10` · `beacon 6×6` · `hairline height 1` · `tick 12×12` ·
`doorScan` = 32 % bredde × 2 dp cyan · `door { minHeight: 44, padding: 16 }` ·
`chip { padding: 8 × 2, radius: 8 }` · `ArtBand` i HUD = **96 dp høy**.

**44 dp-regelen er målt på enhet, ikke antatt** — og med **rullebevis**: en node som
blir klippet av ScrollViewens viewport, rapporterer **klippingen** sin og ikke
boksen sin (målt 2716 mot 2992 px — klipping er ikke skjermkanten). Enhetsgangen
ruller derfor inn hver node som måles for liten, med inntil fire swipes, og måler
på nytt.

### 5.5 Komponentvokabular

Sju komponentfiler i `apps/mobile/src/components/`, alle bare via tokens:

| Fil | Innhold |
|---|---|
| `Button.tsx` | variantene `primary` (violet) / `accent` (fylt cyan) / sekundær, `Row` med `flexWrap`, egen fokusring |
| `kit.tsx` | `Chip`, `Section` (`color.line`-hjørner), `StatTile`, `CornerTicks`, `Screen` (bakgrunnsramp + bunntekstfelt) |
| `cards.tsx` | `ChoiceCard` (A/B/C/D-tone), episodekicker, faktabrikker |
| `hud.tsx` | statusstrip, telemetrifliser, scenebrikke, dørvisninger, `breathTrough`/`breathMs` (den ene animasjonen) |
| `nav.tsx` | `NavBar` med fire faner |
| `art.tsx` | `ArtBand`, `ArtMark` — de to eneste stedene `<Image>` får forekomme |
| `ReportSheet.tsx` | innrapporteringsskjema (ADR-018) |

### 5.6 Skjermkart

Master §5.3 definerer **12** skjermer (UI01–UI12). Appen har **10** rutefiler
(i `src/app/`, mot én `_layout.tsx`), og den nyeste enhetsgangen dumper **16** trær
på 9 ulike skjermer med varianter (plates, cast, handlinger, fokus, gjest)
(`docs/qa/evidence/device-walk/2026-10-14T23-48-00-392Z`, 1,0-tekst).

| ID | Master sier | Appen har | Kunsten på skjermen |
|---|---|---|---|
| UI01 | Welcome | `app/index.tsx` | `welcome-portal.jpg` (portal/søm), `welcome-emblem.png` (merke), 4 stedstavler i vedheftet |
| UI02 | Genesis choice | `app/genesis.tsx` | `genesis-surprise.jpg`, `genesis-guided.jpg`, portalen over |
| UI03 | Guidet setup WHO/WHEN/WHERE | `app/setup.tsx` | `glass-harbor-hero.jpg` (premiss), 4 stedstavler, **6 portretter** i besetningsrekken |
| UI04 | World opening, 2–4 valg | `app/world/[worldId].tsx` | `glass-harbor-hero.jpg` (bånd, 96 dp) |
| UI05 | Episode reading | ** samme som UI04** | — |
| UI06 | Choice outcome | **samme som UI04** | — |
| UI07 | World home | `app/library.tsx` | `glass-harbor-hero.jpg` på verdensplakaten |
| UI08 | Surprise | **samme som UI02/UI04** | — |
| UI09 | History | `app/history/[worldId].tsx` | `glass-harbor-hero.jpg` (kom 2026-10-13) |
| UI10 | Account & Privacy | `app/account.tsx` | **ingen** — et åpent designspørsmål |
| UI11 | Paywall | `app/paywall.tsx` | — |
| UI12 | Error states | `ErrorPanel` i `kit.tsx`, på tvers | — |
| — | (ikke i Master) | `app/preview.tsx` (F02 gjestepreview), `app/sign-in.tsx` | `welcome-portal.jpg` |

UI05/UI06/UI08 er **ikke egne ruter** — de er tilstander i UI04. Det er et
bevisst valg (prosaisk framfor arkitektonisk), men det er et **avvik** fra Master
sin skjermliste, og en gjennomgår bør ta stilling til om det er et gode.

### 5.7 Kunsten: 15 bilder, målt pixel for pixel

Kontrakten står i `docs/design/ART.md` (442 linjer). Mapper, navn og manifest er
låst: mappe `apps/mobile/assets/img/`, navn `<slot>-<nøkkel>.jpg`, og **Metro kan
ikke løse dynamiske `require`** — så alt kunsten kan vise, må stå som en statisk
streng i `apps/mobile/src/lib/art.ts`. En verden uten bilde tegner **den
tekstbare layouten** i stedet. Det er regelen som holder kunsten ærlig.

**Fem regler:** kunsten er dekorasjon (ikke i lesetreet) · aldri tekst over kunst ·
aldri tekst *i* bildet · paletten er våre tokens · én fil per slot.

Målt i denne omgangen (dekoder JPEG/PNG-header på fil, summerer `require`-ene i
`art.ts`):

| Slot | Fil | Piksler | Bytes | Hvor | Hvor ofte |
|---|---|---|---|---|---|
| portal | `welcome-portal.jpg` | 1260×720 | 96 936 | UI01, UI02-sømmen, preview | 3 skjermer |
| merke | `welcome-emblem.png` | 512×512 | **330 020** | UI01 ved siden av ordmerket | 1 skjerm |
| genesis A | `genesis-surprise.jpg` | 1280×854 | 134 980 | UI02, døren til venstre | 1 |
| genesis B | `genesis-guided.jpg` | 1280×854 | 95 901 | UI02, døren til høyre | 1 |
| hero | `glass-harbor-hero.jpg` | 1260×720 | 136 176 | UI03-premiss, UI04-topp, UI07-plakat, UI09-historikk | **4** |
| sted | `location-singapore.jpg` | 768×576 | 76 661 | UI03 «Where», UI01-vedheftet | 2 |
| sted | `location-copenhagen.jpg` | 768×576 | 62 283 | samme | 2 |
| sted | `location-lagos.jpg` | 768×576 | 65 426 | samme | 2 |
| sted | `location-mars.jpg` | 768×576 | 57 445 | samme | 2 |
| portrett | `cast-alex-vale.jpg` | 512×512 | 34 587 | UI03 besetningsrekke | 1 |
| portrett | `cast-mara-venn.jpg` | 512×512 | 45 999 | samme | 1 |
| portrett | `cast-ilya-chen.jpg` | 512×512 | 30 464 | samme | 1 |
| portrett | `cast-noor-rahman.jpg` | 512×512 | 45 028 | samme | 1 |
| portrett | `cast-soren-pike.jpg` | 512×512 | 27 650 | samme | 1 |
| portrett | `cast-ada-lin.jpg` | 512×512 | 26 403 | samme | 1 |
| | **Totalt bundlet** | | **1 265 959 B (1 236 KiB)** | **15 filer** | |

`welcome-emblem.jpg` (32 813 B) ligger igjen i mappa, men **blir ikke bundlet** —
PNG-utgaven av merket erstattet den. Hele `assets/img/` er 16 filer / 1 298 772 B.

**Oppslagstavingen er data, ikke pynt** — og det er avgjørende for hvordan kunsten
kan skaleres:
- `HEROES` er nøklet på **`WorldSummary.rulepackId`** (ADR-019: den eneste
  verden-identiteten API-et gir klienten)
- `PLATES` er nøklet på `location`-verdien i den leverte malen
- `CAST` er nøklet på **figurens eget navn**, som er den eneste formen klienten
  noen gang mottar (§11 har ingen cast-rute). Et portrett uten navn ved siden av i
  katalogen blir **ikke vist i det hele tatt**, ikke gjettet på.
  `setting.test.ts:86` holder de seks navnene i klient-katalogen lik de seks i
  `core/src/glassHarbor.ts`.

**To bilder er erstattet på bakgrunn av en kritikk vi ga oss selv.** Den første utgaven
av `mara-venn` og `noor-rahman` ble forkastet: generatoren la to kvinner i
førtiårene i samme svarte, kortklippede frakk, og på en 96 dp-plate (288 px) var det
**det samme ansiktet to ganger**. Det er ikke en smakssak: **castet er informasjonen på
skjermen**, og to personer som leses som én person gir en falskere setning enn en
rekke uten bilder. Begge motivene ble skrevet om med alder, kroppsbygning, hår og
antrekk som ikke kan forveksles.

**To slots står tomme, med årsak:** UI10 er et åpent designspørsmål, og **bevegelse
er noe vi ikke kan generere** — animasjonsløkker og video er skrevet som ferdige
prompter i `ART.md` for at noen andre skal lage dem.

**Overføringen til enheten er målbar:** `scripts/copy-assets.mjs` leser
`registerAsset`-kallene ut av den **eksporterte bundelen** og legger hver skala i
`res/drawable-<dpi>/<navn>.<type>`. Uten dette steget får en innbygd bundle
**svart firkant** der kunsten skulle vært — det var en av to feil som ble målt fram
og fikset. Den andre: 3:2-bildene ble kuttet til et 2,3:1-bånd uten motiv; nå er de
generert på 16:9 med motivet i midtbåndet.

> **Dokumentdrift funnet i dag:** `docs/qa/STATUS.md:280` sier «tretten bilder …
> 1 011 KiB (1 035 078 byte)». Det tallet er **korrekt for de 13 filene som fantes
> da linjen ble skrevet**, men `genesis-surprise.jpg` + `genesis-guided.jpg`
> (230 881 B) kom etterpå. Riktig verdi i dag: **15 filer, 1 265 959 B**. Tallene i
> denne rapporten er målt i dag.

### 5.8 Merket

PUNKGRID-merket er levert i `docs/design/brand/punkgrid-logo.png` (1 596 766 B,
1254x1254 px) og i bruk to steder:
`welcome-emblem.png` i appen (beskåret til kuben og ringen — **låsen brukes ikke**,
begrunnelsen står i `lib/art.ts`: «ved 48 dp er ordmerket mos, og UI01 skriver navnet
allerede») og logoen på landingssiden. `.expo/web/cache` har adaptive
Android-ikoner i 108–432 px generert fra `assets/android-icon-foreground.png`
(1 002 361 B) og `icon.png` (886 535 B). `splash-icon.png` 330 232 B,
`favicon.png` 5 557 B.

### 5.9 Landingssiden — samme ord, annet ansikt

`apps/web/index.html`: **1 596 linjer**, **9 seksjoner** (`#hero`, `#manifesto`,
`#engine`, `#worlds`, `#characters`, `#choices`, `#story`, `#gallery`, `#cta`),
tittel `PunkGrid — Live a Thousand Lives. Every Choice Matters.`

Den er **ikke** designsystemet vårt. Det er det mest synlige identitetsbruddet vi
har:

| | Appen | Landingssiden |
|---|---|---|
| Cyan | `#00F5D4` (elektrisk, mockup-fargen) | **`#70D8EB`** |
| Violet | `#A58BFA` | `#A58BFA` + `#C7B6FF` |
| Bakgrunn | `#070A14`→`#0D1223` ramp | `#070A14`, `#0D1223`, `#18213A`, `#24314E` |
| Øvrig | — | `#B4F0FA`, `#AEEBF8`, `#FF8F99`, `#8BE0B0`, `#66789C`, `#BDC8E1`, `#F5F7FF`, `#FFFFFF` |
| Overskrift | **Plus Jakarta Sans** (bundlet i APK) | **Orbitron** (Google CDN) |
| Tekst/kode | **JetBrains Mono** (bundlet) | **Space Mono** (Google CDN) |
| Bilder | 15 filer / 1 265 959 B | **22 bilder i bruk / 13 587 697 B** (i `images/` ligger 23 filer / 15 184 463 B; `logo.png` er ikke referert) |

Landingssiden bruker `#70D8EB`, `#B4F0FA` og `#AEEBF8` som **ikke finnes som token**
i appen, og to helt andre skrifttyper. Det eneste landingen deler med appen er
ink-familiene og `#A58BFA`. To eksterne fonter fra CDN betyr at landingssidens
visuelle identitet er avhengig av nettverk.

### 5.10 Samlet visuelt budsjett

| Post | Målt |
|---|---|
| Kunst i appen (15 filer) | 1 265 959 B |
| Ikoner/splash/merke i `assets/` (6 filer, inkl. PNG-emblem) | 2 525 463 B |
| Fonter | 5 snitt fra `@expo-google-fonts/*`, bundet i APK |
| Landingbilder (23 filer, 22 referert) | 15 184 463 B / 13 587 697 B |
| Bakgrunnsramp | 13 bånd, 6 steg per halvdel, 0 asset |
| Animasjoner i appen | **1** — den pulserende statusprikken (`breathMs`/`breathTrough`), med «Reduced motion»-bryter som er **målt** at styrer den |

---

## 6. Åpne punkter og kjente grenser

Vi sier fra om dette før noen andre gjør det. Gruppert etter hva det sperrer.

**A. Tilstandsmaskin — én åpen beslutning vi ikke kan ta alene.**
En worker som bruker opp forsøkene sine, **bosetter ikke episoden sin**. Raden blir
`failed`, episoden står igjen som `pending` **for alltid** — spilleren leser en
scene som aldri ble skrevet. Målt i lastdata som allerede ligger i `punkgrid_load`:
**59 jobber** med status `failed` der episoden fremdeles er `pending`, og **62
episoder uten prosa** i alt (de 59 + 3 rader fra en kjøring før lease-fiksen).
ADR-013 lover `published` **eller** `fallback`. Skal workeren skrive fallback-prosa
ved siste forsøk, eller skal episoden markeres `failed` og klienten si det fra seg?
Det ene uten det andre er en halv fix.

**B. Ytelse og kapasitet.**
- NFR-01 **rutes** av 1 000 samtidige forespørsler over én prosess: p95
  **1 031 ms** (metning ~2 600 req/s). I minne med begrenset arbeidskø: p95
  **57 ms**. Mot Postgres med worker på banen: GET p95 **46 ms**, p75 commit → prosa
  **3,7 s**.
- Den ene 500-en i verdenoppretting er **ikke reprodusert** på 7 400 opprettinger
  etter at måleinstrumentet fikk feilteksten. Den står igjen som den eneste
  navnløse.
- Alle kjøringene er **én prosess på loopback**. Ingen av dem er
  produksjonsbevis.

**C. API- og dataflate.**
- **Verdenslisten er ikke paginert.** `api.ts:117` svarer `nextCursor: null`
  hardkodet; `engine.listWorlds(userId)` (`engine.ts:136`) tar verken `limit` eller
  `cursor`. `WORLD_LIMIT_REACHED` setter taket per konto, og veien en kunde faktisk
  går har én verden — men åpnes listen, må UI07 lære å bla.
- **`episode.acknowledge` har ingen rute** (§3.11).
- **Autentisering er en dev-port.** `HmacDevAuth` er HMAC-signert token med
  allowlist (ADR-016). §11 sier «short-lived bearer token» — det er oppfylt i
  **form, ikke i utforming**. Token-rotasjon, refresh og utlogging er **utestet**.
- **Databasetestene (§14)** er kjørt mot lokal PostgreSQL 16 med superbruker og
  `SET LOCAL ROLE` — **ikke** mot Supabase med ekte pool, `service_role` og
  `authenticated`-grants.
- **Rate limit:** delt for kontoer (i `rate_limit_bucket`,
  `punkgrid_rate_limit_take()`), **per prosess for anonyme** — med vilje, fordi en
  uautentisert forespørsel som i tillegg skriver en database-rad, gjør vekten selv
  til et misbruksmål. Gjenstår: måle ordningen mot en ekte lastbalanser, og bestemme
  en TTL når tabellen kan få flere nøkler enn konto-id-er.

**D. Innhold og kvalitet — det dyreste åpne punktet.**
- **F10 er aldri kjørt mot en levende gateway.** Ingen nøkkel er konfigurert. All
  prosa en spiller har lest, er `storedProse` sin bestemte stemme.
- **FR-19 er halvdelt.** `npm run eval:narrative` skriver
  `docs/qa/EVAL-narrative.md` og måler hva §10-grensen **beslutter** (publicer /
  forkast / flagg / kostnad) mot deterministiske testprovider. Prosekvalitet per
  promptversjon hos en levende modell — den opprinnelige FR-19-setningen —
  gjenstår, fordi den kjøringen **koster penger**.
- **Én verden finnes.** Glass Harbor er en testfixture, ikke spillbalanse.
- `ambientProgressPerTick` er død parameter (§3.6).
- **Replay-rapport som lagret artefakt** er ikke satt opp. `npm run seed` har
  gullhash og exit 1 ved drift, så kommandoen er CI-kjørbar — men det finnes ingen
  lagret pr.-commit-rapport.

**E. Tilgjengelighet — målt, med to hull.**
- **Ingen skjermlestartest.** Enhetsgangen leser hva treet **inneholder** og i hvilken
  **rekkefølge**, ikke hva TalkBack og VoiceOver **sier**
  (kunngjøringsformat, rolle, sammenslått gruppelesing).
- **iOS er ikke bygget.** §5.5-revisjonen på «begge plattformer» er halvparten
  dekket. Debug-APK er det eneste som er kjørt — release-build, skyvevarsler,
  betaling og eksport/sletting fra klienten gjenstår.
- **SIGSEGV ved kald oppstart er ikke forklart.** Det første strict-forsøket på det
  gjenbygde bygget stoppet på «waiting for "Server address": app process died», og
  `logcat` viste `Fatal signal 11 (SIGSEGV), code 2 (SEGV_ACCERR) … in tid 12432
  (mqt_v_js), pid 12383 (com.monrad.punkgrid)`. Etterpå: én manuell oppstart som
  overlevde 12 sekunder, og **tre fulle ganger som ikke gjentok krasjet**.
  Logglinjen ble lest av i kjøringen; **ingen loggfil er lagret**, så observasjonen
  er ikke et gjenbrukbart bevis, og rotårsaken står ikke dokumentert noensteds i
  basen.
- `npx expo start`-veien er **ikke brukbar** på denne maskinen: emulator-NAT-en
  mister byte på Metro-svarene sine, målt og dokumentert i README. Arbeidet går via
  `expo run:android` med innbygd produksjonsbundle.

**F. Prosess.**
- **ADR-014 (sletting/retensjon) er `Proposed`.** Teknisk design vedtatt; juridisk
  godkjenning (Privacy/Legal) er grind før F15-implementasjon. **F15 er Must i MVP.**
- **NFR-08 (all UI-copy eksternt nøkkelstyrt) er ikke oppfylt** — strengene står i
  komponentene.
- **NFR-11 (restore-drill, RPO ≤ 24 t / RTO ≤ 8 t) er ikke øvd.**

---

## 7. Hvor vi ønsker tilbakemelding

Punktene er prioritert etter hva som endrer mest for oss.

**P1 — Er dette et spill, eller en vakker database?**
Motoren vår garanterer at valg er reelle, lagrede og replikerbare. Den garanterer
ikke at de **kjennes som noe**. Se §4.6 og §6D.
1. Hva mangler i `RulePack` for at et valg skal kjennes som et **dilemma** og ikke
   som en **knapp**? Er ressurser + relasjoner + buer nok, eller trengs en
   eksplisitt **forventningstilstand** (spilleren vet hva som vil skje, og valget er
   å velge mellom to ting spilleren vil)?
2. `lengthTarget: 140` ord og tre avsnitt i fallback. Er scenen for lang, for kort,
   for lik? Hva er **den første scenen** en spiller faktisk vil lese?
3. Vurder rekken: `deep`→`ink` ramp, én lys dør per skjerm, cyan = instrument,
   violet = bekreftelse, 15 bilder + 2 dører + 6 portretter. Er dette en verden som
   **kjennes annerledes ut enn eget innhold**, eller er det én flott skjerm gjenbrukt
   tretten ganger?

**P2 — 2–4-valget: er gulvet og taket riktig?**
ADR-022 låste intervallet. Men **hvorfor** er 2–4 riktig? Vi vet det ikke; det var
FR-04 sitt tall. Vi vet bare at verden **brøt** det i begge ender før vi låste det.
4. Bør `min` være **2**, eller bør verden heller **låse spilleren** og vente på
   innhold? Vi valgte «aldri låst spiller» (§3.7) — spilleren kan stå med **ett** tilbud.
   Hva er verst: en scene med ett valg, eller en scene som sier «vent»?
5. `capOffers` kutter **uten å skrive flagg**, så «alt som er låst opp» og «alt som
   vises» er to ulike mengder som **ikke er skilt i datamodellen**. En spiller kan
   aldri se hva som ble kuttet. Er det rett (uventet verden) eller feil (fortapt
   spiller)?
6. `CHOICE_NOT_OFFERED` dekker **både** «verden bød deg det ikke» og «du gjentok
   eget valg». Én feilkode, to vidt ulike virkeligheter. Bør de skilles?
7. Hva bør **vises** fra `offerHistory` (åpningsrekkefølge, hvor ofte brukt, at
   noe ble kuttet) — kaster vi bort den eneste spill-telemetrien som finnes?

**P3 — Blåtrykk som pipeline, ikke kanonisk state.**
ADR-023 punkt 5 sier `location` styrer premiss og kunst, men står **ikke** i
`WorldState` og **ikke** i `stateHash`.
8. Er det riktig at verdens **geografi er visningsdata**? Hva skjer med en spiller
   som sier «jeg er i Singapore» og senere vil lese hvor spilleren var?
9. `profile.title` (rollenavnet motoren skriver) blir **ikke lest av appen** — appen
   bruker egne katalogtekster. Er en tittel som finnes i kanon men ikke på
   skjermen, et gode (motoren har rett) eller en mangel (spilleren ser den ikke)?
10. `localeCompare` i tilbudsrekken (§3.7) er det eneste locale-avhengige utslaget i
    en ellers locale-uavhengig motor. Bryr vi oss — og **hvor** vil det merkes?

**P4 — Det visuelle: to identiteter, én verden.**
11. Appen sier `#00F5D4` + Plus Jakarta Sans + JetBrains Mono. Landingssiden sier
    `#70D8EB` + Orbitron + Space Mono (§5.9). Hva er riktig: **føre landingen ned
    til tokens, eller heve appen mot Orbitron?** Vi vet at Orbitron er mer
    «cyberpunk» og mindre lesbar; vi vet ikke hva som lønner seg.
12. **`magenta` og `pink` er definert, dokumentert og brukt i null skjermer.**
    `amber` i to treff. Bør vi **fjerne** dem (systemet er større enn språket) eller
    **finne** hva som skal være fiendtlig og hva som skal være verken/ikke? Vurder
    spesielt: hvor mye **fiende** skal en verden som ikke har strid, ha i paletten
    sin?
13. **14,5 MB bilder på landingssiden** mot 1,27 MB i appen. Hva er verdien av en
    parallax-landing som veier det den gjør, sammenliknet med å la **spillet** selge
    seg?
14. `welcome-emblem.png` er **330 020 B alene** — 26 % av all app-kunst, for et merke
    på 48 dp. Bør merket være SVG/vektor i en egen pakke?
15. **UI10 (Account & Privacy) har ingen kunst.** Vi har kalt det «et
    designspørsmål». Hva skal personvern se ut som i en cyberpunk-HUD — eller er
    svaret at det **ikke skal se ut som noe**?
16. Bevegelse er **ikke generert** (§5.7). Én eneste animasjon i appen (den
    pulserende prikken). Er det for lite for en «immersive» verden, eller er lite
    riktig?
17. Tre av **12** Master-skjermer er slettet inn i én (UI05/UI06/UI08 → UI04,
    §5.6). Er det med på å gjøre spillet mindre lesbart som et system?

**P5 — Arkitektur og risiko.**
18. **Alt står og faller på én commit-vei** (§3.1). Er det for sterkt? Hva kan ikke
    inn i den veien (analytics? modereringsflagg? klient-preferanser?) — og hvor
    mye friksjon koster det å spørre?
19. `verifyReplay` garanterer at framtidige versjoner kan rekonstrueres. Men
    `world_events` **vekst uendelig** per verden, og hver episode krever at vi kan gå
    tilbake til sin egen verdensversjon. Hva er kompakteringsstrategien, og **bryr
    determinismen seg** om den?
20. **Dev-auth er den eneste autentiseringen** (§6C). Hva er den minste broen til
    ekte Supabase Auth uten å røre §11-kontrakten?
21. Vi har **23 ADR-er** og to dokumentsjikt som styrer hverandre. Er dette **for
    mye prosess** for en liten base? Hva av dette vil en ny utvikler kaste bort — og
    er det i så fall feil?

---

## 8. Vedlegg A: sjekker du kan kjøre selv

Disse fire kommandoene gir samme tall som rapporten (alle kjørt i dag). **Kjør på
din egen maskin** — ikke på en server, ikke i CI — og du trenger ingen nøkler.

```powershell
cd "C:\Users\Rune W. Monrad\CascadeProjects\PunkGrid"
npm run typecheck
npm test
npm run seed
node -e "const s=require('fs').readFileSync('core/src/glassHarbor.ts','utf8');console.log(s.match(/offerPolicy: { min: \d, max: \d }/)[0])"
```

For å telle farge- og skrifttokenene som rapportert i §5.1 og §5.2:

```bash
cd "C:/Users/Rune W. Monrad/CascadeProjects/PunkGrid"
for c in cyan magenta pink amber violet danger success muted raised line deep surface ink; do
  printf '%-9s %s\n' "$c" "$(grep -rn "color\.$c\b" apps/mobile/src --include=*.ts --include=*.tsx | wc -l)"
done
```

For å måle kunsten på nytt (§5.7):

```bash
cd "C:/Users/Rune W. Monrad/CascadeProjects/PunkGrid"
node -e 'const fs=require("fs"),p=require("path");const d="apps/mobile/assets/img";
const src=fs.readFileSync("apps/mobile/src/lib/art.ts","utf8");
const names=[...src.matchAll(/require\(\x27..\/..\/assets\/img\/([^\x27]+)\x27\)/g)].map(m=>m[1]);
let t=0;for(const f of names)t+=fs.statSync(p.join(d,f)).size;
console.log(names.length+" filer, "+t+" byte");'
```

## 9. Vedlegg B: filregister for gjennomgåreren

Alt en gjennomgår **trenger** for å forstå hele systemet, i lese rekkefølge:

| Fil | Linjer | Hva den svarer på |
|---|---|---|
| `docs/product/PUNKGRID_PREDEVELOPMENT_MASTER_v1.0.md` | 572 | Hva vi bygger, for hvem, MVP-grense, NFR, UI01–UI12 |
| `docs/architecture/REALITY_ENGINE_CORE_CONTRACT_v1.0.md` | 432 | De normative invariantene, §11-rutene, §12-fixturen |
| `docs/architecture/adr/README.md` | — | Hva som er endret, hvorfor, av hvem, når |
| `core/src/domain.ts` | 213 | Eneste sted «kanonisk» er definert |
| `core/src/reducer.ts` | 133 | Én hendelse → endring i state. Alt annet er avledet |
| `core/src/engine.ts` | **1 224** | Kommandoporten, tid, scene, surprise, narrasjon |
| `core/src/rulepack.ts` | — | **Innholdsformatet** — det en framtidig spillprodusent skriver |
| `core/src/glassHarbor.ts` | 201 | Den eneste verdenen som finnes |
| `core/src/narrative.ts` | 155 | Prompten, valideringen, fallback-stemmen |
| `core/src/api.ts` | 201 | De elleve rutene |
| `apps/mobile/src/lib/theme.ts` | — | **Alle farger, størrelser og familier** i appen |
| `apps/mobile/src/lib/plates.ts` | — | Bakgrunnsrampen, og grunnen til at den finnes |
| `apps/mobile/src/lib/art.ts` | — | Kunstmanifestet og oppslagslogikken |
| `docs/design/ART.md` | 442 | Kunstkontrakten, slots, regler, prompter til det vi ikke kan lage |
| `apps/mobile/src/components/hud.tsx` | — | Det visuelle språket i bruk |
| `apps/mobile/scripts/device-walk.mjs` | — | Hvordan vi vet hva enheten faktisk gjør |
| `docs/qa/STATUS.md` | **871** | Hva som er målt, når, med hvilken hash — og hva som ikke er det |
| `docs/qa/SECURITY.md` | — | Angrepssuiten og F-S1 … F-S10 |

**Kilder for denne rapporten:** `theme.ts`, `plates.ts`, `art.ts`, `fonts.ts`,
`hud.tsx`, `glassHarbor.ts`, `rulepack.ts`, `domain.ts`, `engine.ts`, `reducer.ts`,
`narrative.ts`, `api.ts`, `moderation.ts`, `providers.ts`, `device-walk.mjs`,
`apps/web/index.html`, `apps/mobile/assets/img/*` (dekode piksler + bytes),
`docs/product/…MASTER…`, `docs/architecture/adr/*`, `docs/design/ART.md`,
`docs/qa/STATUS.md`, `README.md`, og ferske kjøringen av `npm test` og
`npm run typecheck` (i dag). Alle tall i seksjon 5 er målt med `grep`/`node` mot
disk denne dagen, ikke hentet fra tidligere rapporter — der et gammelt tall avviker,
er det merket (§5.7).
