# ADR-012 — Dokumentharmonisering: valgantal og gratisverdenskvote

**Status:** Accepted (2026-10-11)

**Avvik 1 — valgantal.** Master FR-04/§2.1: «2–4 serverutstedte gyldige valg per scene». Contract §5 pipeline steg 5: «3–5 initial choices». Ved avvik gjelder Contract for simuleringsinvarianter, men 2–4 er det produktmessige løftet og er testbar via FR-04.

**Beslutning:** Contract §5 endres til «2–4 initial choices». Ingen parallelle grenser — alle scene- og genesis-valg uses samme 2–4-intervall.

**Avvik 2 — gratisverdenskvote.** Master §2.1: «én aktiv gratisverden», men Contract §5/AC-01 har ingen eksplisitt atomar håndhevelse i Genesis-pipelinen.

**Beslutning:** Sjekk «andel aktive personlige worlds per owner < free-quota fra entitlements» utføres INNERST i `world.create`-transaksjonen, mot samme låste owner-tilstand. Samtidige kall kan aldri overskride kvoten. Feil returnerer `403 WORLD_LIMIT_REACHED` (ny stabil feilkode, additiv). Test: T01/T20-plussuite «N concurrent genesis calls».
