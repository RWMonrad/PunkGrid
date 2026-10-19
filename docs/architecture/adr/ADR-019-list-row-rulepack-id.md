# ADR-019 — `rulepackId` i verdenslisten, slik at UI07 ikke skriver ut en rå id

**Status:** Accepted — teknisk beslutning tatt under delegert myndighet.
Registrert 2026-10-12 sammen med Expo-appens spillflate (Sprint 4–5).

## Kontekst

Master UI07 («World home / resume») krever at spilleren kjenner igjen verdenen hun
kan gå tilbake til. Contract §11 gir listen to felt som kan brukes til å skille
radene: `worldId` og `status`. `worldId` er en intern, opaque identifikator
(`world_0DEKJR244F0001`); §5.5 og Master FR-19 krever at grenseflatene holder seg
til produktets eget språk, og en rå database-id på skjermen er verken lesbar eller
fiktiv.

Verdensvisningen (`GET /v1/worlds/{id}`) har allerede det samme problemet på en
annen måte: `world.rulepackId` er det eneste navngivende feltet i responsen, men
appen hadde så lenge bare åpningen som trengte en tittel — den første episoden ble
vist med en hardkodet «The Glass Harbor» i toppen, mens alle senere visninger
falt tilbake på `rulepackId` og skrev `glass-harbor-2034` over tittelfeltet. Avviket
ble oppdaget på Android-emulatoren da verdenen ble pauset: reloading byttet tittelen
ut med mal-id-en.

Valget sto mellom:

1. La klienten huske tittelen fra opprettelsen (lokal lagring per verden).
2. Send et visningsnavn fra serveren (`name`/`title` i listetraden).
3. Send `rulepackId` i listetraden og la klienten slå det opp i sin egen katalog.

## Beslutning

**Alternativ 3.** `GET /v1/worlds` gir hver rad feltet `rulepackId` i tillegg til
`worldId`, `identityId`, `status`, `worldTime` og `stateVersion`. Appen slår id-en
opp i `src/lib/setting.ts` (katalogen som allerede inneholder `The Glass Harbor`
og premissen) og viser `title`, med «A life in progress» som fallback for en
ukjent mal. Verdensvisningen bruker samme oppslag, og den hardcodede
første-episode-tittelen er fjernet.

## Konsekvenser

* Responsformen utvides med ett lesefelt. Ingen ny rute, ingen endret
  forespørselskropp, ingen endring i idempotens eller versjonssjekk.
* Ingen informasjonslekkasje: radene i denne listen er bare verdener calleren er
  medlem av, og `rulepackId` er en nøkkel i den offentlige mal-katalogen, ikke en
  hemmelighet. RLS og autorisasjonen i §1.7 påvirkes ikke.
* Tittelen blir værende på klienten. Det er bevisst: §5.5 eier produktets språk,
  og katalogen er allerede en delt fil mellom regelsett og UI. En server som
  returnerer en tekststreng ville gjort oversettelse og stil til en
  backend-beslutning.
* Gullentesten i `core/tests/api.test.ts` fanger feltet, så en senere endring som
  fjerner det, treffer en test og ikke bare en skjerm.

## Forhold til originalen

Contract §11 er normativ for responsformer; denne endringen er derfor registrert
som avvik og skrevet inn i §11s tabell og brødtekst. Beslutningen følger samme
mønster som ADR-016 (`identityId` i verden visning) og ADR-018 (ellevte rute):
utvid svaret der klienten ellers må gjette, og si det høyt i kontrakten.
