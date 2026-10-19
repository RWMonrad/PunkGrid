# ADR-017 — narrasjonsadapter mot en OpenAI-kompatibel gateway

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-12 som Sprint 3-implementasjonen av Contract §10 og ADR-008.

## Kontekst

Contract §10 beskriver narrasjonsgrensen som en tillitskant: inn går
`world_id, committed_version, event_ids, authorized_pov_facts, character_profiles,
style_constraints, allowed_choice_ids, prompt_version, token_budget`, ut går
`episode_text, referenced_event_ids, choice_copy_by_id, content_flags` —
strengt validert, aldri kanonisk. Motoren (`core/src/engine.ts`) håndhevet alt
dette allerede mot de deterministiske fake-providerne, og poenget i ADR-008 var
at virkelige provider-utbytere kommer og går: *én* grensesjikt skal til, ikke
per-leverandør-logikk i simuleringen.

Da vi skulle koble på et ekte kall, dukket fire spørsmål opp som §10 ikke
besvarer, og de avgjør hvordan en HTTP-adapter i det hele tatt kan bli
feilfri:

1. **Hva er en feil?** En gateway som svarer 200 med prosa i stedet for JSON,
   som svarer 503, som holder forbindelsen åpen, og som nevner fakta tilskueren
   ikke skal vite, er fire ulike tilstander — men motoren har bare én måte å si
   «ikke publiser dette» på.
2. **Hvor mange forsøk finnes?** Motoren prøver allerede to ganger per episode.
   En adapter som også prøver to ganger internt, gjør det til fire betalende kall
   per episode uten at noe sted sier det.
3. **Hvor kommer `style_constraints` fra?** §10 krever feltet i innholdet, men
   verken `RulePack` eller `NarrativeRequest` hadde det. Stilen kan ikke bo i
   prosessen som bygger prompten, ellers kan ingen promptversjon knyttes til en
   versjonert verden.
4. **Hvordan unngår vi at nøkler og kostnad blir en sideeffekt av å starte
   tjenesten?** Sprint 3–5 utvikles mot en emulator på en utviklermaskin; en
   `npm run serve` som tilfeldigvis ringer en betalt modell, er ikke en ufarlig
   detalje.

## Beslutning

1. **Én grense, én implementasjon per transportfamilie.**
   `core/src/ai/openai.ts` eksporterer `OpenAiCompatibleProvider`, en
   `NarrativeProvider` som snakker `/chat/completions` mot *alle*
   OpenAI-kompatible endepunkter (OpenAI, Azure OpenAI, Supabase/Groq/Together,
   en lokal LLM). `NarrativeRequest`-typen er den eneste avhengigheten motoren
   har; ingen leverandørspesifikk type lekker inn i `engine.ts`. Ny leverandør
   som ikke er kompatibel = ny fil i `core/src/ai/`, ikke ny logikk i
   simuleringen.

2. **Adapteren kaster aldri unntak; den returnerer `failure`.** Hver transport
   blir til det feltet §10 allerede kjenner: tidsavbrudd
   (`AbortSignal.timeout`) → `failure: 'timeout'`, 4xx, nettverksbrist og
   utmattede 5xx-forsøk → `failure: 'error'`. Dermed er gjenprøving og fallback
   alltid motorens beslutning, aldri adapterens — og en provider som likevel
   kaster, fanges av motorens eget `try`.

3. **Returkoden avgjør hva som er gjenprøvbart, og motoren eier forsøkene.**
   Adapterens egne forsøk (`maxRetries`, default 1) gjelder **bare** 429 og
   5xx — tilstander der vi vet at svaret ikke er produsert. 4xx repeteres ikke.
   Tidsavbrudd repeteres ikke internt: en hengende gateway venter ut sin egen
   frist én gang per forsøk, og det er motoren som gir fallback. Det øvre talet
   på betalende kall per episode er derfor `2 × (1 + maxRetries)`, dokumentert
   her og testet i `ai.test.ts` («gives up on 5xx after the extra attempt»,
   nøyaktig 4 kall).

4. **Ugyldig JSON er et validert avvisnings tilfelle, ikke en transportfeil.**
   Når `message.content` ikke er JSON, returnerer adapteren teksten som
   `episode_text` uten hendelsesreferanser og valgkopi. Valideringen i §10
   (EMPTY_TEXT / MISSING_EVENT_REFS / CHOICE_ID_MISMATCH / FACT_LEAK /
   POLICY_BLOCKED) fanger det, revisjonen får `narrative_rejected:…`, og
   fallback-teksten publiseres. Den avviste prosaen når aldri en leser — testet
   i «a prose answer that is not JSON is rejected, not published».

5. **`style_constraints` blir en del av regelsettet.** `StyleConstraints` (pov,
   tone, language, lengthTarget, forbidden) legges til `RulePack` som valgfritt
   felt, `GLASS_HARBOR.style` setter den for fixturen, og
   `NarrativeRequest.styleConstraints` er nå et **påkrevd** felt som motoren
   fyller fra `pack.style ?? DEFAULT_STYLE`. Dermed er stilen versjonert med
   verdenen, akkurat som §10 forutsetter, og en prompt-endring kan ikke skje
   uten en regelsette- eller kodeendring som kan reproduseres.

6. **Promptversjonen tildeles av provideren, ikke av motoren.**
   `NarrativeProvider` får valgfritt `readonly promptVersion`, og
   `generateEpisode` registrerer den i `generation_runs` (fake-providere uten
   versjon blir værende på den historiske `p1`; adapteren rapporterer
   `PROMPT_VERSION = 'p2'`). §10 krevde at `prompt_version` spores; dette er
   stedet den faktisk kommer fra.

7. **Responsformatet er streng JSON-Schema, og `choice_copy_by_id` reiser som
   et par-array.** `EPISODE_SCHEMA` (`additionalProperties: false`, alle felt
   `required`) sendes som `response_format`, fordi en fri tekstmodell ellers
   finner på id-er. §10-navnet `choice_copy_by_id` er et objekt med
   **dynamiske** nøkler, og strenge JSON-Schema-implementasjoner støtter det
   ikke — adapteren ber derfor om `choice_copy: [{choice_id, copy}]` på
   ledningen og mapper tilbake til §10-formatet i `toNarrativeResponse`. Kontraktens
   utdata-form bevares på grensen mot motoren; bare ledningsformatet er et
   dokumentert avvik.

8. **En gateway aktiveres bare av tre miljøvariabler, alle tre.**
   `providerFromEnv` (`core/src/ai/env.ts`) krever `PUNKGRID_AI_BASE_URL`,
   `PUNKGRID_AI_API_KEY` og `PUNKGRID_AI_MODEL`. Mangler én, brukes
   `CompliantProvider` — den deterministiske fake-en som testene og
   `npm run seed` allerede kjører mot. Startlinjen skriver hvilken som er valgt:
   `narration: gpt-x via https://…` eller `narration: deterministic fake
   provider (PUNKGRID_AI_API_KEY not set — no gateway calls, no spend)`. Ingen
   nøkkel, ingen `fetch`, ingen utgift i noen kjøring som ikke ber om det;
   `serve.ts` og `worker.ts` deler samme kilde, så API- og worker-prosess velger
   samme provider fra samme miljø.

## Konsekvens

- Avviket fra §10 er begrenset til ledningsformatet i punkt 7 og er dokumentert
  der. Resten av kontrakten — innholdet, utdataene, budsjett før kall,
  validering før publisering, token- og kostnadsregnskap — er uendret.
- `generation_runs` får mening: `promptVersion`-feltet kommer fra provideren,
  `validationStatus` sier nå `rejected:KODE…` for avvisede svar i stedet for den
  tidligere «checked» uansett, og `modelId`/`inputTokens`/`outputTokens` fylles
  fra svarets `usage`. Begge deler er testet i `core/tests/ai.test.ts`.
- `tokenBudget` (2000 i motoren) blir til `max_tokens` via `outputTokenCap()` —
  halvparten, klippet til 128–1024. §10 skiller ikke mellom input- og
  output-budsjett; dette er den enkleste tolkningen som ikke kan la en
  svarlengde sprenge en samtale.
- Kostnaden er **fremdeles et estimat**: `unitCost = 0.004` per providerforsøk
  er motorens faste tall, ikke fakturaen. §10 ber om `actual_cost_if_known`, og
  det krever en pris-tabell per modell — åpent punkt, ikke Sprint 3-arbeid.
- Fake-providerne er **fremdeles** det suiten kjører mot. `ai.test.ts` bruker en
  lokal node:http-stub, så testene verken har en nøkkel eller avhenger av at en
  leverandør er oppe — men de tester likevel ekte sockets, ekte tidsavbrudd og
  ekte HTTP-koder.
- Åpne pointer, hver for seg: moderering (oppgave #9), `actual_cost_if_known`
  fra en pris-tabell, og at et 429-svar uten
  `retry-after` venter 0 ms i stedet for en eksponentiell backoff. Delt rate
  limiting (ADR-016) ble tatt av ADR-020.

## Berørte filer

`core/src/ai/prompt.ts`, `core/src/ai/openai.ts`, `core/src/ai/env.ts`,
`core/src/narrative.ts`, `core/src/rulepack.ts`, `core/src/glassHarbor.ts`,
`core/src/engine.ts`, `core/src/index.ts`, `core/scripts/serve.ts`,
`core/scripts/worker.ts`, `core/tests/ai.test.ts`.
