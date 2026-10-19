# ADR-018 — innrapporteringsrute og en deterministisk modereringsport

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-12 som Sprint 3-implementasjonen av Contract §15 og Master
FR-11 / US13.

## Kontekst

Contract §15 krever moderering ved både inn- og utgang, isolering av
prompt-injeksjon («story content is untrusted data, not instructions») og
driftslogger som ikke inneholder privat fortelltekst. Master FR-11 krever at
spilleren kan rapportere AI-innhold uten å forlate appen, og US13 spesifiserer
kvittering med rapport-ID pluss en baksystem-sak med minimert innhold.

Fire avgjørelser lå ikke fast i dokumentene:

1. **Hvor havner rapporten i §11?** Routelisten er normativ og har ti
   endepunkter, og §11 forbyr parallele endepunkter. En rapport må likevel gå
   over HTTP. Spørsmålet er altså om en ellevte rute er et avvik som må
   registreres, eller om den kan presses inn under de ti.
2. **Er en rapport en kommando?** Kommandomodellen i §3 og §6 har
   `expectedWorldVersion`, hendelseslogg og ny versjon. En rapport endrer ikke
   verdenstilstand i det hele tatt, men den må likevel være idempotent: en
   dobbeltrykket knapp skal ikke åpne to saker.
3. **Hva er en modereringsbeslutning uten en modell?** §15 sier ikke hvilket
   ordforråd som brukes. En modellbasert klassifikator gir ikke gjenkallelige
   gullentester, og det er testene som holder grensen ærlig.
4. **Hva er «minimert innhold» i en sak?** US13 krever nok for en saksbehandler
   til å handle, mens §15 krever at driftsposter ikke inneholder den private
   teksten. De to kravene peker i hver sin retning.

## Beslutning

1. **Én ny rute, registrert som avvik.**
   `POST /v1/worlds/{id}/episodes/{episodeId}/reports`. Den ligger under den
   eksisterende episoderessursen og arver dermed samme lesetilgang som
   `GET /v1/worlds/{id}/episodes/{episodeId}`. Ingen av de ti normative routene
   er flyttet, endret eller duplisert.
2. **Rapporten er ikke en kommando.** Den tar `commandId` som deduplenkelen —
   `moderation_cases.command_id` er `UNIQUE`, så en gjenkalt rapport returnerer
   samme sak og samme kvittering med `status: 'duplicate'` — men den skriver
   verken en hendelse eller en ny versjon, og krever derfor ikke
   `expectedWorldVersion`. Det er den eneste måten en rapport kan være både
   idempotent og uavhengig av world-versjonen på.
3. **Modereringsporten er en deterministisk leksikalsk screening, ikke en
   modell.** `core/src/moderation.ts` har fire blokkerende kategorier
   (`sexual_minor`, `sexual_violence`, `self_harm_instruction`,
   `real_person_defamation`) og fire flaggende (`graphic_violence`,
   `substance_abuse`, `extremism`, `gambling`). Ordforrådene er smale med vilje:
   «blood», «drunk», «sober» og «odds» er noir-prosa, og en screening som flagger
   hver eneste episode, sier køen ingenting. Et aldersord teller bare sammen med
   et seksuelt begrep i samme setning.
4. **Porten løper i tillegg til providerens egne flagg, ikke i stedet for dem.**
   `validateNarrative` sjekker `content_flags` (POLICY_BLOCKED), og `screenText`
   kjører på `episode_text` uansett — en gateway som ikke sier noe om svaret sitt,
   blir likevel stoppet her. Et blokkerende treff går inn i samme årsakkode-sti
   som en skjemaavvisning: `narrative_rejected:content_policy:…` i revisjonen og
   `rejected:content_policy:…` i `generation_runs`, og episoden ender hos
   `publishFallback`. Et flaggende treff publiseres, med `narrative_flagged:…`
   i revisjonen.
5. **Injeksjon er synlig, men aldri en instruks.** `containsInjectionAttempt`
   logger `narrative_injection_attempt` på svaret. Teksten blir liggende som
   innhold, og ingen veg i motoren leser den. På inngangssiden skjer det samme i
   `validateSetting`: sjanger og flagg screenes før genesis, og et forsøk på å be
   narratoren om noe, gir `INVALID_BLUEPRINT` med
   `contentPolicy: ['prompt_injection']`.
6. **Saken er et utdrag, ikke episodeen.** `minimiseForCase` gir
   `episodeId: ` pluss 180 tegn med kollapset whitespace, `reporter_note` klippes
   til 200 tegn, og `moderation_cases` har `CHECK` på begge (henholdsvis 260 og
   200 tegn). Kategoriene fra screeningen reiser med som årsakoder
   (`categories TEXT[]`).
7. **Sakene lagres i `punkgrid.moderation_cases`, world-forankret.**
   `FOREIGN KEY (world_id, episode_id) REFERENCES narrative_episodes (world_id, id)`
   — som krevde `UNIQUE (world_id, id)` på `narrative_episodes` — er det andre
   forsvarslaget mot en rapport som peker på en annen verdens episode, etter at
   motoren allerede har avslått den. RLS-politikken er den samme
   medlemskapspolitikken som for alle andre world-tabeller.
8. **Årsakordforrådet er spillernes, ikke skjermens.** `moderation_reason`
   (sexual_content, violence, self_harm, real_person, offensive_language, other)
   er det som står i UI-en; skjermens kategorier er interne årsakoder. De to
   listene er ikke sammenfallende med vilje: en saksbehandler sorterer etter det
   brukeren sa, og skjermen forklarer hva som faktisk ble funnet.

## Konsekvens

* En ellevte rute er nå en del av overflateflaten. Klienter må behandle `201`
  med `reportId` og `receipt`, og §11-tabellen i contractdokumentet er ikke
  lenger hele sannheten om hva tjeneren svarer på.
* En rapport kan ikke valideres mot en world-versjon. Den som rapporterer en
  episode som ennå ikke har prosa, får `422 RULE_PRECONDITION_FAILED` med
  `EPISODE_NOT_PUBLISHED` — ikke en konflikt. Det er riktig, men det er annerledes
  enn resten av mutationene.
* Den leksikalske porten er bundet til engelske stammer. Parfrasering, andre
  språk og omskrivninger er utenfor MVP-omfanget. Dekningen som gjenstår, er
  providerens egne `content_flags`, sakskøen og FR-19-evalen.
* To forsøk per episode gjelder også en blokkert tekst: en deterministisk
  provider gir samme svar begge ganger, så prisen for en blokkert episode er to
  kall. En ekte gateway kan gi et annet, akseptabelt svar på forsøk to — det er
  meningen, og det er taket ADR-017 punkt 3 binder.
* `real_person_defamation` er en navneliste, ikke en tittel. Listen er en start
  og må vedlikeholdes som produktinnhold, ikke som kode.

## Berørte filer

- `core/src/moderation.ts` — screeningen, injeksjonsgjenkjenning, minimert utdrag.
- `core/src/engine.ts` — `validateSetting` (inngangsport), `generateEpisode`
  (utgangsport), `reportEpisode`, `listModerationCases`.
- `core/src/api.ts` — `POST /v1/worlds/{id}/episodes/{episodeId}/reports`.
- `core/src/store.ts`, `core/src/db/pgStore.ts`, `core/src/db/schema.ts` —
  `ModerationCaseRow`, hydrering og persisting av `moderation_cases`.
- `docs/architecture/migrations/009_moderation.sql` — tabell, typer, RLS, grants.
- `docs/architecture/migrations/validate_invariants.sql` — blokk 18–20.
- `core/tests/moderation.test.ts` (23 tilfeller), `core/tests/pg.test.ts`
  (rapportsak over Postgres), `core/scripts/eval-narrative.ts`
  → `docs/qa/EVAL-narrative.md`.
