# Migrasjoner — kanonisk datamodell

SQL for PostgreSQL 15+ som realiserer datamodellen i
`docs/architecture/REALITY_ENGINE_CORE_CONTRACT_v1.0.md` §3. Invarianter bygges
inn i skjemaet slik at et avvik blir umulig, ikke bare uønsket.

**Kjør i denne rekkefølgen:**

| Fil | Innhold |
|---|---|
| `001_types.sql` | `punkgrid`-schema, enum-typer for de 13 kanoniske hendelsestypene og de 7 kommandotypene |
| `002_worlds.sql` | `users`, `identities`, `worlds`, `world_memberships`, `world_blueprints` — én aktiv eier per verden, `version >= 0` |
| `003_cast.sql` | `characters`, `relationships`, `story_arcs`, `world_facts`, `character_knowledge`, `offered_choices` — sam-verden-integritet via sammensatte FK-er. `story_arcs` fikk ikke sammensatt nøkkel der; den kommer i `011` |
| `004_ledger.sql` | `world_events`, `world_snapshots` — append-only-triggere og sekvenskontroll |
| `005_commands.sql` | `commands` med idempotens og `expected_world_version`; utsettbar FK fra hendelser til kommando |
| `006_narrative.sql` | `narrative_episodes`, `generation_runs`, `outbox_jobs` — publisert prosa er uforanderlig, kostnad registrert per kjøring |
| `007_jobs_and_accounting.sql` | `scheduled_events`, `entitlements`, organisasjonsplassholdere for B, `deletion_audit` (ADR-014), `operation_log` (§15, ADR-013) |
| `008_rls.sql` | Roller, grants og RLS-skjelett — lesetilgang for `punkgrid_app`, kun worker og owner skriver |
| `009_moderation.sql` | `moderation_cases` (FR-11 / US13, §15, ADR-018) — kvittering på en rapport ved siden av kanon: ingen versjonsendring, begrenset utdrag i stedet for episodelegeme, RLS + egne grants |
| `010_rate_limit.sql` | `rate_limit_bucket` + `punkgrid_rate_limit_take()` — token bucket delt på tvers av prosesser (`SECURITY.md` F-S6). Én rad per nøkkel, databaseklokke via `statement_timestamp()`, `SELECT … FOR UPDATE`, og en funksjon uten `SECURITY DEFINER` (målt som `prosecdef = f`) slik at grantene er grensen. Den eneste tabellen kjørebanen skriver til |
| `011_arc_identity_per_world.sql` | `story_arcs` får `PRIMARY KEY (world_id, id)`. Arc-id-ene kommer fra regelverkstemplaten (`arc_acquisition`, …), så med globale nøkler fra 003 skrev hver nye verden over den forriges tre rader. De urealiserbare radene slettes og bygges på nytt per verden fra det siste snapshotet, med `resolved_by_event_id` fra `story_arc.closed` |
| `validate_invariants.sql` | Negative kontroller: 20 blokker som må bli avvist, + RLS-positiver. 30 `ok`-meldinger ved siste kjøring. Rullerer selv tilbake |

## Hva invariantene faktisk håndhever

- **Samme verden eller ingenting.** `characters` har `PRIMARY KEY (world_id, id)`,
  og `relationships`, `character_knowledge`, `world_facts` og `world_events`
  peker på den sammensatte nøkkelen. En rad kan ikke referere en karakter i en
  annen verden (goldentest T11) uten at databasen sier nei. `story_arcs` har selv
  `PRIMARY KEY (world_id, id)` fra 011: arc-id-ene er templategier som går igjen
  i hver verden, så en global nøkkel der var det samme som å la verden A eie
  verdens B tilstand. I tillegg har hver
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
ikke `psql` på verten, og fører tilsynsbok i
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
(`punkgrid-pg`, vertspor 54330), hver for seg i sin egen transaksjon via
Node-løperen. `003_cast.sql` ble rettet etter første kjøring (FK på
`world_facts.world_id`), og `004`, `006` og `008` fikk `SET search_path`;
skjemaet ble derfor droppet og gjenoppbygget fra fil 001, som er den korrekte
måten å håndheve sjekksumloggen på. Ingen data har eksistert utenfor denne
beholderen.

**011 ble kjørt 2026-10-12 og er målt, ikke antatt.** Etter kjøring på
dev-skjemaet (`punkgrid`, vertspor 54330) peker `story_arcs_pkey` på
`(world_id, id)` — målt som `indexdef` fra `pg_indexes` — og gjenoppbyggingen ga
verden `world_BE5XFF9ZS70001` sine tre arcs med status **fra snapshotet, ikke
fra templaten**: `arc_staff_security` kom tilbake som `open`, mens malen sier
`locked`. Testen `keeps every world-bound row inside its own world` i
`core/tests/pg.test.ts` måler 3 + 3 rader på to verdener og 6 ulike nøkler i
`Store.arcs`. Falsifisert ved å reversere lastenykkelen i
`core/src/db/pgStore.ts:168`: testen feiler da med `expected 3 to be 6`.

`validate_invariants.sql` er det negative kontrollsettet: ett fixture-avsnitt
(2 verdener, 1 eiermedlemskap, 3 karakterer, 1 kommando / 1 hendelse / 1
snapshot, 1 faktum + 1 kunnskapsrad) og deretter 20 blokker som **må** bli
avvist. Hver blokk fanger en forventa feilkategori og skriver en
`NOTICE: ok N`; en manglende NOTICE er et hull i skjemaet.

Siste kjøring (2026-10-12) ga 30 `ok`-meldinger, exit 0 og en `ROLLBACK` — det
er i tillegg målt at tabellene har likt radtal før og etter (29 i
`worlds`+`world_events`+`moderation_cases`+`users`+`narrative_episodes`), så
fixture-radene ikke lekker ut i dev-skjemaet. Antall rader før avhenger av hva
som ligger igjen fra forrige kjøring; det som måles, er likheten:

| Blokk | Avvist |
|---|---|
| 1–3 | delt verden i v1, andre aktiv eier, lånt identitet |
| 4a–4c | selvrelasjon, karakter fra en annen verden, karakter-identitet uten medlemskap i verden |
| 5–6 | trust 140 utenfor intervall, faktum på tvers av verdener |
| 7a–7c | UPDATE/DELETE i hendelseslogg, UPDATE i snapshot-tabellen |
| 8–11 | `world_seq`-hull, ukjent hendelsestype, foreldreløs hendelse, episode for ubekreftet versjon |
| 12–13 | redigering av publisert episode, lease-løs claiming av jobb |
| 14–16 | RLS: ikke-medlem ser 0 rader, medlem ser kun `w_one`, tom `app.user_id` gir 0 rader, `punkgrid_app` verken skriver logg eller kjøper egen plan |
| 17 | verdenstabell uten FK på `world_id` — hullet som lot rester fra en tidligere kjøring overleve sin egen verden |
| 18a–18b | `moderation_cases`: FK på (world_id, episode_id) og unik `command_id` |
| 19a–19b | utdrags- og notatlengder, `reviewed_at` som følgesvenn av lukket status |
| 20a–20d | RLS for moderering: medlem ser saken, ikke-medlem ser 0 rader, verken `punkgrid_app` eller `punkgrid_worker` kan skrive eller lukke en sak |

### Vaktorden i ledger: hva som faktisk stopper en endring

008_rls.sql sier at «append-only-utløserne i 004 slår inn før rettigheter
spørres». Det er ikke det som måles (`SET LOCAL ROLE`, 2026-10-12, dokumentert i
`docs/qa/SECURITY.md` F-S4):

* `punkgrid_app` har bare SELECT i grant-listen for kanon, så ethvert skriv dit
  svarer 42501 *før* noen policy i det hele tatt blir spørsmål. Unntaket er
  `rate_limit_bucket` fra 010, som er driftstilstand og ikke kanon: der har
  `punkgrid_app` `arw` (verken `D` eller `T`) og tar bare bøtten gjennom
  `punkgrid_rate_limit_take()`. Målt i `core/tests/pg.test.ts:888`.
* `punkgrid_worker` har SELECT/INSERT/UPDATE, men ingen policy for noen
  kommandotype. RLS skjuler da alle radene: en `UPDATE` på `world_events` er
  **ingen feil** — den lyktes med 0 rader og endret ingenting. `DELETE` er 42501
  fra grant-listen. En `INSERT` kommer seg forbi, fordi en INSERT uten policy
  ikke har noen `WITH CHECK`-uttrykk å feile.
* `punkgrid_owner` eier tabellene og går forbi RLS ved eierskap. Det er bare
  utløserne i 004/006 som stopper den — og det er den eneste grunnen til at
  historien ikke kan skrives om.

Kommentaren i 008 er **ikke** rettet: `migrate.ts:58-60` låser anvendte
migrasjoner med checksum, så selv en kommentarredigering ville nektet
`npm run migrate` mot en database som allerede har 008. Notatet ovenfor er
derfor den korrekte beskrivelsen. Rettelsen må komme som en ny migrasjon som
legger til INSERT/UPDATE-policy for tjenesteidentiteten eller `FORCE ROW LEVEL
SECURITY` — og uansett sammen med `assumeRole`/`app.user_id` i kjørebanen.

## Gjenstående før produktionsbruk

- **Skyen er ikke provisionert.** Supabase-prosjektet er åpnet i nettleseren,
  men oppretting av prosjekt og nøkler er en kostnads- og tilstandsendring som
  krever din godkjenning først. Invariantene over er kontrollert mot lokalt
  PostgreSQL 16, ikke mot den utplasserte databasen.
- **Roller er `NOLOGIN`.** RLS-blokkene bytter rolle med `SET LOCAL ROLE` som
  superbruker. En utplassert tjener må kobles med `punkgrid_app` (lesing) og
  `punkgrid_worker` (outbox), ikke med superbrukeren som testingen bruker.
