# ADR-022 — Scenens intervall håndheves av motoren: øvre tak, gulv og ingen låst spiller

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-15 sammen med tilbudsreglene i `core/src/engine.ts`.

## Kontekst

ADR-012 harmoniserte Master FR-04/US04/UI04 og Contract §5 steg 5 på ett punkt:
alle scener, genesis inkludert, skal inneholde **2–4** serverutstedte gyldige valg.
Det ADR-en ikke sa, var *hvem* som holder intervallet, eller hva som skjer når
regelsettet ikke gjør det. Motoren gjorde nemlig ingen av delene: `choicesAt`
returnerte hele listen med valg som (a) world state hadde flagget som `offerable` og
(b) spilleren kunne betale for øyeblikket. Intervallet var dusj, ikke vakt.

Målt 2026-10-12 med en skjøretes over hele Glass Harbor-regelsettet (frø 20261011,
`CompliantProvider`, 47 versjoner):

* genesis: **4** valg ✓
* etter `open_negotiation`: **5** — `reject_sale` låses opp av flagget og er
  øyeblikkelig betalbar, så scenen skriver 5 rader i `offered_choices` og viser 5
  knapper. Øvre grense brutt.
* etter å ha tømt `influence` og `cash` og så spilt `brief_staff` ti ganger: **1**
  valg igjen (`confront_mara`). Nedre grense brutt, og scenen er en knapp, ikke et
  valg.

De to bruddene har ulik årsak og krever ulike svar:

1. **Over fyllet** er en *utstedelses*feil: regelsettet inneholder flere gyldige
   handlinger enn en scene tåler. Innholdet er riktig; mengden er ikke.
2. **Under bunnen** er en *gjenopprettings*feil: et valg kan bruke opp den
   ressursen som holdt de andre valgene betalbare, og `offerable`-flaggene er
   monotone — de skrus aldri av igjen ved bruk, så verden låser seg ikke, men
   scenen går tom for alternativer.

Contract §8 forbyr det åpenbare trikset: finnes ingen gyldig kandidat, skal
kommandoen bli `no_op`; motoren skal aldri oppfinne innhold for å fylle en scene.
Og Contract §12 har bare én handling uten resource-precondition (`confront_mara`),
så et regelsett kan ikke løse bunnen alene.

## Beslutning

**Motoren eier intervallet, som en grense på utstedelsen — ikke på world state.**

1. **Policyen legges i regelsettet:** `RulePack.offerPolicy = { min, max }`,
   Glass Harbor `{ min: 2, max: 4 }` — samme intervall som ADR-012, nå som data
   motoren leser i stedet for en setning i et dokument.
2. **Øvre tak (`capOffers`):** er flere valg betalbare enn `max`, utstedes de
   `max` mest aktuelle, og resten eksisterer ikke for spilleren i denne versjonen.
   Rekkefølgen er deterministic og dokumentert:
   * `openedSeq` **synkende** — det world state nettopp låste opp, leder scenen.
     Et valg som aldri blir vist, er en belønning spilleren aldri får.
   * `usedSeq` **stigende** — blant jevngamle valg kommer det spilleren nettopp
     brukte, sist. En scene som gjentar handlingen akkurat utført, er støy.
   * erklæringsrekkefølge i `pack.choices` **stigende** som avgjørende ledd. Det er
     §12s egen rangering av de fire åpninghandlingene (Investigate → Confront →
     Open negotiation → Brief staff), så det som kuttes, er det lavest rangerte.
   * Det utstedte settet sorteres til slutt på `choiceId`, som tidligere.
3. **Historikken leses fra hendelsesloggen, ikke fra `WorldState.flags`**
   (`offerHistory`): et flagg forteller *at* noe kan tilbys, aldri *når*. Å skrive
   `offerSeq:*`-flagg i kanonisk state hadde endret `stateHash` for alle
   eksisterende verdener og brutt replayet deres (Contract §3, T19). Gullhashen
   `sha256:ba95bdda…6247` er urørt av denne ADR-en.
4. **Ustedelsen er autoriteten:** `submitChoice` neker et valg som ikke står i den
   sceneen motoren utstedte for den versjonen det committes mot, med
   `RULE_PRECONDITION_FAILED / CHOICE_NOT_OFFERED`. Uten dette var taket kosmetisk —
   en klient som sendte det femte valget, fikk det utført. Rekkefølgen i sjekken
   bevarrer eksisterende feilsemantikk: `INVALID_CHOICE` (ukjent id), så
   `CHOICE_NOT_OFFERED` (aldri låst opp), så precondition-regelen, så
   `UNKNOWN_CHARACTER_REFERENCE` (et ødelagt regelsett treffes før taket), og først
   til slutt scenegulvet.
5. **Gulvet (`assertSceneFloor`):** før et valg committes projiseres hendelsene
   gjennom `reducer.applyEvent` — redusatoren er eneste autoritet for
   state-utvikling, så en vakt som regner sine egne tall, vil drifte fra
   `commit`. Prosjeksjonen kompileres med en kastbar id-fabrikk, slik at en
   simulering ikke trekker fra den deterministiske id-rekka.
   * Holder projeksjonen `min` eller flere valg: kommandoen går gjennom.
   * Går den under `min`, og **et annet utstedt** valg holder golvet: nekes med
     `RULE_PRECONDITION_FAILED / SCENE_CHOICE_FLOOR` og det skrives ingen hendelser.
   * Går den under `min` og det **ikke finnes** noe annet utstedt valg: kommandoen
     går gjennom. Å neke den siste knappen er en låst spiller, og det er et verre
     brudd enn en tynn scene.
6. **Gulvet vokter bare `choice.select`.** `surprise.request` og
   `scheduled_event.resolved` legger bare til `offerable`-flagg; §8s `no_op`-regel
   er allerede vakt der.

## Konsekvenser

* **Målt etter endringen**, samme kjøreform: etter `open_negotiation` **4** valg med
  `reject_sale` i scenen; gjentatt `open_negotiation` nekes som `CHOICE_NOT_OFFERED`
  uten en eneste ny hendelse; etter ti `brief_staff` fra tømt `cash`/`influence`
  holder scenen **2** valg, den elfte nekes med `SCENE_CHOICE_FLOOR` (målbar
  tilstand: `credibility = 5`, `brief_staff` ville dratt den til 0, mens
  `confront_mara` (+2) holder golvet), og `confront_mara` gjenoppretter scenen til
  7 i `credibility`. 47 versjoner, `verifyReplay` lik.
* **Målt på transportene som brukes** (bevis: `docs/qa/evidence/adr-022-023/`):
  over HTTP åpnes genesis med 4 tilbud, episoden publiseres med samme
  `allowedChoiceIds`, det uutstedte `reject_sale` nekes med 422
  `RULE_PRECONDITION_FAILED/CHOICE_NOT_OFFERED`, og seks påfølgende turn holdt
  4 — ingen versjon over `max`. På emulatoren telte målingen **4** klikkbare
  dører i den nyopprettede verdenen, lest fra Accessibility-treet etter én swipe
  så den fjerde kom med.
* `offered_choices` (ADR-015) er ikke lenger «alt world state tillater», men
  akkurat den sceneen som utstedes. `pg.test.ts` måller fortsatt SQL mot
  `currentChoices`, og det er nå den sterkere versjonen av påstanden.
* **Prosaen endrer seg med taket:** narratoren får `allowedChoiceIds` fra samme
  funksjon, så den kan ikke nevne et valg som ikke er på skjermen — §10s validering
  var allerede spisset mot dette.
* **En scene kan fortsatt stå med ett valg, og til og med null.** Det er den
  gjenværende risikoen denne ADR-en *ikke* fjerner, og den skal ikke fjernes ved å
  neke: å tømme et intervall er en regelsettkvalitet, ikke en motorfeil. Et nytt
  regelsett må derfor oppfylle to krav før det slippes: (a) minst én handling uten
  resource-precondition, (§12 har `confront_mara`), og (b) at ingen enkelt handling
  kan la scenen stå under `min` uten at en annen utstedt handling holder golvet.
  Gullenten «still lets the player take the only move a scene holds» låser at
  motoren aldri låser spilleren, selv i et regelsett som bryter (b).
* Tre gullenter lyser rødt om policyen fjernes (målt 2026-10-15 med
  `offerPolicy: { min: 0, max: 99 }`): «caps a scene at the issued interval…»,
  «refuses the move that would drain a scene…», og cap-gullentens
  `CHOICE_NOT_OFFERED`-nektelse. De to andre (dødslåst-tilfellet og
  §12-åpningen) er tillatende og skal forbli grønne.

## Forhold til originalen

Dokumenthierarkiet løser avvik: Master FR-04 er produktløftet, Contract §5 steg 5
er normativ for pipelinen, og ADR-012 vedtok at intervallet er felles. Ingen av dem
beskriver *hvordan* motoren holder det, så dette er en utfyllende beslutning, ikke
en endring av et vedtaksinnhold. §8s forbud mot oppdiktet innhold og §12s
transition-tabell er bevart ordrett; det er grunnen til at gulvet er en nektelse og
ikke en generør. `SCENE_CHOICE_FLOOR` er en ny `ruleCode` under den eksisterende,
stabile feilkoden `RULE_PRECONDITION_FAILED` — additiv, slik ADR-012 hadde det med
`WORLD_LIMIT_REACHED` og ADR-016 med `identityId`.
