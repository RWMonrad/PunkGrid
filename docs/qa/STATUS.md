# docs/qa — status (Sprint 6)

Katalogen er opprettet per Master §9.1 steg 1. Testplan og eval-rapporter
skriver vi her etter hvert som de eksisterer.

## Bevismappe og drivere

Stemplene under `docs/qa/evidence/` er i git som skjermtrær (`*.xml`), `walk.json`
og `result.json` — 912 filer, 22,1 MB. Samme målingene skrev et skjermbilde
ved siden av hvert tre (`*.png`: 923 filer, 655,8 MB), og bildene er holdt
utenfor historikken; de ligger bare på maskinen som målte. Unntaket er
`2026-10-12-emulator/` og `postgres-2026-10-12/`, der bildet er hele beviset og
det ikke finnes noe tre som sier det samme. Det samme gjelder `.scratch/` og
`vibe_images/`. Driverne for målingene som ikke er en del av selve
enhetsgangen, ligger i `docs/qa/harness/`.

## Gjeldende verifikasjon — 2026-10-15 (motoren: scenens intervall og valgt tid/rolle)

- **Bestått, målt på denne kjøringen:** `npm run typecheck` uten output; `npm test`
  uten database **323 passed | 26 skipped (349)** i 19 filer; samme suite med
  database mot kastbasen `punkgrid_test` **349 passed**, ingen skipped;
  `npx vitest run core/tests/pg.test.ts` alene **27 passed**; `npm run seed`
  **28 hendelser, versjon 7, `replay equal: true`, `golden hash : match`** mot
  `sha256:ba95bdda…6247`; mobil `npm run typecheck`, `npx tsc --noEmit` og
  `npm run lint` (`expo lint`) uten output. Goldensettet i
  `core/tests/golden.test.ts` måler **42 tilfeller**.
- **Lukket kontraktsavvik (FR-04/ADR-012, ADR-022):** intervallet 2–4 ble tidligere
  ikke holdt av noen. Nå eier motoren det: `offerPolicy { min: 2, max: 4 }` i
  regelsettet, `capOffers` på utstedelsen (`core/src/engine.ts:945`),
  `offerHistory` fra hendelsesloggen (`:969`), utstedelsessjekk i `submitChoice`
  (`:465`) og `assertSceneFloor` som projiserer hendelsene gjennom redusatoren før
  den neker (`:997–1015`). Målt: genesis 4, etter `open_negotiation` **4** med
  `reject_sale` beholdt (var 5), gjentatt `open_negotiation` nekes som
  `CHOICE_NOT_OFFERED` uten ny hendelse, og etter ti `brief_staff` fra tømt
  `cash`/`influence` holder scenen **2** valg (var 1) — den ellevte nekes med
  `SCENE_CHOICE_FLOOR` mens `confront_mara` gjenoppretter scenen. 47 versjoner,
  `verifyReplay` lik. Mutasjonssjekk: `offerPolicy: { min: 0, max: 99 }` gjør de
  to policy-gullentene og cap-nektelsen røde; pakken er gjenopprettet til
  `{ min: 2, max: 4 }`. Read-only SQL-scan av dev-basen `punkgrid`: maks **3**
  tilbud per versjon, **0** rader over `max`.
- **Lukket funksjonsavvik (US03, ADR-023):** oppsettets valgte tid og rolle ble
  validert og deretter ignorert — `createWorld` åpnet alle verdener på §12s
  referanseklokke og founder-rolle. Nå slår genesis opp i `template.eraStarts` og
  `template.roleGrants` på den validerte settingen
  (`core/src/engine.ts:326–328`), og `validateSetting` neker en mal som erklærer
  en tid eller rolle den ikke kan starte på som `INVALID_BLUEPRINT`
  (`:421–422`) — pakkefeil, ikke spillerfeil. Målt i gullenten «opens a world on
  the era and role the player chose»: `1888/copenhagen/investigator` gir
  `worldTime = 1888-09-15T09:00:00.000Z`, `roleIds = ['investigator']`, tittel
  «Investigator, Helix Transit» og blåtrykk `location = copenhagen`, med replay
  lik; referanseverdenen står på 2034 + `founder_ceo`. Gullhashen er urørt, altså
  er endringen nøytral for alle eksisterende verdener.
- **Målt over HTTP mot en fersk tjener** (`evidence/adr-022-023/http-log.txt`,
  u-minne `PUNKGRID_SEED=20261015`, deterministisk fake provider, outbox-worker i
  prosessen): `POST /v1/worlds` med `1888/copenhagen/investigator` → **201**,
  `worldTime = 1888-09-15T09:00:00.000Z`, versjon 1, **4** tilbud
  (`brief_staff, confront_mara, investigate_buyer, open_negotiation`), episoden
  `published` med samme `allowedChoiceIds`, og det uutstedte `reject_sale` nekes
  med 422 `RULE_PRECONDITION_FAILED/CHOICE_NOT_OFFERED`. Seks påfølgende turn
  holdt scenen på 4 tilbud — ingen versjon over `max`.
- **Målt native på `PunkGrid_Verify` (`emulator-5554`), tekstskalering 1.0:**
  APK `1bf1ced6434f98aadf504c3c5bc9f74db073e390f49807e4174feba23d5b53bb`, kontrollert
  byte-for-byte på enheten med `sha256sum`; pakket JavaScript
  `8a42f28a4e5ed1a4b1a0d22589808ec181f4a17697c259743ace799dde6d598a`. Målingen
  (`evidence/adr-022-023/2026-10-15T01-20-28Z/`, 10 PNG + 10 XML-trær +
  `result.json`) gikk igjennom 7/7 to ganger på rappen mot hver sin ferske
  in-minne-tjener: UI10 holder adressen, UI03 sier referanserollen på
  «you»-plateen før valget, tids- og rollekippene finnes, plateen bytter til
  «Investigator» etter trykket, spill-skjermen tilbyr **4** dører
  («Brief staff, Confront Mara, Investigate the buyer, Open negotiation»), og
  «September 15, 1888, 09:00, by the world clock. The ledger's own words, with
  nothing added.» på spill-skjermen, med
  `Version 1 · world time 1888-09-15` på scenekortet.
- **Full strict-enhetsgang bestått på det gjenbygde enhetsbygget:** **136/136 ved
  tekstskalering 1.0** i `evidence/device-walk/2026-10-14T23-48-00-392Z/` og
  **135/135 ved 2.0** i `evidence/device-walk/2026-10-15T00-03-06-711Z/`. Begge
  `walk.json` er kontrollert på disk: samme APK
  `1bf1ced6434f98aadf504c3c5bc9f74db073e390f49807e4174feba23d5b53bb`, `strict: true`,
  `failures: []`, 16 PNG + 16 XML-trær i hvert stempel. Begge gikk mot en fersk
  in-minne-tjener som målingen selv startet (`http://10.0.2.2:3120`,
  `PUNKGRID_SEED=20261015`, deterministisk fake provider), altså ikke mot
  PostgreSQL-API-et på 3113 som 2026-10-14-gangene gikk mot. Tallene er sammenlignbare
  med 135/136 der: en gang som ikke setter `PUNKGRID_FONT_SCALE` måler 131 sjekker,
  fordi UI10 da bare revideres én gang, ikke på den erklærte skalaen. Gangen med
  131 sjekker ligger i `evidence/device-walk/2026-10-14T23-31-43-887Z/`; den er
  registrert som en hel gang uten erklært skalering, og det er de to skalerte
  gangene over som er beviset for SC 1.4.4. Til slutt er enheten lagt igjen med
  font- og animasjonsskala målt til 1.0 og appens data ryddet (`pm clear`), slik at
  emulatoren ikke holder en sesjon eller en adresse-override til en tjener som
  ikke lenger kjører.
- **Lukket UI03-avvik funnet under målingen:** besetningsplateen som sier «you»
  viserte katalogens referanserolle også etter at spilleren hadde valgt en annen
  rolle — skjermen motsa det motoren nå holder seg til. Platen leser nå
  `template.roles` på den valgte settingen
  (`apps/mobile/src/app/setup.tsx:113,238`), og målingen over er tatt på det
  gjenbygde enhetsbygget. `profile.title` leses fortsatt ikke av appen: den bruker egne
  katalogtekster, og App-verden er derfor ikke et bevis på identitetstittelen —
  den står i gullenten.
- **Observert, ikke gjentatt:** det første strict-forsøket på det gjenbygde bygget i
  denne kjøringen stoppet på «waiting for "Server address": app process died», og
  `logcat` viste `Fatal signal 11 (SIGSEGV), code 2 (SEGV_ACCERR) … in tid 12432
  (mqt_v_js), pid 12383 (com.monrad.punkgrid)` med `pidof` tom og launcher i fokus.
  Det er den samme kalde-oppstartskrasjen som task #47 handler om. Etterpå: én
  manuell oppstart som overlevde 12 sekunder, og tre fulle ganger som hver
  innholder to `pm clear`-faser pluss omstarten skaleringen gjør — ingen av dem
  gjentok krasjet. Logglinjen er lest av i kjøringen; ingen loggfil er lagret,
  så observasjonen er ikke et gjenbrukbart bevis, og rotårsaken står ikke dokumentert
  noensteds i denne basen.
- **Gjenværende, dokumenterte grenser:** en scene kan fortsatt stå med ett eller
  null tilbud når regelsettet ikke har fri handling — motoren låser aldri
  spilleren, og et nytt regelsett må oppfylle de to kravene i ADR-022 §Konsekvenser.
  Sted (`location`) er blåtrykk, ikke kanonisk state (ADR-023 punkt 5).

## Verifikasjon — 2026-10-14 (native, feilscenarier og testdekning)

- **Aktuelt APK:** `f9385bb87de509da56f1dfa3715dced15c8acb16fe970ff26176c4f00ee0a43f`,
  pakket JavaScript `e052fc409197f84dd4ced3aaf1a7b0d3e198c22f46fc757f2a1b98c9955a7a1b`.
  Begge ABI-er er pakket; installert APK er byte-for-byte kontrollert på emulatoren.
  Ved 200 % tekst kommer scenen før telemetri og konsoll; tabgruppen og dekorative
  ikoner blir ikke egne leseobjekter.
- **Begge native fullganger bestått på aktuelt APK:** **135/135 ved 200 %** i
  `evidence/device-walk/2026-10-14T20-11-58-824Z/` og **136/136 ved 100 %** i
  `evidence/device-walk/2026-10-14T20-29-25-850Z/`. Begge `walk.json`, logger og
  skjermbilder er kontrollert: samme APK-hash, streng modus, `emulator-5554`
  (`PunkGrid_Verify`) og PostgreSQL-API på 3113 med outbox-worker og deterministisk
  provider. Scenen begynner over folden ved 200 %; hele første valgkort ligger
  over folden ved 100 %. Gjeste-preview/konsekvens, valgt-verden-navigasjon,
  World actions og historikk består. Ekte valg flyttet versjon 45→46→47.
  Hver gang har 16 PNG-er og 16 ferske XML-trær. Font- og animasjonsskala 1.0
  er lest tilbake etterpå. Dette er ikke TalkBack-operatørtest eller ARM64-runtime.
- **Rød måling bevart:** `2026-10-14T19-50-43-951Z` avsluttet med 133/135.
  Bildet var synlig, men testankeret pekte på konsollens gamle plass; historikkmåleren
  telte både knapp og tekst samt klippede rader. Rettede målere krever faktisk
  bildeboks og synlig statustekst inni hele historikkrader. Negative regresjoner
  avviser manglende bilde/status; ingen terskel er senket. Originalt rødt
  `walk.json` er uendret, og de to nye fullgangene ovenfor består.
- **Feil i kontrollforbindelsen, ikke godkjent fulltest:**
  `docs/qa/evidence/ui-fault/2026-10-14T20-50-25-535Z/` nådde pending,
  tapt kvittering, samme-kommando-retry, pause/resume/archive og åpnet Episode 1.
  PNG/XML for prosaen ble skrevet, men vertens neste kontrollstatus-kall feilet.
  Gjenbruk av en varm kontrollsocket etter synkron blokkering gjenskapte
  `ECONNRESET`; en ny forbindelse svarte 200. Scratch-driverens kontrollkall
  bruker nå `connection: close`, uten retry eller senkede krav. Feilende HTTP-svar
  feiler fortsatt testen. Originalt rødt bevis er bevart. Kontoen ble kontrollert
  utlogget med adresse 3113 og font-/animasjonsskala 1.0 etter feilen.
- **Samlet native feilscenario bestått:**
  `docs/qa/evidence/ui-fault/2026-10-14T21-08-12-195Z/` på samme aktuelle
  APK, med isolert API/kontroll på 3117/3118, minnelager og deterministisk provider.
  Frisk fixture ble kontrollert tom før start. Logg, `result.json`, alle 11
  observasjoner med ferske XML-trær og tilhørende bilder er kontrollert.
  Pending vises mens serveren har versjon 2; etter release publiseres scenen.
  Tapt kvittering viser trygg retry; det faktiske nye POST-kallet har samme
  commandId og legeme, og verdenen forblir på versjon 3 med tre episoder.
  Pause/resume/archive bekreftes i både UI og motor; deaktiverte kontroller
  sender ingen kommando, og resume reaktiverer valg. Arkivering beholder
  tre publiserte scener; Episode 1 åpnes med synlig prosa. Replay stemmer.
  Sluttbildet viser utlogget konto og opprinnelig lagret adresse på 3113;
  font- og animasjonsskala 1.0 er lest tilbake, og installert APK-hash er
  kontrollert på nytt. Dette er én bestått fulltest med redusert bevegelse,
  ikke en sammenslåing av delkjøringer eller en PostgreSQL-feiltest.
- **Tidligere fokusretting bekreftet:** spillskjermens utloggingsredirect
  kjører nå bare mens skjermen har fokus (`world/[worldId].tsx:44`). Før rettingen
  sendte en skjult spillskjerm kontoskjermen til innlogging når serveradressen ble
  lagret. Daværende ARM64+x86_64 debug-APK ble installert og kontrollsummert på
  `emulator-5554`: `16b752398026a3298b79f9318db212001e7bff5a1598ed2dabb1d0a81ef9ca57`.
  Det er erstattet av det aktuelle APK-et øverst.
  Pakket JavaScript: `4005452d206546ba058fb3074108d8d7e30688c264c1f86aa85b45be7a6ca15c`.
  Mobiltypecheck og lint bestod. Kjøringen
  `docs/qa/evidence/ui-fault/2026-10-14T18-56-14-111Z/` bekrefter oppretting,
  pending/publisering og tapt kvittering med trygg retry: samme kommando og legeme,
  fortsatt versjon 3 og tre episoder. Den fulle kjøringen er **ikke bestått**: testen
  forventet feilaktig versjon 4 etter pause, mens både skjerm og server viste korrekt
  `paused` ved versjon 3. Pause/arkivering lager ikke nye episoder; resume uten forfalte
  tidssteg gjør heller ikke det (`engine.ts:442–488,529–543`). Den avgrensede
  livssykluskjøringen `docs/qa/evidence/ui-fault/2026-10-14T19-11-31-683Z/`
  **bestod** fra samme pausede verden: åtte ferske skjermtrær, pause/resume/archive,
  deaktiverte valg uten nye POST-kall, reaktiverte kontroller etter resume, tre
  historikkrader og faktisk åpnet Episode 1-prosa etter arkivering. Replay stemmer.
  Siste kontroll viser utlogget konto, opprinnelig serveradresse lagret og ingen
  utilsiktet videresending fra skjult spillskjerm; font og animasjon er gjenopprettet
  til 1.0. Dette er samlet bevis fra to kjøringer, ikke én grønn full feiltest.
  Full 200 %-gang mot PostgreSQL på 3113 **feilet** i
  `docs/qa/evidence/device-walk/2026-10-14T19-23-34-915Z/`: gjesteflyten bestod,
  men navigasjonsgruppen forstyrret målt leseorden, prosaen lå under folden, og
  driveren ventet på Archive uten å rulle frem handlingen. Ingen `walk.json` ble
  skrevet. Navsemantikk, scenerekkefølge ved stor tekst og rulling til handlinger
  er rettet og bekreftet i fullgangene på aktuelt APK øverst.
  165 målrettede tester, rot-/mobiltypecheck og lint bestod etter rettingene.
  Tidligere enhetsbevis nedenfor gjelder sine egne APK-er, ikke dette bygget.
  Testdriveren avviser nå foreldet XML etter dumpfeil og stopper ved prosessdød i
  streng modus i stedet for å skjule den med omstart; begge har egne regresjonstester.
- **Bestått:** 345 tester med den isolerte PostgreSQL-basen `punkgrid_test`,
  19 filer, ingen skipped (`docs/qa/evidence/npmtest-final-db.txt`) — tallet er fra denne
  datoen; etter motoravvikene nedenfor måler træret **349** (gullentene 42).
  Goldensettet hadde 38
  tilfeller, PostgreSQL-settet 27, mobilens logikk 139 (PlayController 56),
  leseorden/bevisintegritet 29 og bildesjekk 18. Regresjonene avviser foreldet XML,
  skjult prosessomstart, gamle koordinater, dobbeltelte/klippede historikkrader og
  manglende kunst. Historikkregresjonene bruker driverens egne geometripredikater
  og avviser invertert høyde/bredde på både rader og synlig statustekst.
  Kontrastmålingen dekker 115 tekstpar (svakeste 5,82:1), 41
  kanter (svakeste 3,59:1), 98 tekstelementer og 20 fokuskontroller.
  Rot-/mobiltypecheck og Expo ESLint er kjørt på nytt og består; kjernebygget
  bestod før nativekjøringene. Surprise-effektflagg, motorstyrt cooldown,
  avvisning av deaktiverte tilbud og historisk narrasjon er også dekket.
- **Tidligere ARM64 + x86_64 debug-bygg bestått:** APK SHA-256
  `a9ba15f54c19bf9cf48b101f1a58026d4867a0880fac71ae58be2da71a65bdc1`.
  Begge arkitekturene har de nødvendige native bibliotekene, inkludert
  `libc++_shared`, Worklets og Reanimated. Eksportert og pakket production-JavaScript:
  `6cb577a33c0db3f82cb4d6eb0464074e4d14e0e2495f923b1bc2588d6f318cb9`.
  Windows' korte kompilatornavn mistet implisitt C++-lenking; prosjektets
  `apps/mobile/android/build.gradle` angir nå standardbiblioteket eksplisitt for
  Worklets, Reanimated og Gesture Handler. Det delte Android-SDK-et er ikke endret.
  APK-et var installert og kontrollsummert på `emulator-5554`, men er nå erstattet
  av fokusrettingen øverst. Oppretting og valgcommit ble kjørt på x86_64.
  Dette er ikke ARM64-enhetskjøring eller butikkrelease; det separate x86_64-APK-et
  `736a905e7d2f5cd46735a09ffda57707e14900ee30596bfc7d16a3490944c2bf` var forgjengeren.
- **Full 100 %-gang bestått:** 135/135 på `PunkGrid_Verify`, `emulator-5554`,
  med det tidligere APK-et `ffd0ee6e69e53746cf17ec63db9df0c2271c7b76f514f7871680b0b493571935`
  og JavaScript `d22999ca5058c0df35e76b7dd810ca2ab241bf2b4a696abffac03b61d913e9f7`.
  Bevis: `docs/qa/evidence/device-walk/2026-10-14T17-36-31-153Z/walk.json`.
  Hele første UI04-valgkort ligger innenfor rullefeltet, og navigasjon bevarer valgt liv.
  Valget flyttet versjon og episode fra 42 til 43. Gjeste-preview og konsekvens bestod.
  Dette er historisk bevis; begge fullganger på aktuelt APK er dokumentert øverst.
  Den isolerte feilserveren bruker minnelager og deterministisk narrasjon, ikke
  PostgreSQL eller betalt AI. API-koden ble bygget og startet på egen loopback-port
  3113 med PostgreSQL, outbox-worker og deterministisk provider; `/healthz` svarte 200.
  Autentisert innlogging, verdensliste og verdenslesing på 3113 svarte også 200;
  verdenen hadde da versjon 43 og tre tilbud. Denne kontrollen skrev ingen verdensdata.
  Den eksisterende API-prosessen på 3100 er ikke endret. Senere UI-målinger mot 3113
  er dokumentert øverst.
- **Tidligere pending-undersøkelse:** `docs/qa/evidence/pending-probe-1792003063043/`
  viser animert ventetekst og deaktiverte knapper etter et ekte valg. Androids
  `uiautomator dump` svarte tomt under animasjonen og fungerte igjen etter release.
  Den tidligere feilkjøringen `ui-fault-2026-10-14T18-25-09-922Z` er ikke bestått:
  skjermbildet viste Genesis, mens XML-filen var et foreldet tre fra før valget.
  Det skjermbyttet ble ikke reprodusert i den sporede prøven. Ingen aktuell native
  krasj er påvist. Maskinell feilscenario-kontroll bruker midlertidig Androids
  reduserte bevegelse; animert visning og XML-bevis holdes atskilt.
- **Landingssiden lokalt verifisert:** nye skjermbilder og ekte klikk ved 390×844
  og 1440×900, med og uten redusert bevegelse. Ingen registrerte nettverks-/JS-feil,
  horisontal overflow eller manglende bilder. Hero uten overlapp/sentral logo;
  fire Worlds-kort kan leses, og butikkstatus sier «Not yet available».
  Bevis: `docs/qa/evidence/landing-validation-20261014/after-copy-fix/interaction-results.json`.
  Ikke publisert. Historiske grønne enhetsganger nedenfor gjelder sine daterte bygg.
- **To motoravvik ble målt som åpne denne datoen, og er lukket 2026-10-15:**
  tilbudsintervallet 2–4 (FR-04/ADR-012) og den valgte tid/rolle som ikke åpnet
  verden (US03). Årsak, beslutning og målte etter-tall står i avsnittet ovenfor og
  i ADR-022 og ADR-023. Den gang beskrivelsen lød:
  `engine.ts` kunne utstede flere enn fire valg (målt 5 etter ett
  `open_negotiation`) og ressursuttømming kunne gi færre enn to (målt 1 ved
  versjon 28), og genesis brukte malens 2034-klokke og founder-rolle selv når
  blåtrykket sa `1888/copenhagen/investigator`. Replay stemte i begge tilfeller —
  avvikene var lovlige verdener, ikke korrupte.
- Ingen commit, push eller publisering er utført.

## Tidligere målinger og testdekning

Dette er historiske målinger fra de daterte byggene, ikke gjeldende testantall
eller en godkjenning av aktuelt APK. Siste kontrollerte resultater står øverst.

| Sett | Fil | Innhold |
|---|---|---|
| Goldensett T01–T20 | `core/tests/golden.test.ts` | Ett tilfelle per Contract-ID, med de normative tallene fra §13 (T04 trust 70→58, T05 influence 60→50, T06 credibility 45 osv.) |
| Invarianter | `core/tests/golden.test.ts` (blokk «Canonical invariants beyond the twenty scenarios») | 10 tilfeller: kvote, ukjent hendelsestype, inventerte valg-ider, policy-block, budsjettstopp, transportfeil, pause/resume, valg never issued, versjon per batch, tre ur. I samme fil står blokken «Id space separation» med tre tilfeller til: at frøet en prosess trekker, ikke blir trukket av en annen prosess som starter i samme millisecond, at to fabrikker med ulikt frø gir ulike id-er, og at alt likevel er bestemt av frøet når ett oppgis (ADR-021). Fila måler **42 tilfeller** (vitest-telling, målt 2026-10-15: 20 gull + invarianter, id-rom og de fire nye — tre om scenens intervall etter ADR-022 og én om valgt tid og rolle etter ADR-023) |
| Rutegrense (uten socket) | `core/tests/api.test.ts` | 9 tilfeller: 201/202, 401, 400, 404 som felles lekkasjebasis for lesing og skriving, `rulepackId` i verdenslisten (ADR-019), 409 med `currentVersion`, `WORLD_LIMIT_REACHED`, normative ruter uten flere, og at episode-siden tjener **hele** historikken gjennom cursoren i stedet for å stoppe på tjue (se «Feil suitene fant») |
| HTTP-transport | `core/tests/server.test.ts` | 9 tilfeller over ekte sockets mot minnelageret: levetest, seks 401-varianter (mangler, Basic, feilformat, forfalsket sub, utløpt, feil hemmelighet) pluss gyldig token, `/dev/token`-allowlist (treff, 403, 404 når den ikke er konfigurert), hele verden-flowet (201, idempotent gjenkalling, 403 på oppfunnet identitet, 409 med `currentVersion`, choice 200), tverrakonto-isolasjon (404 / tom liste), negative transporttilfeller (mangler/mismatch Idempotency-Key, ubrukelig JSON, `[]`-kropp, 70 KiB → 413, PUT → 405, `/v2` → 404), request-id-propagering og -sanering, rate limit 429 med `retry-after`, fri kvote 403 |
| Outbox-loop | `core/tests/worker.test.ts` | 8 tilfeller: én narrasjon per claimet verden, feil koster et `retry` og ikke en commit, bounded pass (`maxJobs`), hvile + stopp, og at narrasjon etter commit ikke endrer kanon (versjon/hendelser uendret, provider-teller, `fallback` ved tidsavbrudd, hel runde via workerens kø), og at en episode som blir narrert etter at verden har gått videre, likevel bygges fra sin egen committede versjon — tilbud, fakta og worldtime fra snapshoten til versjonen, ikke hodet |
| Narrasjonsadapter | `core/tests/ai.test.ts` | 15 tilfeller mot en lokal node:http-stub (ingen nøkkel, ingen utgift, ingen avhengighet av en leverandør): §10-payloaden på ledningen og bare de ti nøklene, POV-filteret (autoriserte fakta med, `fact_secret_link` og hemmelig frase uten), regelsettets stemme i systemmeldningen, `Bearer`-header og `max_tokens` fra budsjettet; publicert prosa tilskrevet `promptVersion` fra provideren; og så det som ikke må publiseres: 200-prosa som ikke er JSON, faktalekkasje, inventerte valg-ider — alle tre ender i `fallback` med `narrative_rejected` i revisjonen; hengende gateway (timeout), 429 med `retry-after` (ventetid, cap), 5xx (nøyaktig `2 × (1 + maxRetries)` kall), 400 (prøves ikke en gang), staket JSON, og budsjettstopp **før** socketen åpnes |
| Den deterministiske stemmen (uten AI-nøkkel) | `core/src/narrative.ts:99` → `storedProse()`, brukt av både `CompliantProvider` (`core/src/providers.ts:20`) og `engine.ts:1016` | Prosaen en spiller får uten `PUNKGRID_AI_*`-nøkler, er ett malverk og ikke to. `storedProse` tar imot bare det ledgeren faktisk holder — worldtime, hendelsestypene i episoden og navnene på de andre aktørene — og sier ingenting utover det: klokka satt i UTC uten locale, én setning per hendelsestype i den rekkefølgen typene først opptrer, inntil tre navn, og til slutt at tilbuddet kommer fra der recorden lar spilleren stå. Tidligere skrev begge vegene et maskinnotat i det øyeblikket spillet skulle føles som en scene: `2 committed event(s) recorded.` og `Available actions: a_brief_staff, …`, altså regelsettets identifikatorer rettet mot en utvikler. Appen sier i fra ærlig fra om at prosaen er lagret uten narrasjon, så malen trenger ikke innrømme det på nytt — den trenger å ikke lyve. Tre porter holder formen i `core/tests`: markøren `own words, with nothing added`, at teksten er nettopp tre avsnitt, og et negativt treff på at den ikke inneholder én eneste `liten_liten`-identifikator (`not.toMatch(/[a-z]+_[a-z]+/)`). Målt på enheten 2026-10-13: episoden som ble skrevet etter et trykk på UI04, bærer den nye stemmen (`docs/qa/evidence/device-walk/2026-10-13T00-01-14-099Z/UI04 after the choice.xml`), mens episoden som allerede lå i kanon fra før, står med sin gamle tekst — episodene er uforanderlig kanon, og en om skrevet stemme endrer ikke det som allerede er skrevet |
| Moderering og rapport (FR-11/US13/§15) | `core/tests/moderation.test.ts` | 23 tilfeller mot den deterministiske screenen: blokkerende kategorier (`sexual_minor`, `sexual_violence`, `self_harm_instruction`, `real_person_defamation`) og flaggende (`graphic_violence`, `substance_abuse`, `extremism`, `gambling`) hver for seg; innportsavvisning på blueprint (`invalidBlueprint` med `contentPolicy`-detaljer) og injeksjonsforsøk i fratekst; utportsavvisning av prosa som provideren selv flagget **og** prosa som provideren slapp gjennom (scriptet tekstprovider) — begge ender i `fallback`, begge med `narrative_rejected:content_policy:…` i revisjonen; flagget prosa publiseres med `narrative_flagged` i revisjonen; injeksjon i prosa logges som `narrative_injection_attempt` og aldri utføres; rapportflyten (201, kvittering `PG-RPT-[0-9A-Z]{8}`, duplikat kommando gir `duplicate` med samme sak, `EPISODE_NOT_PUBLISHED` før prosa finnes, 404 på tverrakonto, 403 på lånt identitet, ukjent `reason` gir 400); minimiseringen (`episodeId: …` klippet til 180 tegn, notat til 200) |
| Hele spillflyten over sockets (E2E) | `core/tests/e2e.test.ts` | 14 tilfeller i den rekkefølgen appen faktisk går, mot `buildApp`-sammenstillingen på en ephemeral port med legemene `apps/mobile/src/lib/api.ts` sender: sign-in → 201-verden → les første scene → fire runder med versjonskjede og ulike tilstands-hashar → idempotent gjenforsøk (samme `commandResult`, ny `requestId`) → 409 med `currentVersion` → surprise (scene eller dokumentert `no_op`) → pause → 422 `WORLD_PAUSED` → resume → rapport (201, kvittering, duplikat, ingen versjonsendring, §15-utdrag) → archive → 422 `WORLD_ARCHIVED` → andre konto ser ikke den første (404 lik spøkelse-id) → replay mot lagret hash. De to siste tilfellene måler NFR-01 og NFR-02: p95 på GET og tid fra kommando til publisert prosa, og krever at ingen respons er 5xx og at alle har `x-request-id`. **Kjørt lokalt, i én prosess med kanon i minnet og narrasjon inline — tallene er prosjektets egne grenser, ikke produksjonsbevis**; den købaserte formen er målt for seg i `pg.test.ts:736` og `:767` (se raden nedenfor) |
| Postgres-lager | `core/tests/pg.test.ts` | 10 tilfeller mot ekte PostgreSQL 16: golden-replay gjennom sessions (samme hash som minnelageret), restart med budsjett og episode-kursor fra rader, idempotent replay etter reload, stale version 409 uten kommandorad, publisert prosa nektet overskrevet, projeksjoner som SQL er enige i snapshot, sam-verden-integritet + hydrering som ikke ser en annen verden, to skrivere på samme verden serialisert, at et verdenhodet en annen prosess allerede har gjort krav på, blir nektet med navnet på id-en (`pg.test.ts:330`, se avsnittet «Feil suitene fant»), og en innrapportert sak som skrives til `moderation_cases` og hydreres tilbake med eksakt utdrag etter reload |
| Postgres over HTTP | `core/tests/pg.test.ts` (blokk «over HTTP with the outbox worker») | 6 tilfeller med tjener, dev-token og worker på ephemeral port: kommandoen commiter mens episoden er `pending` (ledger flyttet, køen har jobben, både verden-listen og `GET world` bærer identiteten, og svaret gir episode-id-en som kan polles), workeren publiserer, tomt andre pass, og valget levert videre; pluss at **køen overlever prosessen** — API-et lukkes før narrasjon, og en ny prosess med annen id-kilde drenerer jobben den forrige la igjen. Det femte tilfellet måler den delen som ikke fantes: en worker som dør mens den *holder* en jobb, satte raden i `claimed` for alltid, og `claimJob` så bare på `pending`, så ingen drenering tok den igjen — episoden ble værende `pending`, og spilleren fikk aldri noen prosa å lese. Nå gjenopptas et `claimed`-ledd som er utløpt (`core/src/db/pgStore.ts:602-608`), og tilfellet drenerer en slik jobb til publisert prosa. Uten endringen måles tilfellet som feil på dreneringen (`{ completed: 0, retried: 0 }`), altså tester den den reproduserte feilen og ikke implementasjonen. Det sjette er F-S10 (`pg.test.ts:644`): en 401 på en konto provisioning-memoen allerede hevder, dropper memoen og kjører forespørselen én gang til — målt ved at `users`-raden slettes mellom to kall over HTTP, og falsifisert ved at tilfellet går rødt på 401 uten leddet (se avsnittet «Feil suitene fant»). De to neste tilfellene måler NFR-ene i denne formen: 30 GET mot de tre verdenrutene med bøtte og enhetsarbeid på banen (`pg.test.ts:736`), og `world.create`-commit til åpningsepisoden leses `published` gjennom workeren (`pg.test.ts:767`) |
| Sikkerhetsangrep over HTTP | `core/tests/security.test.ts` | 16 tilfeller, alltid på, mot samme sammenstilling som tjeneren bruker (`core/src/server/app.ts`): IDOR-matrise over alle ni verdenrutene med identisk 404-legem mot et spøkelse-id, tom liste for en konto uten verden, nektet gjenbruk av en annen kongs CommandResult, nektet modereringskvittering på tvers, lånt commandId uten svar, at en `world.create`-kommandonøkkel bare leses av kontoen som skrev den, og at en annen konto ikke får svar selv om legemet er identisk (F-S8 — orakelet som ellers kunne kvittere ut en verden som ikke er hennes), ni fiendtlige stier uten 500 og uten tapt rad, stryping før autentisering, et forfalsket `x-forwarded-for` som ikke får velge bøtte når proxyen ikke er betrodd, og det samme leddet som faktisk strupes når den er det, injeksjon i blueprint (422 `INVALID_BLUEPRINT` + `contentPolicy`), blokkert kategori, rapport som ikke skriver til verdenen, budsjett per konto, og `/dev/token` som 404 uten allowlist |
| Sikkerhetsnegativ som de utplasserte rollene | `core/tests/pg.test.ts` (blokk «security negatives as the deployed roles») | 5 tilfeller med `SET LOCAL ROLE` i egen transaksjon: app-rollen ser ingenting før `app.user_id` settes og deretter bare sine egne rader på syv tabeller (og ingenting på en injeksjonsformet session-variable), ingen av åtte skriv mot kanon kommer forbi grant-listen (42501), rate limit-bøtten er den eneste tabellen kjørebanen skriver til (`arw`, verken `D` eller `T`, funksjonen er ikke `SECURITY DEFINER`, og en direkte full bøtte stopper på `CHECK`/23514), ledger er uforanderlig for både worker (UPDATE blir 0 rader via RLS, DELETE nektet) og eier (utløserne i 004/006), og budsjettet følger kontoen også over en prosessrestart med nytt frø |
| Delt rate limit på tvers av prosesser (F-S6) | `core/tests/pg.test.ts` (blokk «shared rate limit») | 5 tilfeller over to `buildApp`-instanser med egen pool mot én database: 10 forsøk gir 6 tillatte take, 12 samtidige take gir fortsatt 6, den delte bøtta og `TokenBucket` tar samme avgjøring i samme rekkefølge, en kapasitet som krympes fra 8 til 1 gir ett take og nekte det neste, og anonymbøtta er fortsatt per prosess. Kjørebanen er `core/src/server/pgRateLimit.ts` + `punkgrid_rate_limit_take()` i `010_rate_limit.sql`; målt p50 1,7–2,1 ms og max 12,4–16,9 ms per take mot lokal PostgreSQL 16 i de seks kjøringer (`pg.test.ts:1075` skriver tallet) |
| Mobil logikk | `apps/mobile/src/lib/*.test.ts` | 106 tilfeller i åtte filer (`api` 16, `play` 23, `session` 12, `config` 9, `telemetry` 9, `setting` 10, `preview` 9, `contrast` 18) + 23 i `apps/mobile/scripts/reading-order.test.mjs` — klientens egne avgjørelser: routekall og feilkoder, at episode-listen går **sidene til enden** (de to URL-ene klienten faktisk sender, og at en tom side avslutter løkken i stedet for å stole på en cursor som er brukt), spilltilstand, dev-token-lagring, konfigurasjon av serveradresse, telemetri som aldri sender prosatekst, maloppslaget som UI07 bruker, at en episode som verken er `published` eller `fallback` når klientens 120 s poll er brukt, vises som «The scene is decided but not yet written» med en gjenlesing som ikke sender noe nytt, F02-previewens egne lover (ADR-012s 2–4 valg, én distinct terminal scene per valg, og at verken `preview.ts` eller `preview.tsx` inneholder et nettverkskall), tilgjengelighetsmålingene i raden under, og leseordenen gjenmålt på **alle skjermtreene som faktisk ligger i bevismappa** (én sak per XML-fil, så tallet 23 er dette utsjekkets stand — seksten trær i det nyeste stempelet pluss sju faste tilfeller — ikke en fast størrelse) |
| Tilgjengelighet målt (NFR-07) | `apps/mobile/src/lib/contrast.test.ts` | 18 tilfeller som regner på WCAG 2.2 fra tokenene og kildekoden: **95 tekstpar** mot 1.4.3 (svakste 5,82 — `cards.tsx · episodeKicker` og `preview.tsx · kicker`, begge violet på surface), alle `border*Color`-tokens i appen mot 1.4.11 (**33 kanter**, svakste 3,59), 12 bakgrunnsplater mot ankerfargen, åtte trykktilstander flattet med opasitet (svakste 5,23 — `primary`-flaten mens hun holder nede, mot kravet 4,5), åtte selection-/progress-indikatorer, `touchTarget` mot SC 2.5.8, og statisk skanning av alle 14 `Pressable`- og tre `TextInput`-elementer etter rolle/etikett, pluss 84 `Text`-elementer som alle må si sin maksimale multiplikator, og ett tilfelle som blir rødt av et `<Image>` utenfor `components/art.tsx`. To av tilfellene måler SC 2.4.7, det som manglet før: alle 17 kontrollene som kan flytte fokus, må tegne ringen sjøl (`onFocus`/`onBlur` + `focusRing`, fordi React Native 0.86 bare melder `pressed` tilbake), og ringen må måle 3:1 mot alle tre flatene en kontroll kan ligge på (7,83–11,27) med `borderWidth` minst 2. To tilfeller er målt i bevegelse, fordi appen fikk sitt første animerte element 2026-10-12: den pustende statusprikken måles i den **laveste** rammen av pusten, ikke den lyseste (4,04 mot surface, 4,29 mot page — konstantene `breathTrough` og `breathMs` leses ut av `components/hud.tsx`, så en endring som ikke følger målingen, blir rød), og UI10s egen «Reduced motion»-bryter må bli lest av det som beveger seg. Det siste var en reell feil som ble målt fram: raden skrev `session.flags.reducedMotion` og ingen komponent leste den, så bryteren kunngjorde «On» mens spinneren gikk videre; `useReduceMotion` (`hooks/useApp.ts`) ORer nå plattformens svar med flaggen, og tilfellet blir rødt hvis koblingen fjernes. Parene er **forankret fil + StyleSheet-nøkkel** og lest ut av kilden (`color:`/`fontSize:`/`fontWeight:`, med `fgToken`/`sizeToken` som må finnes i den fila), så et par som endrer seg uten at målingen følger etter, blir rødt. Målt 2026-10-12: rødt på seks `raised`-kanter (1.23), en `minHeight: 44` rett skrevet og radioknapper uten radiogruppe — alt grønt etter `color.line`-tokenet, `kit.tsx`-fiksen og `setup.tsx:138` |
| Grafikk i appen (kunstkontrakten) | `docs/design/ART.md`, `apps/mobile/src/lib/art.ts`, `apps/mobile/src/components/art.tsx`, `apps/mobile/scripts/copy-assets.mjs` | Kontrakten låser mappe (`apps/mobile/assets/img/`), filnavn (`<slot>-<nøkkel>.jpg`), manifest (`art.ts` krever bildene med statiske strenger — Metro kan ikke løse dynamiske require) og fem regler: kunsten er dekorasjon (`accessibilityElementsHidden`), aldri tekst over kunst, aldri tekst i bildet, paletten er våre tokens, og én fil per slot. Tretten bilder er levert og vist på enheten: `welcome-portal.jpg` (UI01-portalen og UI02-sømmen), `welcome-emblem.png` (UI01-merket ved siden av ordmerket), `glass-harbor-hero.jpg` (UI03-premiss, UI04-toppen, UI07-kortet og UI09-historikken) og fire stedstavler (`location-singapore|copenhagen|lagos|mars.jpg`) i UI03s «Where»-rad og i UI01-vedheftet under portalen, og seks portretter (`cast-<navn>.jpg`) i besetningsrekka på UI03 — `Alex Vale`, `Mara Venn`, `Ilya Chen`, `Noor Rahman`, `Soren Pike` og `Ada Lin`, som er de samme seks som `core/src/glassHarbor.ts` sender. 1 011 KiB bundlet (summen av de tretten filene `art.ts` nevner, målt med `stat -c %s` til 1 035 078 byte; `welcome-emblem.jpg` ligger igjen i mappa men blir ikke bundlet, se ART.md). `copy-assets.mjs` er det målebare leddet: det leser `registerAsset`-kallene ut av den eksporterte bundlen og legger hver skala i `res/drawable-<dpi>/<navn>.<type>`, ellers får en innbygd bundle svart firkant der kunsten skulle vært. To feil ble målt fram og fikset: kunsten lå uskalert i øvre venstre hjørne (`StyleSheet.absoluteFill` + `resizeMode="cover"` — en `Image` som får `width: '100%'` og eksplisitt høyde, skaleres riktig), og 3:2-bildene ble klippet til et 2.3:1-bånd uten motiv (ny generering på 16:9 med motivet i midtbåndet). Kunsten holder seg utenfor accessibility-treet, og det er en målt regel, ikke en intensjon:
alle rasterbilder går gjennom `ArtBand` (`components/art.tsx`, `accessibilityElementsHidden`),
og `contrast.test.ts` har et tilfelle som blir rødt av en `<Image>` utenfor den fila. Besetningsrekka på UI03 kom 2026-10-13 og måles to veier: portrettene som pixler i sin egen rullede ramme (`UI03 setup — cast`, 86 695 farger), og navnene som seks noder i treet — de sistnevnte lest fra regelsettet på disk, ikke skrevet inn i gangen. To slots står tomme med årsak i ART.md: UI10 er et designspørsmål, og bevegelse er gitt som ferdige prompts. Den fjerde på den lista — UI09 — sto der med påstanden om at historikken ikke har noen `rulepackId` å slå opp på, og den påstanden var feil: `engine.getWorld` sender `world.rulepackId` (`core/src/engine.ts:144`) gjennom `core/src/api.ts:156`, og klienten har hatt `getWorld()` hele tiden. Skjermen fikk heroen sin 2026-10-13: overskrifta heter verden med navnet sitt, undertittelen lyder `24 committed scenes in The Glass Harbor`, og båndet ligger over radene uten å komme inn i lesetreet (`docs/qa/evidence/device-walk/2026-10-13T01-38-52-076Z/UI09 history.xml`, der treet måler 18 merkede noder i geometrisk rekkefølge) |
| HUD-språk (visuell grammatikk) | `apps/mobile/src/components/hud.tsx`, `components/kit.tsx`, `components/Button.tsx`, `app/library.tsx`, `app/account.tsx`, `app/world/[worldId].tsx`, `components/cards.tsx` | Appen har fått et fast språk for hva fargen og hjørnetegnene *betyr*, hentet fra FlutterFlow-mockupen og lagt inn i komponentlagene slik at ikke skjermene kan avvike fra det hver for seg: **fylt cyan-`accent` er den ene døra som starter et liv** — `Create a Life` på UI01, `Surprise Me` på UI02 og `Begin a new life` på UI07, og ingen av dem på noen annen skjerm; **violet `primary` er skjermas egen bekreftelse** — standardvarianten i `Button.tsx`, brukt av `Back to the scene` (UI09), `Go to the welcome screen` (UI10), `Retry this decision` / `Reload the world` (UI04) og `Create world` (UI03); **cyan-`CornerTicks` er instrumentavlesning** (`StatTile`, scenevinduet i UI04, `WorldCard` og avlesningspanelet i UI07); **`color.line`-hjørner er innstillingspanel** (`Section` i UI10/UI03/UI11, utvidelsen av handlingene i UI04, diagnostikken i UI10). Delte regel er éi lys dør per skjerm: UI04s fire valgdører får derfor *ikke* accent, fordi ingen av dem er privilegert — valget er selve spillet. `StatTile` har fått en farget rail på venstre side som bærer ressursens egen farge — cash er success, influence er cyan, credibility er violet — så tre fliser i en rad leses som tre slags tall uten at spilleren må lese navnet; fargen forsterker en retning ordene allerede bærer (§5.5), og railen er 3 dp bred, noe som klarer SC 1.4.11 mot flaten den sitter på. `ChoiceCard` har samme mønster: A er cyan, B er violet, C er success, D er muted — så fire kort i en kolonne leses som fire forskjellige dører uten at spilleren må lese bokstaven. At språket er dekorasjon og ikke innhold, er målt og ikke antatt: `CornerTicks` er `accessibilityElementsHidden`, og gangen leverte samme tre før og etter passet — 125/125 ved 100 % og 130/130 ved 200 %, nodetall for nodetall uendret (`…T14-16-00-257Z` → `…T14-32-49-700Z` → `…T14-48-25-166Z`). Kontrasten følger med: `accent`-flaten måler 8,35 mens hun holder nede, og panelene som fikk `surface`-fillen, måles av de samme parene som `contrast.test.ts` allerede regner på (95 tekstpar, svakste 5,82). Samme pass gjorde verdenskortet i UI07 om fra tabellrad til plakat — se ART.md, «Verdenskortet er plakaten» — og tomrommet under innholdet er målt fra treet: den siste innholdsnoden endte på 1 411 px før (1 173 px tom rampe ned til footeren som starter på 2 584) og 1 639 px etter (945 px), og ved 200 % tekst 574 px |
| Enhetsgang på emulator (skjermtre) | `apps/mobile/scripts/device-walk.mjs` | **125 sjekker ved 100 % tekst, 130 ved 200 %** kjørt med `adb` mot `emulator-5556` 2026-10-13, og de påstår hva accessibility-treet sier, ikke hva kilden sier: UI10 (serveradressen forklart, feltet, `Save`/`Check`, kvitteringa, at adressen som er i bruk står igjen) → UI01 (usignert, 18+-linjen, begge genesis-knappene) → F02 gjeste-preview (`four named choices`, de tre fakta som gjør den til en gjestedør, fiction-merket) → F02 gjeste-konsekvens (prosa som svarer, det som flytta seg, kontoen som er veien for å beholde det, og hva en konto legger i pannen) → previewen på nytt med de fire dørene tilbake → UI01 → **`dev sign-in`** (dev-allowlista nevnt ved navn, serveradressen). Den siste hoppen heter ikke UI02 lenger: Master §5.3 gir UI02 til genesis-valet, og gangen måler det som faktisk er en egen rute — en dør som bare finnes fordi `PUNKGRID_DEV_USERS` står i kø for konto-porten → UI07 (verdenen lista med tittel, ikke id, og intet `world_[A-Z0-9]{12}` på skjermen) → UI04 (versjonen den viser, episodeoverskrift, prosatekst, **at overskrifta og prosaen ligger innenfor første viewport**, og minst ett navngitt valg fra pakka) → ett trykk flytter hodet fra versjon N til N+1 og Episode N+1 er på skjermen → UI09 (én rad per publisert episode, og radene heter `Published · version N`) → UI02 genesis (begge dørene, hva én-knapps-døra koster i kvote, fiction-merket) → UI03 setup (premissen for verden hun skal lage, **at premissen ligger innenfor første viewport**, de tre spørsmålene `Where`/`When`/`Who`, stedene hun tilbyr, besetninga hun viser fram — seks navn, lest fra regelsettet på disk, ikke skrivne inn her — og `Create world`). Hvert tre måles på fem egenskaper: bare noder fra egen pakke, alle klikkbare noder har et eget navn, alle er minst 44 dp, alle er `focusable` (SC 2.1.1), og **leseordenen** (SC 2.4.3): noder med tekst eller innholdsbeskrivelse skal komme i den rekkefølgen geometrien sier. I tillegg en tilleggsprøve på UI09: `input keyevent 20` (DPAD_NED, målt — ikke antatt — som 20) og et krav om at `focused="true"` havner på en node i egen pakke. **44 dp-målingen har rullbevis**: en node som er klippet av ScrollViewens viewport, rapporterer klippinga og ikke boksen sin (klippinga er ikke skjermkanten — målt 2716 mot 2992 px), så enhver node som måles for liten, rulles inn i visningen med inntil fire swipes og måles på nytt, og det beste tallet per node blir rapportert; skjerma rulles til toppen igjen før gangen går videre. **Folden måles likevel som geometri, ikke som nærvær**, fordi rullbeviset bare dekker noden som blir målt: sjekken «offers prose» gikk grønt på en node med `bounds="[48,1307][1296,1161]"` — ei linje uten pixels i det hele tatt — mens den faste footeren tok 1 831 av skjermens 2 992 px, altså en skjerm som viste en episode ingen spiller kunne lese. Nå kreves `y2 <= viewport.h` på overskrifta og det første prosavsnittet, og sjekken som leter etter dørene, går over **heile rullen**, fordi en rad som henger fullstendig under folden, ikke kommer inn i treet i det hele tatt: målt ved 200 % tekst ga play-skjermen 47 noder og seks klikkbare — de seks sekundærknappene — og null dører, mens skjermen renderde alle fire. Døra gangen trykker, blir derfor målt mot 44 dp fra det dumpet som viser henne på skjermen, ikke fra et klippet avtrykk. Gangen har to pass: *prepare* (feiler et steg, kaster — en gang som ikke kan gå, er ikke en måling) og *measure* ( samme påstander som sjekker). Den er port-uavhengig via `PUNKGRID_BASE_URL` (#37). To mekanikker på Android ble målt fram og bygd inn: `input keyevent 123` (MOVE_END) legger utvalget sammen, så påfølgende `input text` **legger til** i feltet — første versjon etterlot `http://10.0.2.2:3000http://10.0.2.2:3100` og slapp gjennom fordi ventinga bare søkte på en delstreng; feltet fokuseres nå ved `focused === true`, tømmes med DEL i runder som leser tilbake, skrives i 6-tegns blokker (én `input text` med 21 tegn mista en `/`), og godtas først når feltet er **eksakt** lik adressen. For det andre gjenoppretter expo-router forrige stabler ved kald start, så hoppen ut av UI02 kan lande på UI10 der «My worlds» ikke finnes i treet — biblioteket nås derfor med navngitt deep link (`punkgrid://library`) og en predikatventer på `Begin a new life`/`Version N`, gjenutsendt inntil tre ganger. Det tredje som ble målt fram, er selve lesinga: `uiautomator dump` er ikke et pålitelig avtrykk av et vindu som animerer — det svarer uten rotnode, eller med forrige apps tre — og `readWholeScreen` tolka et tomt tre som «skjermen sluttet å endre seg», altså som slutten av rullen, slik at 200 %-kjøringa rapporterte første viewport som hele skjermen. Dumpet blir nå tatt én gang til før det forkastes, og et tomt tre ruller videre i steden for å avslutte. Samme loop måler etterpå hver avlesning mot hva passet allerede har sett: deler en avlesning under 20 % av merkene med det forrige, har appen bytta skjerm under lesa, og looppen bryter i stedet for å slå to skjermer sammen til ett tre som aldri har eksistert på enheten (målt på 200 %-kjøringen 2026-10-12, der lesinga kom tilbake med UI01 og UI02 og ingen av dørene den hadde startet på). `tap()` navngir i tillegg kontrollen den mista — «cannot tap a node without bounds» var ikke en setning om enheten, da gangen stoppa der. Grønt **125/125** ved font_scale 1.0
(`docs/qa/evidence/device-walk/2026-10-13T14-32-49-700Z`) og **130/130** ved 2.0
(`…/2026-10-13T14-48-25-166Z`) med dagens APK, den endelige skriptet og en tjenerprosess bygget fra
dagens `dist/`. Det fjerde måleinstrumentfeilet som ble lukket, hører til folden:
`findToTap` returnerte det første navnet treet fant, og en rad folden hadde kuttet,
rapporterer en boks med underkant nøyaktig på viewportens underkant (`[48,2429][1296,2545]`
for en 329 px-dør i et felt som ender på 2545), altså ei lita kontroll som aldri har
eksistert — sjekken sa `saw: 1248x116` på ei dørmål på 1 248×329. Nå må noden ligge
**helt innenfor** rullefeltet før den godtas (`uncut`), og swipene ankeres på
enhetens egen `scrollable`-node i stedet for brøker av skjermhøyden, slik de ikke
kan havne i den faste footeren. Samme pass fant også noe som ikke var en
målefeil i det hele tatt, men en produktfeil: «the next episode is on screen»
viste `Episode 20` mens hodet på samme skjerm sa `version 21`, fordi episodesiden
svarte med de eldste tyve og
`nextCursor: null` — hele historikken står i «Feil suitene fant». Det femte måleinstrumentet
som ble lukket, er kunstmålinga på ei plates rekke: da `ArtPlate` ble slått sammen til éi
tilgjengelighetsnode, flytta navnet under kunsten `y1` sin opp til platens egen topplinja, og
midtraden mellom overskrifta og den noden landet i luften over bildet — begge skiverekkene
gikk røde med «1 distinct colours» på ei skjerm som viste fotografi (#61). Å ramme inn mot
noden nedenfor holder ikke her, så `plateRow` måler seg mot platenes egne `ImageView`-noder
og godtar bare oppreiste bokser. Det tvinger fram det sjette: en node som er klippet, melder
inverterte bounds (`[120,2855][405,2713]` på besetningsrekka), og gangen stoppa rullinga si
når bracket-ankrene fantest — altså fotograferte den folden og kalte det ei måling.
Nå ruller `shootBand` til rekkja er inne i bildet med det samme, fordi boksen må ha
`y2 > y1`. De fem sjekkene 200 %-passet har ekstra, er ikke fem nye påstander: UI10
blir auditert inne i `setServerAddress`, der adressen faktisk må skrives, og én gang til
etter at skalaen er byttet og appen starta på kaldt (`device-walk.mjs:742-753`), fordi det
første avtrykket ligger på den skalaen enheten kom inn med. Hver kjøring legger **seksten**
skjermbilder + **seksten** skjermtre i bevismappa: sist
`docs/qa/evidence/device-walk/2026-10-13T14-48-25-166Z` (2.0), foran den
`…T14-32-49-700Z` (1.0) og `…T14-16-00-257Z` (1.0, den første køyringa med dør-kunst). Trærne er sammenlikbare fra kjøring til
kjøring, og det er målt: da statusprikken på play-skjermen fikk sin egen pust 2026-10-13,
målte UI04 99 noder og sju klikkbare mot 96 og seks før, og årsaken var episode 14s fjerde
dør — prikken selv er `accessibilityElementsHidden`, og de tolv andre trærne er nodetall for
nodetall uendret. Emulatoren er `PunkGrid_Verify`, en egen AVD for dette prosjektet: den delte `SFD_Verify` ble tatt av en søsterøkt mens gangen gikk, og da landa trykk i en annens app og på en enhet som var borte (README, «Kjøring»). Prosaen på skjermen er den deterministiske stand-in-en, ikke en fallback: `published`-status uten `PUNKGRID_AI_*`-nøkler. Skriptet er opt-in: det krever en emulator med en APK bygget med innbygd bundle (README, «Kjøring»), en tjener nåbar på `PUNKGRID_BASE_URL` fra emulatoren med `PUNKGRID_DEV_USERS=user_demo`, og det etterlater verdenen én versjon høyere per kjøring |
| Kapasitet (NFR-12) | `core/scripts/loadtest.ts` (`npm run loadtest`) | 1 000 økter × 4 slag mot samme `buildApp` som tjeneren starter, i en egen prosess (klienten starter sin egen tjenerprosess, så en mettet tjener aldrig deler event loop med det som måler den), med `CompliantProvider` som simulert generering og kanon i minnet: 16 000 forespørsler, alle 200/201, ingen 5xx, alle med `x-request-id`, og versjonskjede + publisert episode kontrollert per økt. Målt 2026-10-12 med 64 køer: 2 722 req/s, 170 økter/s, GET p50 17,5 ms / p95 57,0 ms / max 88,7 ms. Bøtta er 200 000 og tallet står i rapporten, av en grunn som er verdt å si: alle øktene kommer fra 127.0.0.1, og i minnelagsbygget er adresse- og kontobøtta samme mappe, så 1 000 økter drenerer én bøtte — med produksjonens kapasitet 30 svarte 429 på de første 30 forespørslene (målt), og det er vaktbikkja som virker, ikke kapasiteten. Samtidighetskurven for samme last: 128 køer p95 110 ms, 256 → 233 ms, 512 → 504 ms, 1 000 → 1 031 ms, mens gjennomstrømningen ligger på ~2 600 req/s hele veien — metning, ikke mer arbeid. Skriptet **feiler** derfor (exit 1) på NFR-01 (`p95 <500 ms` for GET) med `--workers=1000`; et tall som er for tregt til å tjene, er ikke en godkjening. Én laptop-prosess, loopback, kanon i minnet: dette er bevis på kapasitet i forespørselsbanen, ikke utplassert kapasitet. **Den utplasserte formen er målt**, med `--db=<url>`: samme `buildApp` over `PgStore`, narrasjon gjennom outbox-workeren i tjenerprosessen (ADR-006), og tid fra commit til lesbar prosa som eget tall. Målt 2026-10-12 på to etterfølgende hele kjøringer, 64 køer, mot én fersk migrert database (`punkgrid_nfr12`, 001→010), én API-prosess og én outbox-worker på samme maskin. Grønn kjøring (exit 0): 31 974 forespørsler på 303,5 s = 105 req/s, 3,3 økter/s — 14 974 av dem er poll-løkken som venter på køen — status 200×30 974 / 202×1 000, ingen 5xx, GET p50 17,3 / **p95 46,1** / max 1 563,5 ms (NFR-01 holdt), commit → publisert p50 3 689 / **p75 3 713** / p95 4 958 / max 8 387 ms over 5 000 episoder (NFR-02 holdt; tallet er kvantisert til de 1 200 ms klienten venter med, så det er en øvre grense på køen, ikke et mål på den). Feilet kjøring (exit 1), samme last: 32 613 forespørsler på 319,8 s, GET p95 72,3 ms og p75 3 787 ms, men **3 × HTTP 500 på `POST /v1/worlds`** (sesjon 20, 58 og 65). 500-ene ble ikke reprodusert den gangen: etter at måleinstrumentet fikk feiltekst, er det kjørt sju laster mot `punkgrid_nfr12` — 7 400 verdenopprettinger i alt, tre av dem med én API-prosess og fire i to parallelle par mot samme database — og ingen av dem ga en eneste 5xx og ingen skrev en videreført feil til stderr. Den muligheten var altså målt fri, men **årsaken er navngitt og reprodusert 2026-10-12** (avsnittet «Feil suitene fant»): to prosesser som startet i samme millisecond, delte `seed: Date.now()`, og `makeIdFactory` er en ren funksjon av frøet, så begge mintet samme verden-id og samme identitets-id. De sju frie kjøringene målte bare at konkurransen er sjelden — to prosesser i samme millisecond er et løp, ikke en tilstand. Det to-prosessformen derimot fant, var en episode som aldri ble skrevet: kjøring B endte FAILED på `episode ep_SH1MHKZ79R0GL5 is still pending after 121083 ms`, og i databasen lå episoden som `pending` med jobben sin som `claimed` og en lease som gikk ut 10:55:20Z. `claimJob` så bare på `pending`-rader (`core/src/db/pgStore.ts:602-608`), så en worker som dør mens den holder en jobb, etterlater den for alltid — en rullerende deploy eller en drept prosess gjør det samme, og ADR-013 lover `published` eller `fallback`. Nå gjenopptas et utløpt `claimed`-ledd, `attempts` avgrenser gjenopptaket, og neste worker skriver scenen ferdig. Formen er kjørt om etter endringen, begge kjøringene endte grønn, og databasen holder 31 170 episoder der alle er publisert og ingen jobber er `claimed` — inkludert de to som hadde hengt seg før endringen, og som ble skrevet ferdig av den første workeren som kjørte etterpå. De utplasserte tallene er dessuten én maskin på loopback, uten ekte modell og uten lastbalanser, og `pg.test.ts:736` måler samme kø ett oppdrag om gangen |
| SQL-invarianter | `docs/architecture/migrations/validate_invariants.sql` | 20 negative blokker (1–20, med a/b/c/d-varianter) + RLS-positiver mot PostgreSQL 16: 30 `ok`-meldinger, exit 0. Blokk 18–20 dekker `moderation_cases`:FK på (world_id, episode_id), unik `command_id`, utdrags- og notatlengder, `reviewed_at` som følgesvenn av lukket status, RLS-les for medlem/ikke-medlem, og at verken `punkgrid_app` eller `punkgrid_worker` kan skrive eller lukke en sak. Filen har egen `BEGIN`/`ROLLBACK`: målt 2026-10-12 med 29 rader i `worlds`+`world_events`+`moderation_cases`+`users`+`narrative_episodes` før og 29 etter, altså ingen lekkasje. Resten kan være et annet tall fra kjøring til kjøring — det som måles, er at før og etter er likt |
| Evalutkast (FR-19) | `core/scripts/eval-narrative.ts` → `docs/qa/EVAL-narrative.md` | 8 tilfeller gjennom §10-grensen (compliant, faktalekkasje, inventerte valg, selvdeklarert blokkert, timeout, blokkerende prosa uten providerflags, flaggende prosa, injiserende instruks), 4 angrepstekster og 6 rolige tekster mot screenen: 8/8 forventet utfall, 4/4 blokkategorier fanget, 0/6 falske positiver, 65 narrasjonsforsøk, usd 0.2600 estimert. Scriptet avslutter med exit 1 ved avvik. **Måler grensens beslutninger, ikke prosekvaliteten hos en levende modell** |


Historisk fullkjøring 2026-10-13 med `npm test` fra repo-roten. Uten database:
**274 passed | 26 skipped (300)** i 19 filer — 128 kjernetilfeller (der vaktbikkjen som rapporterer at
Postgres-settet hoppet over, er den ene som løper likevel), 106 i mobilappens
logikktester, 23 i `apps/mobile/scripts/reading-order.test.mjs` og 17 i
`apps/mobile/scripts/art-check.test.mjs` (de to sistnevnte er målinger på bevismappa,
så tallet deres vokser med hver kjøring). Med
database løper de 26 i stedet, og `core/tests/pg.test.ts` er målt grønt samme dag
alene (27 passed mot kastbasen `punkgrid_test`), som gir **300 passed** uten én
skippet i de samme 19 filer.
Postgres-settet er opt-in og krever en kastbar base:

```powershell
$env:PUNKGRID_DB_URL = "postgresql://postgres:punkgrid_dev_pw@localhost:54330/punkgrid_test"
$env:PUNKGRID_TEST_DB = "1"   # uten denne hopper settet over — det TRUNCATEER skjemaet
npx vitest run
```

Uten de to miljøvariablene skriver suiten en advarsel til stdout
(`! Postgres suite SKIPPED`), slik at en grønn kjøring ikke kan leses som at det
persistente laget er testet. Sist kjørt grønt 2026-10-13, etter at besetningsrekka
fikset portrettslottet sitt og målemetoden for skiverekkene: `npm run typecheck` og `npx tsc
--noEmit` i `apps/mobile` (begge uten output), `npm test` uten database (**274
passed | 26 skipped (300)**, 19 filer — 128 kjernetilfeller, 106 i mobilappen, 23 i
leseordenmodulen og 17 i kunstmodulen), og `npm test` med Postgres mot kastbasen
`punkgrid_test` (**300 passed**, ingen skipped; `core/tests/pg.test.ts` alene 27).
Kjøringen gikk mot `punkgrid_test`, ikke mot dev-basen: suitet TRUNCATEER skjemaet
i den databasen pekeren navngir, og verdenene `user_demo` har i `punkgrid`, er det
enhetsgangen åpner UI07 med. Historien bak står i «Feil suitene fant». Ellers:
`npm run build`, `npm run seed` (gullhash `sha256:ba95bdda…6247`, replay lik og
`golden hash : match` etter autorisasjonsrettelsene i `SECURITY.md` §2),
`npm run eval:narrative` (8/8, exit 0) og
`docker exec -i punkgrid-pg psql -v ON_ERROR_STOP=1 -f - <
docs/architecture/migrations/validate_invariants.sql` (30 `ok`-meldinger, exit 0,
29 rader i kanon før og 29 etter — tallet er resten fra forrige kjøring, poenget er
at det er likt).

E2E-filen skriver to målinger til stdout, og de er målt på denne maskinen i de to
fulle kjøringene 2026-10-13: GET-p50 0,5–0,6 ms, GET-p95 2,2–2,4 ms, verste GET
11,7–12,8 ms
over 50 forespørsler (31 les), og første scene fra kommando til publisert prosa
2,7–2,9 ms. Begge er innenfor NFR-01 (p95 < 500 ms) og NFR-02 (p75 < 20 s), men
begge er målt i én prosess på loopback mot kanon i minnet, der narrasjonen
sker innenfor kommandoen.

Den utplasserte formen er målt for seg, i `pg.test.ts:736` og `:767` — Postgres
som kanon, outbox-workeren i sin egen løkke, og den delte rate limit-bøtta fra
F-S6 på banen. Tallene er seks kjøringer 2026-10-12/13 (to fulle `npm test` med
database og fire `npx vitest run core/tests/pg.test.ts`; de to sistnevnte formene
altså, i dag: én av hver): 30 GET over de tre
verdenrutene gir **p50 12,5–15,6 ms, p95 15,3–23,1 ms**, verste treff
15,9–27,1 ms, alle med `x-request-id` og ingen 5xx, og `world.create`-commit til
åpningsepisoden leser `published`, tar **0,08–0,09 s**. Den samme fulle kjøringen
skrev minnelager-tallene i nabofilen: p50 0,5 og p95 2,2 ms. Lesingen i
utplassert form er altså omtrent 20× minnelagerets p50 — det er prisen av to
rundturer per autentiserte forespørsel (bøtta og enhetsarbeidet) — og fortsatt
omtrent to størrelsesordener innenfor NFR-01. NFR-02-tallet er en nedre grense i
to avseende: narrasjonen er
`CompliantProvider` (ingen nett, ingen gateway-tid), og workeren fant jobben i
første pass; med en ekte gateway på banen er det provideren som eier
ventetiden, og workerens 500 ms hvileintervall kommer i tillegg når den sover.
Begge sett er sjekkene som gjør at flyten ikke kan bli tregere uten at noen
merker det. De erstatter ikke lastetesten (NFR-12), som nå er målt med 1 000
samtidige økter i `core/scripts/loadtest.ts` (raden over), og de erstatter ikke
en måling mot en ekte gateway (NFR-02s egentlige innhold, jfr. ADR-013).


Samme dag ble den faktiske kjøringen spilt for hånd mot dev-beholderen: `npm run
migrate`, `npm run serve` med `PUNKGRID_NO_WORKER=1` på `127.0.0.1:3111`,
dev-token for `user_demo`, `POST /v1/worlds` (202, episode `pending`),
`GET /v1/worlds` og `GET /v1/worlds/{id}` (identitet, fire valg),
`POST …/choices` (200, ny episode `pending`), og så `npm run worker` som egen
prosess — etter det var begge episodene `published`, verden på versjon 2 og ingenting
igjen i køen. De to punktene nedenfor kommer derfra.

Samme dag ble den samme flyten kjørt på en ekte enhet: `apps/mobile` bygd med
`npx expo run:android --device SFD_Verify` (debug-APK), tjener startet med
`npm run serve` og `PUNKGRID_HOST=0.0.0.0` (127.0.0.1 når ikke vertsmaskinen fra
emulatoren — appen løser adressen selv, se README), og appen logget inn med
dev-token for `user_demo`. Verdenslisten, åpningen, et valg, den ventende episoden og
pause/gjenopptak er sett på skjermen. Det er der ADR-019 oppsto: raden skrev ut
en rå `worldId`, og spillskjermens tittel falt tilbake på mal-id-en `glass-harbor-2034`
etter reload. Skjermbevis: `docs/qa/evidence/postgres-2026-10-12/pg-ui07-rulepackId.png` og
`docs/qa/evidence/postgres-2026-10-12/pg-ui04-title.png`.

Kjøringen over var før WCAG-fiksen. 2026-10-12 ble den samme flyten kjørt på nytt på
`emulator-5556` (Android 16) med den bygde APK-en, tjeneren på `0.0.0.0:3000`,
dev-Postgres og workeren som egen prosess, og hele gullstien er sett på skjermen.
Skjermbevisene ligger i `docs/qa/evidence/2026-10-12-emulator/`: UI01 med
«Not signed in» og `18+ · http://10.0.2.2:3000`
(`ui01-welcome-not-signed-in.png`), UI02 med dev-innlogging som `user_demo`
(`ui02-dev-sign-in.png`; den ruten måler enhetsgangen i dag under navnet `dev sign-in`,
fordi Master §5.3 gir UI02-nummeret til genesis-valet), UI07 som listar «The Glass Harbor / Version 1 · world time
2034-09-15 / Active» (`ui07-library-list.png`), UI04 med Episode 1, fire valg og hele
knappefeltet (`ui04-episode1-version1.png`), ett valg som ga versjon 2 og Episode 2
med fem hendelser etter at workeren publiserte (`ui04-episode2-version2.png`), og
UI09 med «2 committed scenes in this world», Episode 1 · events 1−1 · Published ·
version 1 og Episode 2 · events 2−6 · Published · version 2
(`ui09-history-two-episodes.png`). Feiltilstanden er også målt: med en lagret token
signert av en gammel `PUNKGRID_DEV_SECRET` viste UI07 ErrorPanel «Could not read your
worlds / Token signature rejected / Try again»
(`ui07-library-token-rejected.png`), og `pm clear` + ny innlogging kurerte det. Prosaen
i Episode 1 og 2 er fallback-malen, fordi ingen `PUNKGRID_AI_*`-nøkkel er satt — det
ventet på nøkkelen, ikke på klienten. Kilden er tilbakeført etterpå
(`MainApplication.kt` er lik malen igjen og `assets/` er slettet); den installerte
APK-en på enheten har fremdeles den innebygde bundle-en, så emulatoren viser appen
uten Metro.

## Feil suitene fant

- **Spill-skjermen låste seg på Episode 20 i en verden som gikk videre.**
  `engine.listEpisodes` svarte med de eldste tyve episodene og `nextCursor: null`,
  uavhengig av hvor mange som fantes. Konsekvensen lå ikke i historikken, den lå i
  selve spillet: `apps/mobile/src/lib/play.ts:87` tar den siste episoden i listen
  som dagens scene, så en spiller som hadde spilt seg til versjon 21, fikk den
  tjueende scenen på skjermen resten av livet — og uten feilmelding, fordi
  svaret var en gyldig side. Fanget av enhetsgangen 2026-10-13, som etter ett
  trykk krevde at neste episode sto på skjermen: treet sa `Episode 20` mens
  hodet på samme skjerm sa `version 21`
  (`docs/qa/evidence/device-walk/2026-10-13T00-26-56-542Z/UI04 after the choice.xml`).
  De to andre målingene er uavhengige av gangen: kjørt mot den løpende
  dev-tjeneren ga `GET …/episodes` 20 itemer og `nextCursor: null`, mens
  `punkgrid.narrative_episodes` holdt 21 rader med `published` for samme verden.
  Kontrakten sier paginering, ikke en side:
  `docs/architecture/REALITY_ENGINE_CORE_CONTRACT_v1.0.md:258` —
  `{items,nextCursor}`. Fiksen er tre lag: motoren gir en skikkelig side
  (`core/src/engine.ts:172`, sortert på `fromEventSequence`, `MAX_PAGE` 200 som
  tak, og `cursor`/`limit` valideres som 400 `INVALID_SCHEMA` i stedet for å bli
  taus), ruten sender query-parameterne videre (`core/src/api.ts:130`), og klienten
  går sidene til enden i stedet for å lese én (`apps/mobile/src/lib/api.ts:211`,
  100 om gangen). De to lesingene som allerede fantes, ble stående: play-skjermen
  tar siste element og historikken nummererer stigende, og begge blir riktige når
  listen er full. Falsifisert: tilfellet
  «serves the whole story through the cursor instead of stopping at twenty» i
  `core/tests/api.test.ts` bygger 25 episoder og krever at første side er
  versjon 1–20 med `nextCursor === '20'` og halen 21–25 med `null`; på den gamle
  motoren er halen tom. `apps/mobile/src/lib/api.test.ts` måler de to URL-ene
  gangen faktisk sender, og at en side uten itemer avslutter løkken i stedet for
  å stole på en cursor som allerede er brukt. Målt på enheten etter fiksen:
  «the header moved from version 21 to 22» og «the next episode is on screen
  (Episode 22)» er grønt, og passet er 125/125
  (`docs/qa/evidence/device-walk/2026-10-13T14-32-49-700Z`). Igjen står
  søsterveggen: `GET /v1/worlds` (`engine.listWorlds`) svarte alltid
  `nextCursor: null` det også, altså samme kontrakthus som ikke holder. Ved MVPs
  skala er en verden per konto sjelden nok til at det ikke merkes, men det er en
  åpen linje i tabellen, ikke en lukket.
- **Enhetsgangen målte en dør som folden hadde kuttet, som en for liten
  kontroll.** `findToTap` returnerte det første navnet treet fant, selv om
  rullebeholderen hadde klippet resten av raden. En klippet node rapporterer en
  boks med *positiv* høyde hvis underkant ligger nøyaktig på viewportens underkant
  (målt `[48,2429][1296,2545]` for en 329 px-dør i en beholder som ender på 2545),
  så `whole()` slapp den gjennom, og 44 dp-sjekken feilet med `saw: 1248x116` på
  en kontroll som var 1 248×329. Det var måleinstrumentet som løy, ikke appen.
  Fiksen har to deler: `uncut()` krever at noden ligger helt innenfor rullefeltet
  før den godtas som funnet, og swipene ankeres på enhetens egen `scrollable`-node
  (`parseTree` eksponerer attributtet) i stedet for brøker av skjermhøyden, slik en
  gesture ikke kan havne i den faste footeren under. Begge deler måles:
  «the door reached on the scroll is at least 44 dp (132 px) on its short side»
  gikk fra FAIL til grønt på samme node.
- **En worker som dør mens den holder en jobb, låste scenen for alltid.**
  `claimJob` plukket bare rader med `status = 'pending'`, så en rad som ble
  claimet og aldri gjort opp, ble værende `claimed` uavhengig av leasen sin — og
  `syncOutbox` setter ikke ny jobb for en episode som allerede har en åpen
  (`pending`/`claimed`). Fanget av en NFR-12-kjøring i to-instans-form: 600 økter
  mot `punkgrid_nfr12` endte FAILED på `episode ep_SH1MHKZ79R0GL5 is still pending
  after 121083 ms` (fristen ligger i `core/scripts/loadtest.ts:274`), og raden lå
  som `claimed` med lease utløpt 10:55:20Z. Formene dette skjer i, er ikke
  sjeldne: en rullerende deploy, en worker som blir drept av minnetrykk, eller ett
  provider-kall som varer lenger enn de 60 sekundene leasen er skrevet med. Nå
  gjenopptas et `claimed`-ledd når leasen er utløpt (`core/src/db/pgStore.ts:602-608`),
  og `attempts` (< `max_attempts`) avgrenser hvor mange ganger, slik en krasj ikke
  kan gi uendelig med arbeid på samme rad. Tilfellet «recovers the job of a worker
  that died holding it» i `core/tests/pg.test.ts` drenerer en slik jobb til
  publisert prosa, og uten endringen måles det som feil på dreneringen
  (`{ completed: 0, retried: 0 }`). Last i samme form er kjørt om etterpå: begge
  kjøringene endte grønn, databasen holder 31 170 episoder der alle er publisert,
  og ingen jobber står som `claimed`. Klientsiden er tatt med: en episode som
  verken er `published` eller `fallback` når de 120 sekundene med polling er brukt,
  gir nå en forklart tilstand med gjenlesing i stedet for forrige scene uten melding
  (`apps/mobile/src/lib/play.ts:170`, testet i `play.test.ts`). Igjen står den
  andre halvdelen: en jobb som tømmer sine tre forsøk, blir `failed` uten at
  episoden blir gjort opp, og det er en beslutning i tilstandsmaskinen (ADR-013)
  som eierne må ta — se «Gjenstår for QA».
- **`core/src/db/pgStore.ts` hydrerte ikke claimede outbox-jobber.** Workeren
  claimer raden (status → `claimed`) før den hydrerer aggregatet, men
  read-modellen spurte bare på `status = 'pending'`. Følgen: `flush()` fant en
  tom outbox, jobben ble markert `completed`, og episoden ble liggende som
  `pending` for alltid — HTTP-svaret var 202 og pollingen fikk aldri prosa.
  Fanget av det nye integrasjonstilfellet «commits with the episode pending and
  lets the worker publish it»; retten er at enhetsarbeidet som holder verdens
  advisory-lås eier alle åpne jobber for den verdenen (ADR-016 punkt 7).
- **`worker.run()` kan ikke testes med en søvn som resolverer umiddelbart.** Den
  injiserte `sleep: async () => { ticks += 1 }` gjorde `run()` til en
  mikrooppgaveløkke som sultnet alle timere — vitest-arbeiderprosessen døde med
  `Worker exited unexpectedly` før testlisten i det hele tatt ble skrevet.
  `core/tests/worker.test.ts` bruker nå en søvn som faktisk venter på en timer.
- **`world_facts` manglet FK til `worlds`.** Postgres-replayen ga 22 hendelser
  og en annen hash enn minnelageret: rader fra en tidligere kjøring overlevde
  `TRUNCATE ... CASCADE` (ingen FK å kaskade langs), ble hydrert inn i en ny
  verden med samme id, og fikk motoren til hoppe over `fact.created` og
  `fact.disclosed`. Rettelsen er FK i `003_cast.sql` pluss blokk 17 i
  `validate_invariants.sql`, som nekte verdenstabeller uten `world_id`-FK.
  Testen «keeps every world-bound row inside its own world» sjekker nå
  hydreringsscopeet, ikke bare FK-avvisning.
- **Tilkoblingsoppsettet racet det første statementet.** `SET search_path` i en
  `connect`-listener kunne løpe etter at låntakeren allerede hadde sendt en
  forespørsel; trigger- og policy-functioner låser nå sitt eget søkebane, og
  poolen setter det som startparameter.
- **`TRUNCATE users CASCADE` er ikke en garantert tom database** — den er
  avhengig av at alle tabeller har FK. `wipe()` i `pg.test.ts` leser tabellnavn
  fra katalogen, truncerer dem alle og feiler hvis én rad overlever.
- **`GET /v1/worlds` ga tom `identityId` mot PostgreSQL.** Oppdagt av en
  håndkjørt rull mot `npm run serve` — listen svarte `""` for den samme verden
  som `GET world` returnerte riktig identitet for. Årsaken var hydreringen: en
  liste-forespørsel har ingen verden-id-er å scope etter, og `load()` returnerte
  tidlig før medlemskapsradene ble lest. Rettelsen er at medlemskap scopes på
  alle verdensidene lageret kjenner, og tilfellet er lagt inn i
  pg.test-HTTP-blokken, slik at suiten dekker det håndkjørte funnet.
- **Et `pending`-svar manglet `episodeId`.** `POST /v1/worlds/{id}/choices`
  svarte `{episodeStatus:'pending'}` uten id, så klienten hadde ingenting å
  poll — §11 tillater `episodeId?`, men for en ventende episode er nettopp id-en
  poenget. `Api.episodeFor` sender nå id for alle episodefaser, og
  integrasjonstilfellet poller den ventende episoden før og etter worker-passet.
- **Forventninger som var feil før koden ble lest:** en oppfunnet eller lånt
  `actorIdentityId` gir **403 WORLD_ACCESS_DENIED** (motoren sier
  `accessDenied`), ikke 422; `refillPerMinute: 0` gir `retryAfterSeconds =
  Infinity`, som serialiseres til `null` i JSON, så rate-limit-testen bruker
  refill 1; en CRLF- eller styrte header-verdi kan ikke sendes av Node-fetch i
  det hele tatt, så request-id-saneringen testes med 300 tegn og mellomrom i
  stedet.

- **Postgres-settet deler skjema med en løpende dev-tjener, og taper da.**
  Målt 2026-10-12: to tilfeller feilet i full kjøring med `wipe left rows behind`,
  mens `npx vitest run core/tests/pg.test.ts` alene og to påfølgende fulle kjøringer
  etterpå er grønn (den gang 192/192; i dag 229/229, målt to påfølgende kjøringer
  etter E2E-, kontrast- og rate limit-filene). Årsaken var
  `npm run serve`-prosessen fra
  emulatorkjøringen, som startet 05:19 samme dag og fortsatt levde: workeren i den
  prosessen claimer `outbox_jobs` (synlig i `pg_stat_activity` som
  application_name `punkgrid-api`), og `TRUNCATE … CASCADE` i `wipe()` konkurrerer
  med en ekstern skriver. `wipe()` oppdager rader som overlever i stedet for å
  skjule dem — det er hensikten — og prosessen er nå stoppet. Regelen: stopp
  tjener- og workerprosessene før en `PUNKGRID_TEST_DB=1`-kjøring, eller pek testen
  på en egen database. Det siste er nå målt, ikke bare antatt: `npx vitest run` mot
  kastbasen `punkgrid_test` (migrert på samme url) gir **278 passed (18 filer)**
  mens `npm run serve` fra emulatorkjøringen går hele tiden og `/healthz` svarer
  200 — målt på nytt 2026-10-13, med dev-tjeneren oppe hele tiden og pekeren på
  `punkgrid` — skjemaet dev-tjeneren bor i, er ikke lenger felles. Kommandoen står i
  README, avsnittet «Mot PostgreSQL (valgfritt)».
- **Provisjoneringsmemoen overlevde raden den sto for, og låste kontoen for
  prosessens levetid** (F-S10). Målt 2026-10-12, i akkurat den formen punktet over
  varsler om: Postgres-settet kjørte mot `punkgrid` mens `npm run serve` hadde
  kontoen sin i minne. `SessionRunner.provisioned` (`core/src/server/runner.ts:17`)
  er en `Set` av subjekter prosessen allerede har provisionert, og `ensureAccount`
  hopper over writing når subjektet står der. `TRUNCATE` fjernet `users`-raden,
  memoen ble værende, og hvert kall fra `user_demo` gikk til `engine.ts:125`, som
  sier `if (!this.store.users.has(userId)) throw err.unauthenticated()` — altså 401
  «Authentication required» fra motoren, ikke fra auth-laget, som alltid setter en
  spesifikk tekst («Bearer token required», «Malformed token», «Token signature
  rejected», «Token expired»). Det avviket var diagnosen. Reprodusert håndkjørt:
  `/dev/token` ga 200 og et friskt token, samme token ga 401 på `GET /v1/worlds`,
  og omstart av tjeneren ga 200 og en ny `users`-rad. F15 (kontosletting)
  *produserer* denne tilstanden med vilje, så feilen er ikke en kastbasesattest.
  Fiksen: en 401 på en memoert konto dropper memoen og kjører forespørselen én gang
  til (`runner.ts:33-45`); en andre 401 er kalderens problem og går uendret ut.
  Tilfellet «re-provisions an account whose row went away underneath the memo»
  (`core/tests/pg.test.ts:644`) måler sekvensen over HTTP mot `punkgrid_test`, og
  falsifisert: uten `try/catch`-leddet måles `after.status` til **401** og tilfellet
  går rødt; med det er det grønt og raden er tilbake (`count = 1`).
- **Tre autorisasjonsfeil i kommandobanen, funnet av angreppssuiten (Sprint 6,
  se `docs/qa/SECURITY.md` F-S1–F-S3).** (1) `executeCommand` slo opp lagrede
  kommandoresulter før medlemskapet ble spurt, så et lånt `commandId` ga en
  annen konto dennes CommandResult; roten er at `requestHash` for
  verdenkommandoer ikke dekker `actorUserId` (`engine.ts:393, 414, 466, 504,
  518`). (2) `authorizeWrite` svarte 403 på en fremden verden mens lesing svarte
  404 — statuskoden alene var et eksistensorakel. (3) `reportEpisode` deduplikerte
  på `commandId` før lesesjekken og utlevererte kvitteringen. Rettelsene:
  oppslag bak `authorizeWrite` i verdenslåsen (`engine.ts:538-550`), 404 som
  felles svar (`engine.ts:1043-1049`) og `authorizeRead` først
  (`engine.ts:188-189`). Bevis for at testene bærer: koden ble reversert til
  standen før fiksen, og `security.test.ts` gikk da på **4 failed | 8 passed**;
  med den gjenvunne versjonen er hele suiten grønn.
- **Deterministisk id-frø kan droppe en hendelse i stillhet** (`SECURITY.md`
  F-S5). «Restart»-tilfellet i `pg.test.ts:977` brukte samme frø som den
  forrige prosessen, `makeIdFactory` mynter da `event_id` som allerede finnes,
  `core/src/db/pgStore.ts:373` har `on conflict (event_id) do nothing`, raden forsvinner uten
  feil, og ledger-utløseren stopper neste innsetting
  (`world_seq must advance by exactly one (found 14, expected 13)`). Regelen står
  allerede i `AppConfig.seed`-kommentaren (`core/src/server/app.ts:32-34`); testen bruker
  nå nytt frø og viser hva som skjer ved brudd.
- **008s kommentar om vaktorden i ledger er ikke det som måles.** Den sier at
  append-only-utløserne slår inn før rettigheter spørres. Med `SET LOCAL ROLE`
  er virkeligheten: worker-rollens `UPDATE` på `world_events` er *ingen feil* —
  RLS skjuler alle radene, setningen lyktes med 0 rader og endret ingenting;
  `DELETE` er 42501 fra grant-listen; det er eier-rollen (som går forbi RLS) bare
  utløserne i 004/006 stopper. Kommentaren er **ikke** redigert i
  `008_rls.sql`: `migrate.ts:58-60` låser anvendte migrasjoner med checksum, så
  selv en kommentar ville nektet `npm run migrate` mot en database som har 008.
  Avviket er ført i `docs/architecture/migrations/README.md` og i
  `SECURITY.md` F-S4.
- **RLS er en korrekt skrevet, men inert, andre forsvarslinje** (F-S4).
  `createPool` har `assumeRole` (`core/src/db/client.ts:19,24`) som ingen bruker, og ingen
  plass i `core/src` setter `app.user_id`. Kanon er i dag beskyttet bare av
  autoriseringen i motoren. Del opp lese- og skriveidentiteten, eller utvid
  policyene for tjenesteidentiteten, før flertenant-utplassering; α på én prosess
  kan gå. Beslutningen står i `SECURITY.md` F-S4.
- **To linjer på måleinstrumentet, på vegne av den 500-en vi ikke har et navn på.**
  `crash()` i `core/src/server/http.ts:197` skrev bare feilens navn
  (`500 fault Error`) når den tok et unntak som kom *utenfor* `Api.handle`, mens
  `unhandled`-veien i `core/src/server/app.ts:194` skriver hele tekstet. Et navn
  alene er ikke det som navngir en 500-kjøring, så bakstoppen skriver
  `name: message` nå. Den andre linjen er levetid: lasttesten gir
  `--serve`-barnet sitt en `--parent`-overvåker (`core/scripts/loadtest.ts`), slik
  at API-et følger klienten ned når den blir drept eller avbrutt, i stedet for å
  bli stående med en port og en outbox-worker på en database neste kjøring ikke
  vet om. Målt ved å drepe en løpende klient med `Stop-Process`: én `--serve`
  levde 10 sekunder ut i kjøringen, null var igjen fem sekunder etter drapet.
  `process.kill(pid, 0)` er målt på denne maskinen til å være en ren
  eksistenssjekk — den dreper ikke målet — og bare `ESRCH` teller som borte. Merk
  hva dette *ikke* er: en forelder som gikk ut på egen hånd, slapp heller ikke
  ensom etter seg en `--serve`, så orfanfaren er ikke reprodusert her og er ikke
  en kandidat til årsaken til de tre 500-ene. Suitet etter endringen:
  205 passed | 24 skipped uten database, `core/tests/pg.test.ts` 25 passed mot
  kastbasen `punkgrid_test`, `npm run typecheck` og `npm run build` grøne.
- **Den 500-en fikk navn: to prosesser kunne minte samme verdens-id.** Årsaken er
  frøet. `makeIdFactory` (`core/src/domain.ts:177`) er en ren funksjon av frøet, og
  `serve.ts`, `worker.ts` og `loadtest.ts` defaultet det til klokka. Målt 2026-10-12
  i en test som spiller produksjonsformen: to `Sessions`-objekter med samme frø
  mintet *samme* `worldId` og *samme* `identityId` (registerUser mintet ingenting,
  og en ekte kalder oppgir sin egen idempoternøkkel, så begge strømmene sto likt
  på sitt første mynt), og da ga den andre `POST /v1/worlds`
  `duplicate key value violates unique constraint
  "world_memberships_world_id_identity_id_key"` — ordrett den 500-en lasttesten
  hadde stått uten navn på. Fiksen har fire ledd, og hvert av dem er målt:
  `defaultSeed()` (`core/src/domain.ts:173`) trekker 32 bit fra `randomBytes` i
  stedet for å lese klokka, og `PUNKGRID_SEED` gir fortsatt et reproducibelt løp
  (`serve.ts:41`, `worker.ts:30`, `loadtest.ts:95`); verdenhodet fås bare av
  eieren sin (`pgStore.ts:323`), så en lånt id aborterer med
  `world <id> is already claimed by another owner` i loggen i stedet for en rå
  nøkkelkollisjon; `unit()` skylder ikke lenger den opprinnelige feilen over en
  ROLLBACK som selv feiler (`pgStore.ts:66-72`); og `crash()` skriver SQLSTATE
  (`http.ts:202`), som er forskjellen på «en id kolliderte» og «noe gikk galt».
  Falsifisering: `where worlds.owner_user_id = excluded.owner_user_id` fjernet,
  og tilfellet i `pg.test.ts:330` gikk rødt på akkurat den opprinnelige
  meldingen, altså tester den vaktbikkja og ikke bare utfallet. To ting dette
  *ikke* er: det er ikke en klientfeil — de sytten §11-kodene kan ikke navngi en
  integritetsfeil i lageret, så den blir værende en 500 med en tekst som duger;
  og eiervernet er annet forsvarslinje, førstelinja er at frøet ikke lenger er
  forutsigbart. Beslutningen står i `ADR-021`. Suitet etter endringen:
  244 passed | 25 skipped uten database,  269 passed med (`core/tests/pg.test.ts` 26), `npm run typecheck` og
  `npm run build` grøne. Det som stod igjen den gangen, er siden bygget: Postgres-settet
  TRUNCERER skjemaet, så `user_demo` har ingen verden å åpne — enhetsgangen
  *skaper* den nå selv i prepare-passet sitt (UI07 → UI03 → Surprise Me) og er
  kjørt grønn etter seed-fixen, på begge tekstskaleringene (tall og kjørte bevis i
  raden i tabellen over).

## Gjenstår for QA

- **En jobb som bruker opp forsøkene sine, bosatt ikke episoden sin.** `claimJob`
  gjenopptar nå et utløpt `claimed`-ledd (avsnittet «Feil suitene fant»), men når
  `attempts` når `max_attempts`, blir raden `failed` og episoden står igjen som
  `pending` for alltid — spilleren leser en scene som aldri ble skrevet. Det er
  målt i last-data som allerede ligger i `punkgrid_load`: 59 jobber med status
  `failed` hvis episode fortsatt er `pending`, og 62 episoder uten prosa i alt
  (de 59 pluss 3 rader fra en kjøring før lease-fiksen). Halvdelen som mangler er
  en beslutning om tilstandsmaskinen (ADR-013 lover `published`
  **eller** `fallback`): skal workeren skrive fallback-prosa når siste forsøk
  feiler, eller skal episoden markeres `failed` og klienten si det fra seg? Det
  ene uten det andre er en halv fix, og valget er deres, ikke mitt.
- **Verdenslisten pagineres ikke.** Samme kontraktshalvdel som episode-siden sto i
  (Contract-raden `GET /v1/worlds/{id}/episodes → {items,nextCursor}`, fikset
  2026-10-13 — se «Feil suitene fant»): `core/src/api.ts:117` svarer
  `nextCursor: null` hardcoded, og `engine.listWorlds(userId)` (`core/src/engine.ts:128`)
  tar verken `limit` eller `cursor`, så hele kontoens verden listes i ett svar.
  Ikke made på MVP-skala — `WORLD_LIMIT_REACHED` setter taket per konto, og veien
  en kunde faktisk går, har én verden — men den er en åpen linje i tabellen, og
  åpnes den, må UI07 lære å bla.
- **Autentisering er ennå en dev-port.** `HmacDevAuth` er HMAC-signert token med
  allowlist (ADR-016). Til Supabase Auth/JWT finnes, er §11s «short-lived bearer
  token» kun oppfylt i form, ikke i utforming — og token-rotasjon, refresh og
  utlogging er utestet.
- **Databasetester (§14) mot den utplasserte databasen:** de 20 negative
  blokkene og RLS-positivene er kjørt mot lokal PostgreSQL 16 med superbruker
  og `SET LOCAL ROLE`, ennå ikke mot Supabase med ekte tilkoblingspool,
  `service_role`-roller og `authenticated`-grants.
- **Rate limiten er delt for kontoer, per prosess for anonyme.** Kontokvoten
  ligger i `rate_limit_bucket` og ta'et skjer i `punkgrid_rate_limit_take()`
  (F-S6, målt i `pg.test.ts:1038`). Anonymbøtta er værende i prosessen med vilje —
  en uautentisert forespørsel som i tillegg skriver en database-rad, gjør vakten
  selv til et misbruksmål. Gjenstår: måle ordningen mot en ekte lastbalanser
  i stedet for to instanser i én testprosess, og bestemme oss for en TTL når
  tabellen kan få flere nøkler enn konto-id-er.
- **Replay-rapport som lagret artefakt:** `npm run seed` har en golden hash
  (`core/scripts/seed-glass-harbor.ts:120`) og avslutter med exit 1 ved drift,
  så kommandoen er en CI-kjørbar sjekk. En lagret pr. commit-rapport (fil i
  repo eller artefakt i pipeline) er ikke satt opp ennå.
- **FR-19 er halvdelt.** `npm run eval:narrative` skriver
  `docs/qa/EVAL-narrative.md` og måler hva §10-grensen *beslutter* (publicer /
  forkast / flagg / kostnad) mot deterministiske testproviderne. Prosekvalitet
  per promptversjon hos en levende modell — den opprinnelige FR-19-setningen —
  gjenstår til en `PUNKGRID_AI_*`-gateway er konfigurert, fordi den kjøringen
  koster penger og er din beslutning.
- **Sikkerhetsnegativ (§14/§15) er kjørt og rapportert** — se `docs/qa/SECURITY.md`.
  Igjen fra den listen: gjøre RLS om til en linje som nås (F-S4), erstatte
  dev-autentiseringsporten (F-S7), og fjerne
  409-orakelet i `createWorld` (F-S8 — lesinga er lagt bak sjekken på at kommandoen er
  eiga og negativet er målt i `security.test.ts`, att står statusforskjellen 409/201,
  som krev at idempotensnykelen blir per konto). Rate limiten (F-S6) er delt i Postgres og
  målt over to prosesser. Modereringsportene og injeksjonsisoleringen
  er fortsatt dekket av `core/tests/moderation.test.ts` og blokk 18–20 i
  `validate_invariants.sql`.
- **Mobil-E2E (NFR-01–NFR-12):** appen finnes og er kjørt for hånd på
  Android-emulator (`SFD_Verify`, Android 16) gjennom hele flyten — signering med
  dev-token, verdenliste, åpning, valg, ventende episode, pause og gjenopptak, sist
  gjentatt 2026-10-12 etter WCAG-fiksen med skjermbilde av hver rute (avsnittet over).
  Selve spillflyten over de elleve ruttene er nå automatisert i
  `core/tests/e2e.test.ts` (14 tilfeller, grønt 2026-10-12), men den tester
  tjeneren. Skjermene på enheten har sin egen automatiserte gang siden —
  `apps/mobile/scripts/device-walk.mjs`, 125/125 grønt ved 100 % og 130/130 ved 200 %
  tekst 2026-10-13 (raden i tabellen
  over) — så den manuelle gjennomgangen er erstattet, ikke bare supplert. NFR-12
  er kjørt 2026-10-12 i begge former (`core/scripts/loadtest.ts`, raden i tabellen
  over). I minnet: 1 000 økter med begrenset arbeidskø er grønt med GET p95 57 ms,
  men 1 000 *samtidige forespørsler* over én prosess gir p95 1 031 ms og river
  NFR-01 — skriptet melder FAILED på den formen, og metningen ligger på ~2 600
  req/s. Mot PostgreSQL med outbox-worker på banen: GET p95 46 ms og p75 fra commit
  til publisert prosa 3,7 s, begge innen budsjettene. Den andre av de to hele
  kjøringene endte likevel FAILED, av to grunner som nå eier hver sin historie:
  3 × HTTP 500 i verdenopprettingen, som ikke er reprodusert på 7 400 opprettinger
  etter at måleinstrumentet fikk feilteksten — og en episode som aldri ble skrevet,
  fordi en worker som dør mens den holder jobben, strandede den i `claimed`. Det
  sistnevnte er fikset og omkjørt grønt; det førstnevnte står igjen som den eneste
  500-en observert på denne banen, uten navn. p95- og p75-tallene E2E-filen skriver ut, er lokalt loopback mot
  minnelager; `pg.test.ts:736` og `:767` måler samme kø ett oppdrag om gangen. Alle
  kjøringene er én prosess på loopback, uten ekte modell, og ingen av dem er
  produksjonsbevis.
- **Mobil: resten av utgivelseslisten.** Release-build (debug-APK er det som er
  kjørt), skyve-varsler, betaling og eksport/sletting fra klienten.
  `npx expo start`-banen er ikke brukbar på denne maskinen: emulator-NAT-en
  mister byte på Metro-responsene sine, målt og dokumentert i README (avsnittet
  «Kjøring»); arbeidet går via `expo run:android` med innbygd produksjonsbundle.
- **Tilgjengelighet (NFR-07): målt, med to punkter igjen.** Kontrast, kantkontrast,
  trykktilstander, touch-mål og kontrollsemantikk er automatisk målt i
  `apps/mobile/src/lib/contrast.test.ts` og grønt 2026-10-13: 95 tekstpar (svakste
  5,82), 33 kanter (svakste `color.line` 3,59), 84 `Text`-elementer som alle
  sier hvordan de skalerer, og 17 kontroller som alle må tegne sin egen
  fokusring (SC 2.4.7). To av de 18 tilfellene måler bevegelse: den pustende
  statusprikken regnes i den mørkeste rammen av pusten (4,04 mot surface, 4,29 mot
  page), og UI10s «Reduced motion»-bryter må faktisk styre det som beveger seg — en
  feil som målt fram og fikset samme dag. Enhetsgangen måler i
  tillegg det levende treet: alle klikkbare noder på de tretten trærne den reviderer, har
  et eget navn og er minst 44 dp **etter rullbevis** (SC 2.4.3 og SC 2.1.1 målt
  2026-10-12 på alle tretten). Play-skjermen får i tillegg to geometriske sjekker på det
  som ligger *over* folden — episodeoverskrift og første prosavsnitt — og ei måling av
  døra som blir trykt, fordi de fire valgkortene ved 200 % tekst ikke står i det treet
  i det hele tatt, og 44 dp-regelen altså ikke ser dem der.
- **SC 2.1.1 er målt, og en tidligere påstand i denne fila var usann.** Den 12.
  oktober stod det her at treet ikke eksponerte *noen* `focusable="true"`-noder, så
  DPAD-navigering var umulig. Påstanden kom fra en måling som ikke leser attributten
  i det hele tatt: `dump()` i `apps/mobile/scripts/device-walk.mjs` parset den
  gangen bare class, text, desc, clickable og bounds. Med `focusable` og `focused`
  på plass måler gangen 125/125 ved 100 % og 130/130 ved 200 %, og på alle trærne er **hver eneste klikkbare
  node også focusable**. Tilleggsprøvet på UI09 sender `input keyevent 20`
  (DPAD_NED, målt — ikke antatt — som 20) og krever at `focused="true"` havner på en
  node i egen pakke: 12 focusable noder i det nyeste treet (mot fem i det gamle), og
  fokuset flytter seg. Igjenstår
  derfor bare: (1) ingen skjermlesertest — gangen leser hva treet inneholder og i
  hvilken orden, ikke hva TalkBack og VoiceOver *sier* (kunngjøringsformular, rolle
  og sammenslått gruppelesing); (2) iOS er ikke bygget, så §5.5-revisjonen på begge
  plattformer er bare halvparten dekket. Det som *ikke* lenger står igjen, er
  SC 1.4.4:
- **SC 1.4.4: chrome skalerer nå til 200 %, og det er målt på enheten.** Appen
  hadde `maxFontScale.chrome = 1,6` med den begrunnelsen at knappefeltet ellers
  gli av skjermen. Begrunnelsen holdt ikke for en gjennomgang av kilden: teksten
  som faktisk dominerte bredden i feltet (valgteksten i `cards.tsx`) var *ubundet*
  fra før, så kappen verken verget om noe eller var den eneste store teksten på
  skjermen. Kappen er satt til standardens eget tall (`theme.ts`: `chrome: 2`), og
  layouten som skulle til, er fikset i stedet: `Row` i `Button.tsx` har
  `flexWrap: 'wrap'`, valgbokstaven i `cards.tsx` er størrelsesbestemt av padding
  i stedet for en boks på 26×26, stedsvalget i `setup.tsx` har `minWidth: 132` i
  stedet for `width: 132` med `overflow: 'hidden'`, feltet nederst i `Screen` har
  `flexShrink: 0`, og handlingene i `ReportSheet.tsx` brytes likt. Målt: samme
  enhetsgang, **130/130** med `settings put system font_scale 2.0`
  (`docs/qa/evidence/device-walk/2026-10-13T14-48-25-166Z`) og **125/125** på 1,0
  (`…T14-32-49-700Z`). Dørene på play-skjermen henger ved 200 % tekst under folden,
  og gangen leser dem derfor på rull (raden i tabellen over). 44 dp-regelen er i
  tillegg bygget om til rullbevis, fordi
  ei klippet node ved 200 % rapporterer viewportens klipping og ikke størrelsen
  sin — alle node som måles for liten, rullles inn og måles på nytt, og alle
  tretten trærne er grøne på det. Den siste grensa som stod her, er lukket:
  velkomstlinja skrev tidligere tjeneradressen (`18+ · http://10.0.2.2:3000`) som
  ett token, og React Native 0.86 har ikke `wordBreak`, så et vertsnavn over ~26
  tegn ble klippet ved 200 %. UI01 skiller nå på de tre opplysningene som lå i den
  linja — `Not signed in`, `18+ only` og adressen — som hver sin `Chip` i en
  brekkende rad, så adressen får sin egen linje og sine egne hjørner. Skjermbildet
  fra 200 %-kjøringa viser hele `http://10.0.2.2:3100` uten klipp.
- **Kjernefix: `story_arcs` lekket på tvers av verdener.** Arc-id-ene kommer fra
  regelverkstemplaten, men tabellen hadde `id TEXT PRIMARY KEY` fra 003 — altså én
  global rad per arc for hele databasen — og `pgStore` skrev dem med
  `on conflict (id)`. Verden to overskrev verden en, og hver-create låste seg mot
  de tre felles radene. Nøkkelen er samlet i `arcKey(worldId, arcId)`
  (`core/src/store.ts:116`, brukt i `engine.ts:342` og `pgStore.ts:168`), oppserten
  er `on conflict (world_id, id)` (`pgStore.ts:413`), og migrasjon 011 gjør
  primærnøkkelen sammensatt og gjenoppbygger projeksjonen per verden fra det siste
  snapshotet. Målt: `keeps every world-bound row inside its own world` i
  `core/tests/pg.test.ts` krever 3 + 3 rader og 6 ulike nøkler i `Store.arcs`, og
  falsifisert ved å reversere lastenykkelen (da: `expected 3 to be 6`). På
  dev-skjemaet kom `arc_staff_security` tilbake som `open` mens malen sier `locked`
  — bevis for at gjenoppbyggingen leser verden selv, ikke templaten.
- **Enhetsgangen fant ett avvik kilden ikke viste.** Radhodet i UI09 er to
  tekster i en `Pressable` uten egen høyde, og ble 126 px høyt på enhetens
  tetthet — 42 dp, under appens eget touch-mål på 44. `styles.head` i
  `history/[worldId].tsx` har nå `minHeight: touchTarget` og sentrerer innholdet;
  treet måler 132 px etterpå, og gangen har vært grønn siden — sist 125/125 ved 100 %
  og 130/130 ved 200 % målt 2026-10-13 (`docs/qa/evidence/device-walk/2026-10-13T14-48-25-166Z`).
- **Play-skjermen viste en episode som ikke var der.** `world/[worldId].tsx` holdt
  de fire valgkortene og de seks sekundærknappene i `footer`-feltet til `Screen`, og
  Yoga gir det faste foten sin naturlige høyde og ScrollViewen resten: målt i
  `docs/qa/evidence/device-walk/2026-10-12T17-46-33-877Z/UI04 world.xml` tok foten
  1 831 av skjermens 2 992 px, og prosanoden kom tilbake som
  `bounds="[48,1307][1296,1161]"` — et snudd bounds, altså null pixels — mens sjekken
  «offers prose» stod grønn, fordi den lette etter teksten og ikke etter der teksten
  lå. Valgkortene er flyttet inn i leseflaten sammen med prosaen, og foten holder bare
  de seks sekundærhandlingene (612 px ved 100 % tekst, 697 px ved 200 %); skjermen er
  målt og lest av bildet etter endringen, og gangen krever nå at overskrift og første
  prosavsnitt ligger innenfor første viewport. Det er geometrien som skiller ei
  klippet linje fra en synlig, så det er geometrien som blir påstått.
- **Fargesystemet fikk ett nytt token i den anledning.** `color.line` (#66789C)
  har erstattet `color.raised` på kantene som markerte inndatafelt den gang (13),
  fordi en kant som markerer et inndatafelt må måle 3:1 (SC 1.4.11) og `raised`
  målte 1,23. Kontrastsuiten måler i dag 33 `border*Color`-tokens, og tokenet
  brukes nå også av HUD-panelet (se punktet om HUD-språket). Det er en synlig
  endring på tvers av skjermene — reversibel ved å endre én linje i
  `theme.ts`, men da faller kanttesten igjen. `raised` er beholdt som fyll.
- **Dokumentert drift er lukket og testet (2026-10-12).** En episode som lå i køen
  mens verden gikk videre, ble narrert fra nyeste snapshot: `generateEpisode` leste
  `allowedChoiceIds` gjennom `currentChoices`, som henter fra `latestSnapshot`, og
  faktakunnskap og worldtime fra samme hodet. Målt i `worker.test.ts`: ett valg som
  åpner et nytt tilbud (`open_negotiation` → `reject_sale`) ga episode 1 — som står
  med `worldStateVersion` 1 — det tilbudet som først eksisterer i versjon 2. Retten:
  `Store.snapshotAt(worldId, version)` (hver versjon er egen rad i den uforanderlige
  `world_snapshots`), `Engine.choicesAt` som regner tilbud fra snapshoten sin, og
  `generateEpisode` som nå leser alt ved episodeversjonen. `currentChoices` er
  `choicesAt` ved hodet, så `GET world` er uendret. Testen binder begge ender:
  episode 1 får versjon 1s fire tilbud og fakta, episode 2 får `reject_sale` og
  `fact_exclusivity_demand`.

Merk: masterdokumentets D1/D7/D30-tall og responsmål er **prosjektkrav**, ikke
dokumentert ytelse. QA rapporterer målte tall først når de finnes.
