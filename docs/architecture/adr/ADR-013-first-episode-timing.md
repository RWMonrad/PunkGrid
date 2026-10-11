# ADR-013 — Målesemantikk: førstespill og NFR-02-tid

**Status:** Accepted (2026-10-11)

**Avvik:** Master §1/§2.1: «førstegangsspill innen 3 minutter (p75)». Master NFR-02: «p75 < 20 s etter opprettelse» til første scene. Uten definert tidsvindue kan telemetrien måle to ulike ting og påstå samme måloppfyllelse.

**Beslutning:**
- **NFR-02 (systemlatens):** tid fra `world.create`-commit til åpningsepisode er `published` **eller** `fallback`-publisert. Mål p75 < 20 s. Måles av `episode_generation_finished`.
- **Aktiveringsandel (produktmetric):** tid fra `app_opened` (første install-økt) til første `choice_committed`. Mål p75 < 180 s. Kalles «first playable ≤3 min».
- De to målekalrene rapporteres hver for seg; «3 minutter» brukes aldrig som latensmåle og «20 s» brukes aldri som aktiveringsmål.

**Konsekvens:** FR-14/NFR-02-instrumenteringen får to distinkte tidsserier; §8-konverteringsanalysen er entydig.
