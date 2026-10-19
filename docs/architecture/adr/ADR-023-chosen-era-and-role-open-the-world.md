# ADR-023 — Valgt tid og rolle åpner verden: blåtrykken er pipeline, ikke kanonisk state

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-15 sammen med `createWorld` og `validateSetting` i `core/src/engine.ts`.

## Kontekst

Master US03/UI03 lover at spilleren velger **tid, sted og rolle** før verden åpnes.
Contract §12 definerer referanseåpningen — 2034, Singapore, founder-ceo, cash 100 /
influence 60 / credibility 50 — som det faste målefikspunktet for gullentene.

Målt før denne endringen var §12 blitt mer enn et fixpunkt: `createWorld` åpnet
**alle** verdener på referanseverdiene uavhengig av hva spilleren hadde valgt.
`setting` ble validert i pipelinen (`validateSetting` sjekket `allowedEras`,
`allowedLocations`, `allowedRoles` og §12s constraints) og deretter kun lagret som
blåtrykk, mens genesis tok `worldTime` fra `template.worldTime` og rollen fra
`template.characters` — begge skrevet som 2034-verdiene. En spiller som valgte
1888, fikk en verden som startet i 2034 og spilledte som Founder/CEO. Det er ikke
en rundingsfeil i visningen: `worldTime` er kanonisk state (Contract §6, ADR-010),
og `roleIds` er det premissene i regelsettet sjekker mot.

Avviket er to ting på én gang, og de har ulikt svar:

1. **En manglende datamodell:** rulepack-en hadde én startverdi per mal, ikke én
   per tidlig. Motoren *kunne* ikke åpne på 1888 uten å finne på et tidspunkt.
2. **En manglende binding:** selv med dataene, var linjen fra validert `setting`
   til genesis ikke skrevet.

## Beslutning

**Det validerte innholdet er det verden åpner på. §12s referanseåpning er ett
tilfelle av det, ikke standarden som ligger under.**

1. **`WorldTemplate` får to obligatoriske tabeller:**
   `eraStarts: { era, worldTime }[]` og `roleGrants: { role, roleIds, title }[]`.
   De er pakkekrav, ikke valgfritt: en mal som erklærer en tid den ikke kan starte
   i, er en ødelagt mal.
2. **`createWorld` slår opp i tabellene på den validerte settingen**, og
   refererer ikke lenger `template.worldTime` eller referansekarakterens
   `roleIds`/`profile.title` for spillerfiguren. Slaget er etter en `validateSetting`
   som nekte alle verdier uten oppslag, så `.find(...)!` er garantert, ikke en
   antakelse.
3. **`validateSetting` skiller spillerfeil fra pakkefeil.** «Era is not supported»
   er en 422 på innspill; «Era has no opening time in this world» er en 422 på
   regelsettet, og den feiler høyt i stedet for å åpne verdensuren på
   referansetiden. Det siste er den farlige varianten: den gir en grønn kø og en
   usynlig løgn.
4. **Rollen gir kapasitet i kanonisk state og tittel utenfor.**
   `roleGrant.roleIds` skrives inn i genesis-payloaden for spillerfiguren, altså i
   `WorldState` via `applyEvent`; `roleGrant.title` legges på
   `store.characters[].profile`, som er visningsdata og ikke inngår i
   `stateHash`. Avgrensningen er bevisst: en stillingsbetegnelse skal ikke kunne
   endre et replay.
5. **Sted blir blåtrykk, ikke state.** `setting.location` lagres i
   `store.blueprints[].setting` og i `constraints`, og flyttes ikke inn i
   `WorldState`. Grunnen er §6: feltet finnes ikke i den kanoniske modellen, og å
   legge det til der hadde endret `stateHash` for alle eksisterende verdener og
   brutt replayet deres (Contract §3, T19). Denne ADR-en fjerner glappen «validert,
   men sett bort fra» for tid og rolle; den gjør ikke stedet til en kanonisk
   størrelse.
6. **Determinismen er bevart ved at referanseåpningen er standarden.**
   `defaultSetting` gir `allowedEras[0] = '2034'`, `allowedLocations[0] =
   'singapore'`, `allowedRoles[0] = 'founder-ceo'`, og 2034-starten er §12s egen
   `2034-09-15T09:00:00.000Z` med `founder_ceo` og «Founder/CEO, Helix Transit» —
   identisk med det malen tidligere hardcodet. Genesis-payloaden for en verden uten
   eksplisitt setting er derfor byte-identisk før og etter.

## Konsekvenser

* **Målt 2026-10-15:** gullenten «opens a world on the era and role the player
  chose» — `era: '1888'`, `location: 'copenhagen'`, `role: 'investigator'` gir
  `worldTime = 1888-09-15T09:00:00.000Z`, `roleIds = ['investigator']`, tittel
  «Investigator, Helix Transit», blåtrykk `location = copenhagen`, og
  `verifyReplay` lik. Samme kjøring åpner en referanseverden (registrert som
  `user_ref`, fordi gratiskvoten er én aktiv verden per bruker) og måler 2034 +
  `founder_ceo` + «Founder/CEO, Helix Transit».
* **Gullhashen er urørt:** `npm run seed` måler 28 hendelser, versjon 7 og
  `golden hash : match` mot `sha256:ba95bdda…6247`. Det er det faktiske beviset
  for punkt 6, ikke en antakelse om at endringen «bør» være nøytral.
* **Narrasjonen følger klokka spilleren valgte.** `world_time` i
  `NarrativeRequest` (Contract §10) leses fra `snap.state.worldTime`, så en 1888-
  verden får en 1888-tid i prompten og i stand-in-prosaen.
* **Det synlige beviset på enheten er verdenstiden,** ikke tittelen:
  `apps/mobile/src/components/cards.tsx:109` viser `world.worldTime` på scenekortet.
  Appen viser ikke `profile.title` noensteds; besetningsplaten på oppsettsskjermen
  hadde derimot sin egen rolletekst, og den sto fast på referanserollen også etter
  at spilleren hadde valgt en annen — skjermen motsier seg selv der valget tas.
  Platen følger nå det valget (`apps/mobile/src/app/setup.tsx`, `Cast`), med tekst
  fra appens egen katalog.
* **Målt 2026-10-15 på transportene som faktisk brukes** (bevis:
  `docs/qa/evidence/adr-022-023/`): over HTTP gir `POST /v1/worlds` med
  `1888/copenhagen/investigator` 201 og `worldTime = 1888-09-15T09:00:00.000Z` med
  fire tilbud; på emulatoren, i den vanlige flyten fra UI10 til scenekortet med
  ekte trykk på tids- og rollekippene, bytter «you»-plateen seg til «Investigator»,
  spill-skjermen leder episoden med «September 15, 1888, 09:00, by the world
  clock», og kortet i MULTIVERSE sier `Version 1 · world time 1888-09-15`.
* **Premseteksten på UI03 er ennå malens:** den beskriver Singapore 2034 uavhengig
  av hva som er valgt. Den er forfattet innhold per mal, ikke per kombinasjon, og
  å skrive den om for hver tid og hvert sted er et innholdsarbeid denne ADR-en
  ikke gjør. Det er den gjenværende tekstmotsigelsen på skjermen.
* **En ny mal må levere begge tabellene fullstendig** for alle erklærte tider og
  roller; mangler en av dem, neker `validateSetting` verden i det hele tatt. Det er
  en strengere pakkekontrakt enn før, og den er ment slik: et halvt regelsett skal
  ikke åpne en verden på feil tidspunkt.

## Forhold til originalen

Master US03 er løftet, Contract §12 er referansen, og §6 er den kanoniske
modellen. Ingen av dem sier at valget skal ignoreres, så dette er ikke en endring
av vedtaksinnhold — det er å fjerne en implementasjonsvei som gjorde §12 til en
standard og US03 til en dukke. Beslutningen berører ikke §12s faste
ressursset eller transition-tabell; de står ved lag. De to nye feltene på
`WorldTemplate` er additive i regelsettformatet, og `INVALID_BLUEPRINT` som
svarkode eksisterte allerede (Contract §11s valideringsfeil).
