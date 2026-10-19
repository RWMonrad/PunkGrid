# ADR-021 — frøet per prosess er en trekning, og et verdenhodet fås bare av eieren sin

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-12 da 500-en på `POST /v1/worlds` fra NFR-12-målingen
(`docs/qa/STATUS.md`, raden «Kapasitet (NFR-12)») ble reprodusert på forlangende.

## Kontekst

`makeIdFactory(seed)` (`core/src/domain.ts:177`) er en ren funksjon av frøet. Det
er ikke en bikommentar: deterministiske id-er er det gullhashen i §13 og
replay-verifiseringen er bygd på, og `npm run seed` er meningsløs uten at samme
frø gir samme hendelses- og episode-ider.

ADR-016 la inn `AppConfig.seed` med regelen «en prosess skal ikke gjenbruke et
tidligere prosessfrø mot en database som fortsatt har radene», men sa ikke hva
defaultet skal være. Startscriptene brukte klokka — `Date.now()`-uttrykk i
`serve.ts`, `worker.ts` og `loadtest.ts`. To prosesser som startet i samme
millisecond, delte dermed hele id-rommet: samme `worldId` på sitt første mynt og
samme `identityId` på det andre, fordi `registerUser` ikke mynter noe, og en
ekte kalder oppgir sin egen idempoternøkkel (`engine.ts:260`).

Det første angrepet på problemet var måling, ikke kode: sju laster mot
`punkgrid_nfr12`, 7 400 verdenopprettinger, også i to parallelle prosesser, ga
ingen 5xx. Det målte bare at løpet er sjeldent. Reproduksjonen er nå målt i
`core/tests/pg.test.ts:330`: to `Sessions`-objekter med samme frø ga den andre
`POST /v1/worlds`-en

```
duplicate key value violates unique constraint "world_memberships_world_id_identity_id_key"
```

— ordrett den 500-en lasttesten hadde stått uten navn på. Verdenhodet var da
allerede skrevet om av `insert … on conflict (id) do update` (status, worldtime,
versjon, sekvens), og `identities`-upserten (`pgStore.ts:292-296`, som ligger
*foran* verdenhodet) hadde skrevet over den første verdens identitetsprofil.
Det som reddet radene, var rulleringen — ikke noe vern i selve skrivet.

## Beslutning

1. **`defaultSeed()` er en trekning** (`core/src/domain.ts:173`): 32 bit fra
   `randomBytes`, ikke klokka. Kjøremønsteret er ellers uendret — `PUNKGRID_SEED`
   (`serve.ts:41`, `worker.ts:30`) og `--seed=` (`loadtest.ts:95`) gir fortsatt et
   reproducibelt løp, og `AppConfig.seed`-regelen står ved lag. Et frø som må
   velges for å gjenskape en kjøring, skal ikke være noe to prosesser tilfeldig
   får tak i på hver sin.
2. **Verdenhodet fås bare av eieren sin.** Upsetten i `saveWorld`
   (`pgStore.ts:317-329`) fikk `where worlds.owner_user_id = excluded.owner_user_id`,
   og `rowCount === 0` er en feil med id-en i tekstet
   (`world <id> is already claimed by another owner`). En lånt id stopper der, før
   noen tabell nedenfor får en skriver — altså før `world_memberships`, `characters`
   og ledger. Eierkolonnen inngår ikke i `do update set`: en verdenrad skifter aldri
   eier, verken ved kollisjon eller ved gjenbruk.
3. **En rullering skal ikke overskygge årsaken.** `unit()`s catch
   (`pgStore.ts:65-76`) gjør ROLLBACK best effort og kaster den opprinnelige
   feilen videre. En forbindelse som allerede er borte, får ellers ROLLBACK-rejectet
   sitt til å bli det som når loggen, som var nettopp mekanismen som gjorde de
   tre 500-ene navnløse.
4. **SQLSTATE med i loggen.** `crash()` (`core/src/server/http.ts:196-202`)
   skriver `[SQLSTATE <kode>]` når unntaket har en. `String(error)` mister
   node-postgres sin `.code`, og 23505 er forskjellen på «en id kolliderte» og
   «noe gikk galt». Detaljen går ikke til klienten — §15 forbyr å lekke
   lagerinterne opplysninger.
5. **Feilen blir en 500, ikke en §11-kode.** De sytten kodene i
   `core/src/errors.ts:3-21` er en lukket mengde, og en integritetsfeil i lageret
   er verken klientens feil eller motorens beslutning. `INTERNAL_ERROR` er
   adapterens eget ledd, dokumentert som noe ingen vei gjennom motoren produserer.

## Konsekvens

* Reproduksjonen er blitt en test, ikke en hendelse: `pg.test.ts:330` spiller to
  prosesser med samme frø og påstår feilmeldingen med id-en i. Falsifisert ved å
  fjerne eierleddet — da gikk tilfellet rødt på den opprinnelige
  `duplicate key value violates unique constraint`-meldingen, altså måler testen
  vaktbikkja og ikke bare utfallet.
* Kollisjonen er fortsatt mulig, bare usannsynlig. Trekningen er 32 bit, så to
  prosesser kan få samme frø — bursdagsparadokset gir først reell sannsynlighet i
  hundrevis av prosesser, men det er ikke null. Det er grunnen til at ledd 2
  finnes i stedet for ledd 1 alene: trekningen gjør kollisjonen usannsynlig,
  eiervernet gjør den synlig.
* En klient som kolliderer, får 500 `INTERNAL_ERROR` og en logglinje med navnet på
  verdenen. Det er ikke et svar en spiller kan handle på, men det er det svaret en
  operatør trenger.
* ADR-016s åpne pointer «ULID-kilde på tvers av prosesser» er løst på det
  punktet som gjaldt: id-ene genereres fortsatt per prosess, men de er ikke
  lenger forutsigbare for hverandre, og en kollisjon blir nektet i stedet for
  skrevet. En felles ULID-kilde (eller `gen_random_uuid()` i databasen) er ikke
  lenger nødvendig for riktighet, bare for komfort.
* Målt etter endringen: `npm run typecheck` og `npm run build` grøne, 244 passed
  | 25 skipped uten database og 269 passed med (`core/tests/pg.test.ts` 26).

## Berørte filer

`core/src/domain.ts`, `core/scripts/serve.ts`, `core/scripts/worker.ts`,
`core/scripts/loadtest.ts`, `core/src/db/pgStore.ts`, `core/src/server/http.ts`,
`core/tests/golden.test.ts`, `core/tests/pg.test.ts`,
`docs/architecture/adr/ADR-016-http-adapter-and-dev-auth.md`,
`docs/qa/STATUS.md`.
