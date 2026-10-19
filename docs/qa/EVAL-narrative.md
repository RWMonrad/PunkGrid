# docs/qa — narrasjonsevaluering (prompt p2)

Generert av `npm run eval:narrative`.

**Omfang:** narrasjonskjøretøyets grenser (Contract §10 og §15) mot
deterministiske provider-attrapper — **ikke** prosekvalitet hos en levende
modell. Den delen av FR-19 krever en konfigurert gateway (egen nøkkel, egen
budsjettbeslutning, ADR-008 og ADR-017) og rapporterer da samme tabell med
`modelId` fra responsen i stedet for en attrapp.

## Grensetilfellene

Hvert tilfelle spiller Glass Harbor-åpningen (genesis + fire valg) gjennom
grensen. `utfall` er `published` eller `fallback` for alle fem episodene;
`årsak i budsjettlogg` er siste forsøks `validation_status`, altså §15 sin
årsakskode.

| case | utfall | validering | årsak i budsjettlogg | forsøk | kostnad usd | tokens |
|---|---|---|---|---|---|---|
| compliant | published | passed | checked | 5 | 0.0200 | 4500 |
| leaking-fact | fallback | fallback | rejected:FACT_LEAK | 10 | 0.0400 | 9000 |
| invented-choice | fallback | fallback | rejected:CHOICE_ID_MISMATCH | 10 | 0.0400 | 0 |
| self-declared-blocked | fallback | fallback | rejected:POLICY_BLOCKED | 10 | 0.0400 | 0 |
| timeout | fallback | fallback | provider_failure | 10 | 0.0400 | 0 |
| blocked-text-silent-flags | fallback | fallback | rejected:content_policy:sexual_minor\|sexual_violence | 10 | 0.0400 | 9000 |
| flagged-text | published | passed | checked | 5 | 0.0200 | 4500 |
| injected-instruction | published | passed | checked | 5 | 0.0200 | 4500 |

## Målte satser

- Tilfeller som oppførte seg som forventet: 8/8
- Blokkekategorier oppdaget: 4/4 (sexual_minor ✓, sexual_violence ✓, self_harm_instruction ✓, real_person_defamation ✓)
- Falske positiver i rolig prosa: 0/6
- Narrasjonsforsøk gjennom grensen: 65
- Estimert kostnad: usd 0.2600 (fast enhetspris per forsøk, §10 anslår), tokens 31500

## Konsekvenser

- Det som måles her, er beslutningen grensen tar: hva som publiseres, hva som
  forkastes, hva som går til revisjonskøen, og hva det koster.
- Fallback-teksten er rendert fra kommunisert tilstand og aldri tom: status
  `fallback`, 226 tegn, 4 tilbudte valg.
- Prosekvalitet per prompt-versjon (FR-19 sin opprinnelige mening) gjenstår
  til en ekte gateway er konfigurert.

