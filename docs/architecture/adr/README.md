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

Registreringsdato: 2026-10-11. ADR-001–010 var vedtaksinnhold i Master §4.5 uten fildokumentasjon; de formaliseres her som indexoppføringer med kilde. ADR-011–015 er nye og beskrevet i egne filer.
