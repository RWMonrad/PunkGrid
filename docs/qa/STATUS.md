# docs/qa — status (Sprint 1)

Katalogen er opprettet per Master §9.1 steg 1. Testplan og eval-rapporter
skriver vi her etter hvert som de eksisterer.

## Det som allerede finnes og kjører

| Sett | Fil | Innhold |
|---|---|---|
| Goldensett T01–T20 | `core/tests/golden.test.ts` | Ett tilfelle per Contract-ID, med de normative tallene fra §13 (T04 trust 70→58, T05 influence 60→50, T06 credibility 45 osv.) |
| Invarianter | `core/tests/golden.test.ts` (blokk «Canonical invariants beyond the twenty scenarios») | 10 tilfeller: kvote, ukjent hendelsestype, inventerte valg-ider, policy-block, budsjettstopp, transportfeil, pause/resume, valg never issued, versjon per batch, tre ur |
| HTTP-boundary | `core/tests/api.test.ts` | 7 tilfeller: 201/202, 401, 400, 403/404-lekkasjebasert leseatferd, 409 med `currentVersion`, `WORLD_LIMIT_REACHED`, normative ruter uten flere |
| SQL-invarianter | `docs/architecture/migrations/validate_invariants.sql` | 16 negative blokker + RLS-positiver mot PostgreSQL 16: 21 `ok`-meldinger, transaksjonen rullerer tilbake |

Kjør med `npm test` (37 tester, alle grønte 2026-10-11). SQL-settet kjøres
separat mot en database; sjekk `docs/architecture/migrations/README.md` for
kommando og kjørt dato.

## Gjenstår for QA

- **Databasetester (§14) mot den utplasserte databasen:** de 16 negative
  blokkene og RLS-positivene er kjørt mot lokal PostgreSQL 16, men ennå ikke
  mot Supabase med ekte tilkoblingspool, `service_role`-roller og
  `authenticated`-grants.
- **Replay-rapport som lagret artefakt:** `npm run seed` har en golden hash
  (`core/scripts/seed-glass-harbor.ts:120`) og avslutter med exit 1 ved drift,
  så kommandoen er en CI-kjørbar sjekk. En lagret pr. commit-rapport (fil i
  repo eller artefakt i pipeline) er ikke satt opp ennå.
- **FR-19:** interne kvalitetsevalueringer per prompt/regel i CI — krever
  genuine narrasjonsmodeller (Sprint 3, P2).
- **Sikkerhetsnegativ (§14/§15):** prompt-injeksjon fra bruker- og
  historietekst, modererings-testsett, tverrbruker-pen-test.
- **Mobil-E2E (NFR-01–NFR-12):** app eksisterer ikke ennå, så p95/p75-målene er
  ikke målt. Ingen tall i denne omgang er målt mot produksjon.
- **Tilgjengelighet (NFR-07):** WCAG 2.2 AA-revisjon på begge plattformer.

Merk: masterdokumentets D1/D7/D30-tall og responsmål er **prosjektkrav**, ikke
dokumentert ytelse. QA rapporterer målte tall først når de finnes.
