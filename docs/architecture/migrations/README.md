# Migrasjoner — kanonisk datamodell

SQL for PostgreSQL 15+ som realiserer datamodellen i
`docs/architecture/REALITY_ENGINE_CORE_CONTRACT_v1.0.md` §3. Invarianter bygges
inn i skjemaet slik at et avvik blir umulig, ikke bare uønsket.

**Kjør i denne rekkefølgen:**

| Fil | Innhold |
|---|---|
| `001_types.sql` | `punkgrid`-schema, enum-typer for de 13 kanoniske hendelsestypene og de 7 kommandotypene |
| `002_worlds.sql` | `users`, `identities`, `worlds`, `world_memberships`, `world_blueprints` — én aktiv eier per verden, `version >= 0` |
| `003_cast.sql` | `characters`, `relationships`, `story_arcs`, `world_facts`, `character_knowledge`, `offered_choices` — sam-verden-integritet via sammensatte FK-er |
| `004_ledger.sql` | `world_events`, `world_snapshots` — append-only-triggere og sekvenskontroll |
| `005_commands.sql` | `commands` med idempotens og `expected_world_version`; utsettbar FK fra hendelser til kommando |
| `006_narrative.sql` | `narrative_episodes`, `generation_runs`, `outbox_jobs` — publisert prosa er uforanderlig, kostnad registrert per kjøring |
| `007_jobs_and_accounting.sql` | `scheduled_events`, `entitlements`, organisasjonsplassholdere for B, `deletion_audit` (ADR-014), `operation_log` (§15, ADR-013) |
| `008_rls.sql` | Roller, grants og RLS-skjelett — lesetilgang for `punkgrid_app`, kun worker og owner skriver |
| `validate_invariants.sql` | Negative kontroller: 17 blokker som må bli avvist, + RLS-positiver. Rullerer selv tilbake |

## Hva invariantene faktisk håndhever

- **Samme verden eller ingenting.** `characters` har `PRIMARY KEY (world_id, id)`,
  og `relationships`, `character_knowledge`, `world_facts` og `world_events`
  peker på den sammensatte nøkkelen. En rad kan ikke referere en karakter i en
  annen verden (goldentest T11) uten at databasen sier nei. I tillegg har every
  verdenstabell — unntatt `deletion_audit` — en FK på `world_id` til `worlds` med
  `ON DELETE CASCADE`, slik at sletting av en verden ikke kan etterlate seg rader
  (blokkkontroll 17).
- **Append-only hendelseslogg.** `BEFORE UPDATE OR DELETE`-trigger på
  `world_events` og `world_snapshots` kaster feil for alle roller. Rettinger er
  kompensasjonshendelser, aldri redigering på stedet (§3).
- **Sekvensdisciplin.** `world_events_seq_continues` nekte hull: første
  hendelse må ha `world_seq = 1`, deretter nøyaktig +1 per hendelse.
- **Versjon per kommandobatch.** `worlds.version` økes én per vellykket batch,
  `world_seq` én per hendelse. `world_snapshots` har `PRIMARY KEY (world_id,
  version)`, så en dobbel snapshot for samme versjon er umulig.
- **Idempotens.** `commands` har `UNIQUE (world_id, command_id)`;
  `request_hash` er kolonnen handleren sammenligner for
  `IDEMPOTENCY_PAYLOAD_MISMATCH`.
- **Tre ur atskilt.** `worlds.world_time` (kanonisk) og `recorded_at` /
  `created_at` (veggur) er egne kolonner; `occurred_world_time` på hendelser er
  kanonisk (§8, ADR-010).
- **Ingen AI-skriverett.** `generation_runs`, `entitlements` og `deletion_audit`
  får `REVOKE UPDATE, DELETE`; narrasjon har ingen write-policy for
  `punkgrid_app` (§1.4).
- **Functioner låser sitt eget søkebane.** Alle trigger- og policy-functioner
  er erklært med `SET search_path = punkgrid, public`. En trigger kjører med
  sesjonens søkebane, så en ukvalifisert tabellreferanse ellers kan løses mot
  `public` avhengig av hvilken rolle som koblet seg til — det er hvordan et
  tilsynelatende sunt skjema kan gi `relation "world_events" does not exist`.
  Tilkoblingslaget setter i tillegg søkebanen som et startparameter (§1.4) slik
  at en ny forbindelse er korrekt konfigurert før sitt første statement.

## Kjøremåte

Migrasjonene kjøres med Node-løperen i `core/scripts/migrate.ts` — den trenger
ingen `psql` på verten, og fører tilsynsbok i
`public.punkgrid_migrations` med SHA-256-sum per fil. En fil som er endret
etter at den ble anvendt, stopper løkka med `Migration <file> has changed since
it was applied`; skjemaet blir aldri halvt oppgradert.

```powershell
# fra repo-rot — forbindelses-URLen lest fra miljøet, ingen psql på verten
npm run build
$env:PUNKGRID_DB_URL = "postgresql://<bruker>:<pass>@<vert>:5432/<db>"
node dist/core/scripts/migrate.js
node dist/core/scripts/migrate.js --dry-run   # viser anvendt/pending med sjekksum
```

De negative kontrollene kjøres med `psql` som superbruker, i én transaksjon som
rullerer tilbake selv:

```powershell
psql "postgresql://<bruker>:<pass>@<vert>:5432/<db>" -v ON_ERROR_STOP=1 -1 `
  -f docs/architecture/migrations/validate_invariants.sql
```

## Kjørt og verifisert (2026-10-12)

Alle åtte filene er kjørt på PostgreSQL 16 i den kastbare Docker-beholderen
(`punkgrid-pg`, vertspor 54330), anvendt fra `public`-schema og
`punkgrid`-schema i sin egen transaksjon via Node-løperen. `003_cast.sql` ble
rettet etter første kjøring (FK på `world_facts.world_id`), og `004`, `006` og
`008` fikk `SET search_path`; skjemaet ble derfor droppet og gjenoppbygget fra
fil 001, som er den korrekte måten å håndheve sjekksumloggen på. Ingen data har
eksistert utenfor denne beholderen.

`validate_invariants.sql` er det negative kontrollsettet: ett fixture-avsnitt
(2 verdener, 1 eiermedlemskap, 3 karakterer, 1 kommando / 1 hendelse / 1
snapshot, 1 faktum + 1 kunnskapsrad) og deretter 17 blokker som **må** bli
avvist. Hver blokk fanger en forventa feilkategori og skriver en
`NOTICE: ok N`; en manglende NOTICE er et hull i skjemaet.

Siste kjøring ga 22 `ok`-meldinger og en `ROLLBACK`:

| Blokk | Avvist |
|---|---|
| 1–3 | delt verden i v1, andre aktiv eier, lånt identitet |
| 4a–4c | selvrelasjon, karakter fra en annen verden, karakter-identitet uten medlemskap i verden |
| 5–6 | trust 140 utenfor intervall, faktum på tvers av verdener |
| 7a–7c | UPDATE/DELETE i hendelseslogg, UPDATE i snapshot-tabellen |
| 8–11 | `world_seq`-hull, ukjent hendelsestype, foreldreløs hendelse, episode for ubekreftet versjon |
| 12–13 | redigering av publisert episode, lease-løs claiming av jobb |
| 14–16 | RLS: ikke-medlem ser 0 rader, medlem ser kun `w_one`, tom `app.user_id` gir 0 rader, `punkgrid_app` verken skriver logg eller kjøper egen plan |
| 17 | verdenstabell uten FK på `world_id` — den hullet ga gevant-rader som overlevde sin egen verden |

## Gjenstående før produktionsbruk

- **Skyen er ikke provisionert.** Supabase-prosjektet er åpnet i nettleseren,
  men oppretting av prosjekt og nøkler er en kostnads- og tilstandsendring som
  krever din godkjenning først. Invariantene over er kontrollert mot lokalt
  PostgreSQL 16, ikke mot den utplasserte databasen.
- **Roller er `NOLOGIN`.** RLS-blokkene bytter rolle med `SET LOCAL ROLE` som
  superbruker. En utplassert tjener må kobles med `punkgrid_app` (lesing) og
  `punkgrid_worker` (outbox), ikke med superbrukeren som testingen bruker.
