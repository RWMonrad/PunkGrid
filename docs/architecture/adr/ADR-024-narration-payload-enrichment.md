# ADR-024 — Narrasjons-payloaden utvides med innhold, ikke bare id-er

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-24 sammen med endringer i `core/src/narrative.ts`, `core/src/ai/prompt.ts` og `core/src/engine.ts`.

## Kontekst

Prompt-filene `docs/design/prompts/p3-noir.json` og `docs/design/prompts/p3-vitreous.json`
avslørte et strukturelt problem: `userPrompt` (`core/src/ai/prompt.ts:71-85`) sendte
11 nøkler der `authorized_pov_facts` var et array av **fakta-ID-er**, `event_excerpts`
var `{id, type}` og `character_profiles` var `{id, name}` (`core/src/engine.ts:1074-1080`).

Modellen fikk altså strengen `fact_offer` og ingenting om hva tilbudet var. Ingen
prompt kan skrive scene-prosa av den payloaden — tynnheten i UI04 er strukturell,
ikke stilistisk. `validateNarrative` (`core/src/narrative.ts:126`) fanger det heller
ikke: påfunn er ikke `FACT_LEAK` med mindre det tilfeldigvis treffer en
`sensitivePhrase`, så en fantasiløs løgn publiseres og faktureres (`core/src/engine.ts:1114`).

Dette er ikke en stil-feil. Det er en payload-feil.

## Beslutning

**Payloaden utvides med innhold, men flammen holdes intakt.**

Fem nye felt legges til `NarrativeRequest` og bygges av motoren fra snapshotet på
episodens committ-versjon, POV-filtrert, og ingen nøkkel kommer fra en klient:

1. **`authorizedFactLabels: Record<ID, string>`** — fakta-ID til label, **bare** for
   id-er som allerede er i `authorized_pov_facts`. Aldri en label for et uautorisert
   fakta: labelene er lekkasje-overflaten, siden `secretMarkers` er bygget fra dem
   (`core/src/engine.ts:1055`).

2. **`characterTitlesAndGoals: Record<ID, { title?: string; goals: string[] }>`** —
   karakter-titler og mål fra rulepack-en (`core/src/glassHarbor.ts:61-66`). Mål er
   labeler som `fast_exit`, aldri en indre tilstand.

3. **`relationshipValues: Record<ID, { dimension: string; value: number }>`** —
   spillerens utgående relasjonsverdier på dette snapshotet (`core/src/glassHarbor.ts:68-74`).
   Spilleren er POV-karakteren, så disse er allerede deres å vite.

4. **`resourceValues: Record<string, number>`** — spillerkarakterens ressurser: cash,
   influence, credibility.

5. **`arcStatuses: Record<ID, string>`** — bue-statuser på dette snapshotet (bare
   `open` eller `progressed`, ikke `locked`). En låst bue er ikke kunnskap, og
   dagens payload lekker den bare fordi den ikke sier noe i det hele tatt.

## Konsekvenser

### Flammen holdes
Hvert tillegg leses fra snapshotet på episodens committ-versjon
(`core/src/engine.ts:1044-1048`), POV-filtrert, og ingen nøkkel kommer fra en
klient. Payloaden slutter å være et skjelett uten å bli en kanal.

### Token-budsjettet må konfigureres
`tokenBudget` er hardkodet 2000 (`core/src/engine.ts:1078`) og output-taket er halvparten
(`core/src/ai/openai.ts:164`). Labeler, mål og tall legger til omtrent 150-300 tokens
på en Glass Harbor-scene, så `tokenBudget` må bli en rulepack- eller budsjett-avledet
verdi før denne berikelsen skipes, ellers mister prosaen stille halvparten av taket
sitt.

### Tester oppdatert
`core/tests/ai.test.ts` forventer nå de 15 nøklene og verifiserer at
`authorized_fact_labels` inneholder `fact_offer` men ikke `fact_secret_link`, at
`character_titles_and_goals` inneholder `char_player`, at `relationship_values`
inneholder `char_mara`, at `resource_values` inneholder `cash`, og at `arc_statuses`
inneholder `arc_acquisition`.

### Prompt-filene er nå kjør-bare
`docs/design/prompts/p3-noir.json` og `docs/design/prompts/p3-vitreous.json` sine
`worked_example.input` bruker den **foreslåtte** payloaden. De er nå gyldige mot
den faktiske motoren, ikke bare mot en tenkt kontrakt.

## Risiko

- **Label-lekkasje:** Hvis en label inneholder en `sensitivePhrase` for et uautorisert
  fakta, kan modellen skrive den. `secretMarkers`-skanningen (`core/src/narrative.ts:148-151`)
  fanger det, men bare hvis phrase-en er eksakt. Mykere oppfinnelser publiseres.
- **Token-svinn:** Hvis `tokenBudget` ikke justeres, mister prosaen kapasitet.
- **Test-dekning:** De nye feltene er testet for tilstedeværelse, men ikke for
  innhold i alle verdener. En verden med mange fakta kan avsløre nye lekkasje-mønstre.

## Referanser

- `docs/design/prompts/p3-noir.json` — `payload_finding`
- `docs/design/prompts/p3-vitreous.json` — `payload_finding`
- `core/src/narrative.ts:22-46` — `NarrativeRequest` interface
- `core/src/ai/prompt.ts:71-92` — `userPrompt` funksjon
- `core/src/engine.ts:1042-1120` — `generateEpisode` med berikelse
- `core/tests/ai.test.ts:119-135` — oppdatert test
