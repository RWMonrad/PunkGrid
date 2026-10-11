# ADR-015 — Avledde projeksjonstabeller i det kanoniske skjemaet

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet
(Rune W. Monrad gir tekniske valg som begrunnes fra kvalitet, men designvalg,
commits og nøkler beholder han). Registrert 2026-10-11 som implementeringskrav
til Sprint 1-migrasjonene.

## Kontekst

Contract §3 lister 18 tabeller, men to konsept er bare modellert i §6 som
*felt i `WorldState`*:

- **Fakta** (§2: «Fact: a canonical assertion with source-event provenance and
  visibility», §9: «Each fact MUST have provenance and visibility»). §3 har
  `character_knowledge.fact_id`, men ingen tabell fact-id-en kan referere til.
- **Tilbudte valg** (§11: «`choiceId` must be server-issued, bound to world and
  version, and unexpired», Master FR-04). §3 har ingen tabell som binder et
  valg til en verden og en versjon.

I minnelageret løses dette av `Store.facts` og `Store.offeredChoices`. Uten
motsvarigheter i SQL måtte hver lesing og all narrativvalidering folder hele
hendelseslogg for å finne faktetiketter, og «server-issued choice» kunne ikke
håndheves i databasen i det hele tatt.

## Beslutning

1. `world_facts` og `offered_choices` opprettes som **avledde projeksjoner**,
   ikke autoritative kilder. Den eneste autoritative representasjonen av en
   fakta er `fact.created`-/`fact.disclosed`-hendelsen, og tilbudte valg
   projiseres fra `choice.resolved`-payloaden (`opensChoices`) og flagg i
   `WorldState`. Begge tabellene skrives bare av reduceren i samme transaksjon
   som hendelsen (§6) og kan gjenoppbygges fra ledger ved replay.
2. `world_facts` får kolonnen `sensitive_phrase`. Det er en **prosemarkør**
   narrativvalidereren (`core/src/narrative.ts`) ser etter for å forkaste en
   episode som lekker en hemmelighet (goldentest T13). Den vises aldri for
   klienten.
3. `offered_choices` binder `bound_version` per (world_id, choice_id), slik at
   FR-04-avvisningen har et dataromlagt svar. Verdensnøkkelen gir dessuten
   T11-isolasjon: et valg-id fra en annen verden finnes ikke i denne verdens
   projeksjon.
4. `operation_log` og `deletion_audit` legges til som §15-observability- og
   ADR-014-revisjonsPoster. De er **ikke** del av den kanoniske
   verdens tilstanden og inneholder aldri historietekst.
5. §3-tabellene `organizations` og `organization_memberships` opprettes som
   plassholdere uten skrivestøtte, jf. «placeholder domain in A».

## Konsekvens

- Contract §3 er ikke lenger en fullstendig liste over fysiske tabeller; denne
  ADR-en er et normativ supplement. Regelen er: §3-tabellene er autoritative,
  ADR-015-tabellene er projeksjoner og kan droppes uten datatap.
- Enhver ny projeksjon (f.eks. retrievesøk for §9) må følge samme krav: den må
  kunne gjenoppbygges fra ledger og må ikke kunne muteres utenfor reduceren.
- `state_hash` i `world_snapshots` forblir den kanoniske kontrollsummen; en
  projeksjon inngår aldri i hashen.

## Berørte filer

`docs/architecture/migrations/003_cast.sql`,
`docs/architecture/migrations/004_ledger.sql`,
`docs/architecture/migrations/007_jobs_and_accounting.sql`,
`core/src/store.ts`, `core/src/narrative.ts`, `core/src/engine.ts`.
