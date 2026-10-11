# ADR-011 — Client- og plattformstack-defaulter

**Status:** Accepted (2026-10-11)
**Kontekst:** Master §4.1 fastsatte defaults for flere lag utenfor ADR-registeret §4.5. §9.1 krever at beslutninger styrer implementasjonen via ADR.

**Beslutning:**
- Mobil: React Native + Expo + TypeScript.
- API: TypeScript Node.js; NestJS som default-rammeverk (Fastify tillatt via ny ADR ved behov).
- DB-tilgang: Kysely (default) mot PostgreSQL; migrasjoner versjoneres i `docs/architecture/migrations/`.
- Hosting: AWS `eu-central-1` på managed containerplattform — kommersielt valg er likevel IKKE endelig før DPA/kostnadsgjennomgang (§9.5).
- Analytics: PostHog EU; feil/observability: Sentry + OpenTelemetry; kjøp: RevenueCat + Apple/Google IAP med server-verifisering; IaC: Terraform.

**Konsekvens:** Sprint 0–1 kan starte uten nye stack-spørsmål. Leverandøravtaler gjenstår som kommersiell gate, ikke teknisk blokk.
