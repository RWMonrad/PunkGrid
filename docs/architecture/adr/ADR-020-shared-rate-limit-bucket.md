# ADR-020 — rate limit-bøtten legges i PostgreSQL og deles på tvers av prosesser

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-12 som en endring av ADR-016 §5, etter funnet F-S6 i
`docs/qa/SECURITY.md`.

## Kontekst

ADR-016 §5 valgte en token bucket i prosessens minne, kjørt to ganger per
forespørsel: `ip:<adresse>` før autentisering og `actor.userId` etter. Det
valget holdt for én prosess. Sprint 6 målte hva det gjør med flere:

* Kvoten er per instans. Med N API-prosesser bak samme edge bruker én konto
  kvoten sin N ganger.
* «Adressen» er socketens peer. Bak en lastbalanser er det balanserens egen
  adresse, altså én felles anonymbøtte for alle kunder — og en forfalsket
  `x-forwarded-for` fra klienten kunne ikke skilles fra en ekte proxy.

Med andre ord: den delen av vakten som skal verne *kontoen*, var ikke delt, og
den delen som skal verne *serveren*, var låst til en adresse som ikke betyr noe
i en utplassering. Begge deler er i `docs/qa/SECURITY.md` F-S6.

Prosjektet har allerede én kilde til sanntid som alle prosesser er enige om:
PostgreSQL. ADR-001 sier at databasen er autoritativ, ADR-006 binder hver
kommando til én transaksjon, og `commands`/`outbox_jobs` er fra før tabeller
handleren skriver til.

## Beslutning

1. **Kontokvoten deles i databasen, og hele take'et gjøres i SQL.** Migrasjon
   `010_rate_limit.sql` gir én rad per bøttenøkkel
   (`rate_limit_bucket`) og én funksjon, `punkgrid_rate_limit_take(nøkkel,
   kapasitet, refill_per_minute)`, som gjør hele take'et i ett kall: `INSERT …
   ON CONFLICT DO NOTHING`, `SELECT … FOR UPDATE`, påfylling, forbruk, oppdater
   av raden. Ett round trip per autentisert forespørsel, ikke tre, og
   radlåsen er det som gjør to samtidige take om til én avgjørelse.
2. **Klokka er databasens.** Alle stempler i funksjonen kommer fra
   `statement_timestamp()`, lest én gang inn i en variabel per kall. Å la
   JavaScript sende inn medgått tid, eller bruke `now()`, ville gjeninnføre
   akkurat den uenigheten delingen finnes for å fjerne: to instanser med skjev
   klokke blir enige om påfyllingen fordi ingen av dem eier klokka. (`now()` er
   transaksjonstidspunktet og fryses av en bred transaksjon;
   `statement_timestamp()` er utsagnets.)
3. **Grantene er grensen, ikke funksjonen.** Funksjonen er erklært *uten*
   `SECURITY DEFINER` (målt som `prosecdef = f`) og med `SET search_path =
   punkgrid, public`. `punkgrid_app` får `arw` på tabellen — verken `D` eller
   `T` — og ingen annen kjørebane enn funksjonen behøver å skrive den.
   `CHECK (tokens >= 0)` og `bucket_never_exceeds_capacity` er derfor
   håndhevelsen der grantene med vilje tillater UPDATE. Row-level security er
   skrudd av: tabellen navngir ingen verden, så det finnes ingen å være medlem
   av.
4. **Anonymbøtta blir værende i prosessen.** Dette er en beslutning, ikke en
   mangel. En uautentisert forespørsel som i tillegg skriver en database-rad,
   gjør vakten selv til et misbruksmål: angriperen får bestilt den dyreste
   jobben i systemet for prisen av en billig forespørsel. Den øvre cardinaliteten
   er bundet av antall distinkte
   adresser som kobler seg til, og det er `idleTtlMs` i `TokenBucket` som
   begrenser den.
5. **`x-forwarded-for` leses bare når utplasseringen sier det, og da som siste
   ledd.** `PUNKGRID_TRUST_PROXY=1` er standard av. Når den er på, tar
   `peerAddress()` det *siste* gyldige leddet i rekken: proxyen vår legger til
   hoppen den selv så, så et klientforfalsket `203.0.113.9` havner foran i
   listen og blir sett bort fra. Ugyldig eller manglende header faller tilbake
   på socketadressen. Verdien må opfylle `/^[\da-fA-F:.]{1,45}$/`.
6. **En feilet rundtur er en feil, ikke en frikjenning.** `PgTokenBucket`
   har ingen fail-open-vei: feiler `pool.query`, eller funksjonen gir ingen rad,
   kastes feilen til adapteren, som svarer 500 `INTERNAL_ERROR`. Å la en
   databasetur bety «gi fri kvote når vi er i tvil» ville gjort vakten
   avhengig av nettopp den komponenten den skal beskytte mot.
7. **Politikken gjentas i hvert kall.** `capacity` og `refill_per_minute`
   sendes inn hver gang og skrives tilbake på raden, så en endret config
   treffer eksisterende bøtter uten en migrasjon eller en cleanup-jobb. En
   krympet kapasitet blir ikke brukbar: påfyllingen er `least(capacity, …)`.

## Konsekvens

* Ét svar per konto, uavhengig av instansantall. Målt i `core/tests/pg.test.ts`
  (blokk «shared rate limit», `:874`): to `buildApp`-instanser med egen pool
  mot én database gir 6 tillatte take av 10 forsøk; 12 samtidige take gir
  fortsatt 6; den delte bøtta og `TokenBucket` tar samme avgjørelse i samme
  rekkefølge; kapasitet 8 → 1 gir ett take og nektet neste.
* Prisen er én rundtur per autentisert forespørsel: målt p50 1,7–1,8 ms og max
  12,4–13,5 ms mot lokal PostgreSQL 16 over fire kjøringer 2026-10-12, skrevet
  til stdout av `pg.test.ts:1075`. Anonymene betaler ingenting, fordi de ikke når
  databasen.
* Hva den runden koster lesetiden i den utplasserte formen, er målt i egen test
  (`pg.test.ts:736`): 30 GET over de tre verdenrutene med Postgres-kanon, worker
  og delt bøtte på banen gir p50 12,5–14,4 ms og p95 15,3–18,9 ms over fire
  kjøringer 2026-10-12, mot p50 0,7 og p95 1,8–2,6 ms for samme flyt i minnet
  (`core/tests/e2e.test.ts`). Begge er innenfor NFR-01 (p95 < 500 ms), og
  differansen er bøtta og enhetsarbeidet — to rundturer per autentisert
  forespørsel.
* `TokenBucket` og `PgTokenBucket` implementerer samme `RateLimiter`-grensesnitt,
  og `http.ts` tar imot et `Limiters`-objekt med `addresses` og `accounts` i
  stedet for én bucket. Minneversjonen brukes fortsatt når `dbUrl` er fraværende —
  testene og
  den raske demoen går samme vei som prod, bare med begge vakter i samme
  prosess.
* Tabellen vokser med antall kontoer som har tatt en bøtte, altså bundet av
  antall registrerte kontoer. Det finnes ingen TTL-fjerning ennå, og den trengs
  først hvis nøkkelen blir noe annet enn en konto-id.
* ADR-016 §5 og «åpne pointer»-listen der er erstattet på dette punktet: delt
  rate limiting er ikke lenger åpen jobb. Gjenstår er å måle ordningen mot en
  ekte lastbalanser i stedet for to instanser i en testprosess.

## Berørte filer

`docs/architecture/migrations/010_rate_limit.sql`,
`core/src/server/rateLimit.ts`, `core/src/server/pgRateLimit.ts`,
`core/src/server/http.ts`, `core/src/server/app.ts`, `core/src/db/schema.ts`,
`core/scripts/serve.ts`, `core/tests/security.test.ts`, `core/tests/pg.test.ts`,
`docs/qa/SECURITY.md`, `docs/qa/STATUS.md`,
`docs/architecture/migrations/README.md`, `README.md`.
