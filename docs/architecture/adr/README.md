# PunkGrid ADR-logg

Autentisk beslutningsregister for hele prosjektet. Prosedyre (per Master §9.1 steg 1 og Contract §18): ethvert avvik mellom dokumenter, eller arkitektur-/produktbeslutning som endrer normative kontrakter, skal registreres som ADR før implementasjon, og begge dokumenter rettes.

| ADR | Tittel | Status | Beslutningskilde |
|---|---|---|---|
| ADR-001 | PostgreSQL er autoritativ; AI har aldri write-tilgang | Accepted | Master §4.5, Contract §1.2 |
| ADR-002 | Modulær monolitt fremfor mikroservices | Accepted | Master §4.5, Contract §1.1 |
| ADR-003 | Strict bounded choices før fri tekst | Accepted | Master §4.5, Contract §1.3/§10 |
| ADR-004 | Verdenseier ≠ identitet ≠ medlemskap | Accepted | Master §4.5, Contract §2/§3 |
| ADR-005 | Hendelseslogg + snapshot atomisk | Accepted | Master §4.5, Contract §3/§6 |
| ADR-006 | Async episodegenerering, stabil polling | Accepted | Master §4.5, Contract §7/§10 |
| ADR-007 | Private worlds only i A | Accepted | Master §4.5, Contract §0 |
| ADR-008 | Modelladapter og provider-budsjett før generering | Accepted | Master §4.5, Contract §1.10/§10 |
| ADR-009 | Aldersport 18+ i første offentlige release | Accepted | Master §4.5 |
| ADR-010 | World clock separat fra real time | Accepted | Master §4.5, Contract §8 |
| ADR-011 | Client- og plattformstack-defaulter | Accepted | Master §4.1 (hadde ikke ADR) |
| ADR-012 | Dokumentharmonisering: valgantal og gratisverdenskvote | Accepted | Løser Master FR-04 vs Contract §5 |
| ADR-013 | Målesemantikk: førstespill og NFR-02-tid | Accepted | Løser Master §1/§2.1 vs NFR-02 |
| ADR-014 | Slettings- og retensjonsarkitektur for world_events | Proposed (juridisk gate) | Løser Master §4.4-open position |
| ADR-015 | Avledde projeksjonstabeller: world_facts, offered_choices, audit- og loggtabeller | Accepted | Contract §3 mangler tabeller for fakta og tilbudte valg |
| ADR-016 | node:http-adapter, transportvokabular og dev-autentiseringsport | Accepted | Løser ADR-011 (NestJS) vs §11; §11 gir ikke klienten actorIdentityId |
| ADR-017 | narrasjonsadapter mot en OpenAI-kompatibel gateway | Accepted | Implementerer §10/ADR-008; §10 sier ikke hva som er en providerfeil |
| ADR-018 | Innrapporteringsrute og deterministisk modereringsport | Accepted | §15 krever rapport og moderering; §11 har kun ti ruter |
| ADR-019 | `rulepackId` i verdenslisten | Accepted | §11 lister bare `worldId`; UI07 skal ikke vise en rå id |
| ADR-020 | Rate limit-bøtten legges i PostgreSQL og deles på tvers av prosesser | Accepted | Endrer ADR-016 §5; `SECURITY.md` F-S6 |
| ADR-021 | Frøet per prosess er en trekning, og et verdenhodet fås bare av eieren sin | Accepted | Løser ADR-016s åpne pointer om id-kilde; den navnløse 500-en i `STATUS.md` «Kapasitet» |
| ADR-022 | Scenens intervall håndheves av motoren: øvre tak, gulv og ingen låst spiller | Accepted | Løser ADR-012: intervallet 2–4 var et løfte uten vakt |
| ADR-023 | Valgt tid og rolle åpner verden: blåtrykken er pipeline, ikke kanonisk state | Accepted | Løser Master US03 vs Contract §12: valget ble validert og så sett bort fra |

Registreringsdato: 2026-10-11. ADR-001–010 var vedtaksinnhold i Master §4.5 uten fildokumentasjon; de formaliseres her som indexoppføringer med kilde. ADR-011–015 er nye og beskrevet i egne filer. ADR-016 er registrert 2026-10-12 sammen med server-, auth- og worker-implementasjonen, ADR-017 samme dag sammen med narrasjonsadapteren, og ADR-018 samme dag sammen med modereringsporten og FR-11-rapporten. ADR-019 er registrert 2026-10-12 etter første kjøring av mobilappen på en Android-emulator. ADR-020 er registrert 2026-10-12 etter Sprint 6: F-S6-målingen viste at ADR-016 §5s per-prosess-bøtte ga én konto N kvoter bak N instanser, og den beslutningen erstattes der. ADR-021 er registrert 2026-10-12 etter at 500-en i NFR-12-målingen ble reprodusert: to prosesser med klokka som frø delte hele id-rommet. ADR-022 er registrert 2026-10-15 sammen med tilbudsreglene i motoren: ADR-012 vedtok intervallet 2–4, men ingen holdt det, og målt brøt Glass Harbor det i begge ender (5 tilbud og 1 tilbud). ADR-023 er registrert samme dag: oppsettsskjermens valgte tid og rolle ble validert og deretter ignorert av `createWorld`, som åpnet alle verdener på §12s referanseverdier.
