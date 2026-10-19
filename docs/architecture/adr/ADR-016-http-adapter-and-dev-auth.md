# ADR-016 — node:http-adapter, transportvokabular og dev-autentiseringsport

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-12 som implementeringskrav til Sprint 2–3 (server, auth,
worker).

## Kontekst

Contract §11 beskriver API-et som en kontrakt: ti ruter under `/v1`,
bærertoken, `Idempotency-Key`, `X-Request-ID` og et lukket feilvokabular av 17
koder. ADR-011 sa at rammeverket er NestJS. Implementasjonen har i dag et
rammeverksuavhengig `Api`-objekt (`core/src/api.ts`) som tar en `ApiRequest` og
gir et `ApiResponse`, og så møtte vi virkeligheten: sikkerhetstesten (Sprint 6),
emulatorutviklingen (Sprint 4–5) og outbox-workeren må kjøre mot *akkurat den
samme* wiringen som prod bruker, og den må starte på én kommando uten et
bygg-rammeverk i mellom.

To avvik viste seg på veien, og begge må stå her før de står i koden:

1. **Rammeverket.** NestJS legger til moduler, decorators og en DI-container
   som ingenting i §11 krever. Alt serveren faktisk trenger er en socket, en
   grense for kroppsstørrelse og en oversetter mellom HTTP og `ApiRequest`.
2. **`actorIdentityId`.** §11 krever at hver mutasjon navngir den utførende
   identiteten, men ingen av de ti normative rutene gir klienten verdien. Den
   eneste måten en klient kunne få tak i den på var å gjette — noe som gjør
   hele skrivestien ubrukbar.

## Beslutning

1. **node:http-adapter, ikke NestJS.** `core/src/server/http.ts` er den eneste
   filen som kjenner sockets. `Api` forblir rammeverksuavhengig, så en
   Nest/Fastify-adapter kan byttes inn uten å endre §11-semantikken, rutene
   eller testene. Avviket fra ADR-011 er bevisst og reversibelt: det er én fil,
   ikke en arkitektur.
2. **Transportfeil får transportens vokabular, ikke motorens.** §11 har ikke
   koder for metode- eller kroppssvikt, så adapteren mapper dem over på det
   eksisterende `INVALID_SCHEMA`-svaret med riktig HTTP-status: 405
   method-not-allowed, 413 payload-for-too-large (`details.limitBytes`) og 429
   `RATE_LIMITED` med `retry-after`. `INTERNAL_ERROR` er en kode **utenfor** de
   17 i §11, og den produseres bare av adapteren — ingen motorevei gir den.
   Ukjente feil logges via `onUnhandled`, og svaret er det faste
   `{code:'INTERNAL_ERROR', message:'Request failed'}`: ingen intern melding,
   stack eller SQL forlater socketen.
3. **To ruter utenfor `/v1`, begge bevisst unormative.** `/healthz`
   (levetest, ingen actor, ingen `requestId` i kroppen) og `/dev/token`
   (dev-innlogging). `/dev/token` er **slått av som default**: den finnes bare
   når prosessen er konfigurert med en `devUserIds`-allowlist, ellers svarer 404
   NOT_FOUND. Alt annet enn de ti §11-rutene under `/v1` svarer 404, ikke 405 —
   serveren skal ikke avsløre hvilke ressurser som finnes.
4. **`AuthPort` er skillepunktet, `HmacDevAuth` er en midlertidig
   implementasjon.** Dev-porten signer `pgd1.<base64url(payload)>.<base64url(hmac-sha256)>`
   med `timingSafeEqual`, hemmelig nøkkel på minst 32 tegn og 12 timers
   levetid (med 60 s klokkespilltoleranse). Den erstatter Supabase Auth/JWT kun
   til den virkelige integrasjonen eksisterer; veien dit er å implementere en ny
   `AuthPort`, ikke å endre noe i adapteren eller `Api`.
5. **Rate limiting er per prosess og todelt.** Token bucket (`capacity` 30,
   `refillPerMinute` 30) kjøres to ganger per request: `ip:<adresse>` før
   autentisering, `actor.userId` etter. Da kan ikke en uautorisert klient tømme
   en kontos kvote, og ikke kan én konto tømme hele prosessen. Delt limiting på
   tvers av prosesser/edges er åpen jobb — bucket-en er minnelager, og det står
   i filens hodekommentar.
   *(Avsnittet ble skrevet før Sprint 6. Delen om delt limiting er erstattet av
   ADR-020: kontokvoten tas i `punkgrid_rate_limit_take()` mot PostgreSQL, mens
   anonymbøtta av beslutning er værende i prosessen. De to vaktene er i dag
   hver sitt felt, `Limiters = { addresses, accounts }`.)*
6. **`identityId` legges til i svaret fra `GET /v1/worlds/{id}` og i
   `GET /v1/worlds`-listene.** Verdien er alltid bare den innloggede brukerens
   eget identitetsspor i den verdenen. Den er ikke en autorisasjonsrettighet,
   og motoren verifiserer den likevel på hver mutasjon (`assertActorIdentity` →
   403 for ukjent eller lånt identitet). Beslutningen flytter ingen
   autorisasjonsbeslutning til klienten, noe §11 uttrykkelig forbyr:
   `actorUserId` og verdenseier tas fortsatt utelukkende fra tokenet. Avviket er
   dokumentert her fordi §11-eksemplet ikke viser feltet.
7. **Outbox-hydrering tar med `claimed` jobber.** Workeren claimer en jobbrad
   (status → `claimed`) *før* den hydrerer aggregatet. Siden read-modellen bare
   hentet `status = 'pending'`, flushet workeren en tom outbox, markerte jobben
   fullført og lot episoden bli liggende som `pending` for alltid.
   Integrasjonstesten i `core/tests/pg.test.ts` fanget dette. Regelen er nå at
   enhetsarbeidet som holder verdens advisory-lås eier alle åpne jobber for den
   verdenen.

## Konsekvens

- `npm run serve` (API), `npm run worker` (drain), `npm run token` (dev-token)
  og `npm run migrate` starter de samme objektene som testene kjører:
  `buildApp` bestemmer wiringen, og `PUNKGRID_DB_URL` velger hvor kanon bor.
  Utan database skjer narrasjonen i samme prosess (`autoFlush`); med database er
  hver kommando en transaksjon og narrasjonen workerens jobb (ADR-006).
- Testbare overflater ble flyttet: transport-spørsmål (autentisering,
  kroppsgrenser, request-id og statuskodene klienten forgreiner på) testes nå
  over ekte sockets i `core/tests/server.test.ts`, og 202-deretter-poller-flyten
  testes mot PostgreSQL i `core/tests/pg.test.ts`. `core/tests/api.test.ts`
  står igjen for routing, idempotens og versjonssemantikk.
- Feilventningene er verdt å huske: en lånt eller oppfunnet `actorIdentityId` er
  **403 WORLD_ACCESS_DENIED**, ikke 422 — det er en autorisasjonsfeil, ikke en
  regel-forhåndsbetingelse.
- Åpne pointer, hver for seg registrert som ikke-arbeid: Supabase Auth/JWT
  (erstatter `HmacDevAuth`), ULID-kilde på tvers av
  prosesser (i dag `makeIdFactory(seed)` per prosess), CORS (trengs ikke for RN
  på emulator), og at en episode fra en gammel versjon publiserer
  `allowedChoiceIds` fra nyeste snapshot (kosmetisk — klienten leser valgene fra
  `GET world`; se `Engine.generateEpisode`). Delt rate limiting sto også her til
  ADR-020 tok den, og id-kilden på tvers av prosesser sto her til ADR-021 tok
  den.

## Berørte filer

`core/src/api.ts`, `core/src/errors.ts`, `core/src/engine.ts`,
`core/src/server/http.ts`, `core/src/server/auth.ts`,
`core/src/server/rateLimit.ts`, `core/src/server/runner.ts`,
`core/src/server/worker.ts`, `core/src/server/app.ts`,
`core/src/db/session.ts`, `core/src/db/pgStore.ts`,
`core/scripts/serve.ts`, `core/scripts/worker.ts`, `core/scripts/token.ts`,
`core/tests/server.test.ts`, `core/tests/worker.test.ts`,
`core/tests/pg.test.ts`.
