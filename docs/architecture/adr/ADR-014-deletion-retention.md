# ADR-014 — Slettings- og retensjonsarkitektur for world_events

**Status:** Proposed — teknisk design vedtatt; juridisk godkjenning (Privacy/Legal) er gate før implementasjon i F15.

**Åpent position (Master §4.4):** sletting av hendelseslogg vs. audit-krav var reist, ikke besluttet, mens Master AC-07 forutsetter en «publisert policy» og Contract §3 krever at persondata fjernes/anonymiseres ved brukersletting.

**Beslutning (anbefalt standardvalg):**
1. Brukerinitiert sletting av privat A-verden = **hard deletion** (eller kryptografisk sletting av nøkler, crypto-shredding) av `world_events`, `world_snapshots`, `narrative_episodes`, `characters`, `relationships`, `character_knowledge`, `world_blueprints`, tilhørende `commands` og PII-bærende `generation_runs` — innen 30 dager, med verifiserbar utførselslogg.
2. **Audit-post** er den eneste gjengivenheten: `account_id`, `world_id` (pseudonym), handlingstidspunkt, utfallskode. Ingen historietekst, ingen NPC-/fakturndata —oppfyller appbutikk- og sikkerhetsrevisjonsbehov uten persondata.
3. Abstraksjonen `DeletionService` isolerer simuleringsdomenet fra account-livssyklus; B (delte verdener) krever ny ADR før pilot, per Contract §15/Master §9.5.

**Konsekvens:** AC-07 blir testbar mot denne policyen; Contract §3-invarianten «world simulations are not an excuse to retain identifying records» er oppfylt per konstruksjon.
