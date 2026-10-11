# PunkGrid — Reality Engine core (Sprint 1)

**Status:** Kanonisk kjerne er bygget og testet. Ingen generativ AI, ingen
tilkoblet database, ingen mobilapp ennå.

PunkGrid er en vedvarende interaktiv simulering, ikke en chatbot med lang
minne. Valg blir gyldige, lagrede domenehendelser; tekst beskriver dem, endrer
dem ikke. Denne repo-rotens kode er den deterministiske motoren som håndhever
det: `docs/product/PUNKGRID_PREDEVELOPMENT_MASTER_v1.0.md` styrer produktomfang,
`docs/architecture/REALITY_ENGINE_CORE_CONTRACT_v1.0.md` er normativ for
simuleringsinvarianter, API og goldentester. Avvik logges i
`docs/architecture/adr/`.

## Kjøring

Krever Node ≥ 22.6 (utviklet på v24.14.0) og npm. Null runtime-avhengigheter.

```powershell
cd "C:\Users\Rune W. Monrad\CascadeProjects\PunkGrid"
npm install
npm run typecheck
npm test
npm run seed
```

`npm test` kjører 37 tester: goldensettet T01–T20 fra Contract §13 pluss
invariant- og HTTP-boundary-tester. `npm run seed` bygger til `dist/` og spiller
opp referanseverdenen *The Glass Harbor* (Contract §12) gjennom den faktiske
APIen: verdenskapitel, fire åpningvalg, én surprise, ett bounded catch-up-resume,
deretter skriver den fullstendige hendelsesloggen per type, `state_hash` og
replay-verifisering. Samme seed gir samme hash — replay er beviset, ikke
formålserklæringen. Sluttresultatet er forankret som en golden hash
(`core/scripts/seed-glass-harbor.ts:120`: `sha256:ba95bdda…356247`, 28 hendelser,
versjon 7), og `npm run seed` avslutter med exit 1 ved drift. Begge veier er
sjekket: lik hash gir exit 0, en endret hash gir `DRIFT` og exit 1.

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
| `core/src/engine.ts` | Kommandorør (idempotens, optimistisk versjonslås, ett skriverpunkt per commit), genesis, klokker, surprisemotor, POV-filter, budsjett |
| `core/src/api.ts` | De ti normative `/v1`-ruttene (§11), rammeverksuavhengig |
| `core/src/providers.ts` | Testprovider: compliant, timeout, kast, lekkasje, valg-inventor, policy-blokkert |
| `core/tests/` | `golden.test.ts` (T01–T20 + 10 invariant), `api.test.ts` (7 transporttester), `helpers.ts` |
| `core/scripts/seed-glass-harbor.ts` | Kjørbar seed og determinismarapport |
| `docs/architecture/migrations/` | SQL for §3-modellen (8 filer + README + `validate_invariants.sql`). Kjørt og verifisert mot PostgreSQL 16, ikke mot skyen |
| `docs/architecture/adr/` | ADR-011–015 pluss indeks for ADR-001–010 |

## Grenser som er håndhevet i koden

- Hendelser er append-only; `world_seq` +1 per hendelse, `worlds.version` +1 per
  kommandobatch; snapshot nøkles på (world, version) og verifiseres mot replay.
- Kommandoer er idempotente: lik kropp gir lagret resultat, lik idempotennøkkel
  med ulik kropp gir `IDEMPOTENCY_PAYLOAD_MISMATCH`, utdatert versjon gir
  `WORLD_VERSION_CONFLICT` med `currentVersion`.
- Narrasjon AI har ingen write-vei: episodeprosakvalitet avgjør
  `published`/`fallback`, men kanonisk state er uendret av en forkastet episode
  (T13, T18).
- Fakta filtreres per karakter-POV; hemmeligheter krever `fact.disclosed` (T14).
- Surprise har cooldown, causal hook og budsjett; ingen gyldig kandidat gir
  `no_op: NO_ELIGIBLE_SURPRISE` (T15, T16).
- Fri verdenskvote håndheves atomisk i `world.create` (ADR-012) og ukjente
  kommando-/hendelsestyper forkastes (V1 MUST).

## Hva som ikke er gjort ennå

- **Ingen database i kjernen.** SQL-skjemaet er skrevet, kjørt og negativtestet
  mot lokal PostgreSQL 16 (`docs/architecture/migrations/README.md`), men
  motoren kjører fortsatt mot minnelageret i `core/src/store.ts`: en
  Postgres-adapter som implementerer samme `Store`-port er neste sprint.
  Provisionering av Supabase er ikke gjort — det koster penger og endrer
  tilstand, og er bedt om godkjent først.
- **Ingen ekte narrasjon.** `providers.ts` er deterministiske test-stand-ins;
  provider-adapter, prompt-versjonering og moderering er Sprint 3 (P2).
- **Ingen mobilapp**, ingen varsler, ingen betaling, ingen eksport/sletting
  (F15 venter på ADR-014s juridiske gate).
- `docs/ux` og `docs/qa` inneholder så langt bare statusnotatene sine:
  Sprint 0-leveransene (klikkbar prototype, intervjuer, event-dictionary,
  testplan) er ikke startet.
