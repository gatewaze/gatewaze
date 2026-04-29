# Backups & Restore Runbook

**Spec ref:** [§5.5](../../../gatewaze-environments/specs/spec-production-readiness-hardening.md)
**RPO target:** 5 min (k8s) / best-effort (Docker compose)
**RTO target:** 4 h

## Topologies

| Topology | Mechanism | Validation cadence |
|---|---|---|
| Supabase Cloud | Native PITR (already on) | Quarterly restore drill into a staging project |
| Self-hosted k8s | `pgbackrest` daily full + 5-min WAL → S3 | **Weekly** automated restore-validation Job |
| Docker compose | `pg_dump` nightly to a host volume | Manual quarterly restore |

## Self-hosted k8s — enable

```yaml
# values.yaml
backup:
  enabled: true
  postgres:
    host: supabase-db.svc.cluster.local
    secretName: postgres-backup-secret  # contains key `password`
  s3:
    bucket: gatewaze-backups
    endpoint: s3.amazonaws.com
    region: eu-west-1
    secretName: s3-backup-secret  # contains `access_key`, `secret_key`
  validation:
    enabled: true
```

Two CronJobs are templated:

- `<release>-backup` — daily at 02:00 UTC. Runs `pgbackrest backup`.
- `<release>-backup-validation` — weekly Sunday 03:00 UTC. Restores
  the latest backup into a temp namespace and runs a smoke test
  (counts on `platform_settings`, `accounts`, `events`, `people`).

Validation alerts fire via the Prometheus alert
`BackupValidationFailed` (defined in the `monitoring` module).

## Docker compose — enable

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.backup.yml \
  up -d
```

Env vars: `BACKUP_DIR` (host path), `BACKUP_SCHEDULE` (cron, default
`0 2 * * *`).

## Restore — k8s

1. Provision a *new* Postgres cluster (or use a maintenance namespace).
2. Run `pgbackrest --stanza=gatewaze restore --target=immediate`.
3. Verify with the same smoke-test queries the validation Job runs.
4. Cut over the API/worker/scheduler `DATABASE_URL` to the restored
   cluster. Update Helm values + `helm upgrade`.

## Restore — Docker compose

```bash
# Stop the API stack so writes don't race.
docker compose stop gatewaze-api gatewaze-worker gatewaze-scheduler

# Restore the latest dump into the existing supabase-db.
DUMP=$(ls -t ${BACKUP_DIR:-./backups}/gatewaze-*.dump | head -1)
docker compose exec -T supabase-db \
  pg_restore -U postgres -d postgres --clean --if-exists < "$DUMP"

docker compose start gatewaze-api gatewaze-worker gatewaze-scheduler
```

## Drill cadence

| Frequency | Action |
|---|---|
| Daily | Verify `<release>-backup` Job last status = Success |
| Weekly | `<release>-backup-validation` runs automatically |
| Quarterly | Full restore-from-cold drill into a fresh cluster |

A drill is "successful" when the smoke test passes and the platform
boots cleanly under load (synthetic Playwright run completes).
