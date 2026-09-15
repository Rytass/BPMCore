# Infrastructure

## Environments

| Item       | develop            | staging                        |
| ---------- | ------------------ | ------------------------------ |
| Vault path | `bpm_core/develop` | `bpm_core/staging`             |
| DB name    | `bpm_core`         | `bpm_core`                     |
| DB schema  | `bpm_core_develop` | `bpm_core_staging`             |
| DB user    | `bpm_core_develop` | `bpm_core_staging`             |
| Deployment | local development  | `bpm-core-staging` namespace   |
| DNS        | none               | `bpm-core-staging.rytass.info` |

Local development uses the develop Vault secret and the
`bpm_core_develop` database schema. The application no longer reads `.env` or
`.env.local`; export the Vault login variables in the shell before running API
or migration commands.

## Local Vault Variables

```bash
export VAULT_HOST="https://vault.rytass.org"
export VAULT_ACCOUNT="<your-vault-account>"
export VAULT_PASSWORD="<your-vault-password>"
export VAULT_PATH="bpm_core/develop"
```

## Cloud SQL Bootstrap

Generate separate random passwords for `bpm_core_develop` and
`bpm_core_staging`, then run the SQL template with psql variables:

```bash
PGPASSWORD="<dbfather-password>" psql \
  -h 35.234.47.64 \
  -U dbfather \
  -d postgres \
  -v bpm_core_develop_password="'<develop-password>'" \
  -v bpm_core_staging_password="'<staging-password>'" \
  -f tools/cloud-sql-bootstrap.sql
```

## Vault Keys

Use `tools/vault-secrets.example.json` as the Vault DB key list. Do not commit
real secret values. The BPM core TypeORM helpers read `DB_HOST`, `DB_PORT`,
`DB_USER`, `DB_PASS`, `DB_NAME`, `DB_SCHEMA`, and `DB_SYNC` from the selected
Vault path.

The wrapper API host also reads Kubernetes environment variables from
`vault-secret` for runtime-only settings that are not part of the reusable BPM
module:

| Variable                            | Used by                          | Purpose                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_SESSION_SECRET`                | `apps/api`                       | HMAC secret for the signed login cookie.                                                                                                                                                                                                                                                                             |
| `BPM_API_PUBLIC_URL`                | `apps/api`                       | Public origin for signed attachment URLs.                                                                                                                                                                                                                                                                            |
| `BPM_ATTACHMENT_SIGNING_SECRET`     | `libs/bpm-core` via host options | HMAC secret for attachment download/preview URLs.                                                                                                                                                                                                                                                                    |
| `BPM_DEMO_WEBHOOK_SIGNING_SECRET`   | `apps/api` (develop only)        | Signing secret shared by the demo notify webhook endpoints and their receiver; read from the Vault path first, then this variable, then a local default. Not needed on staging, which runs `NODE_ENV=production` where the demo endpoints are not registered (and `staging:reset` skips the webhook demo templates). |
| `BPM_WEBHOOK_SECRET_ENCRYPTION_KEY` | `libs/bpm-core` via host options | 32-byte key (64 hex or base64) that encrypts header values and signing secrets of database-managed webhook endpoints. Required outside develop to enable them; back it up separately from the database.                                                                                                              |
| `BPM_WEBHOOK_ALLOWED_URL_PATTERNS`  | `libs/bpm-core` via host options | Comma-separated URL patterns database-managed webhook endpoints may call. Empty in production means those endpoints stay disabled; develop defaults to the local demo receiver.                                                                                                                                      |
| `OPENAI_API_KEY`                    | `apps/client`                    | Designer AI assistant LLM key (optional).                                                                                                                                                                                                                                                                            |
| `BPM_AI_ASSISTANT_ENABLED`          | `apps/client`                    | `'true'` to show the designer AI assistant.                                                                                                                                                                                                                                                                          |

### Rotating `BPM_WEBHOOK_SECRET_ENCRYPTION_KEY`

The key encrypts every database-managed webhook endpoint's header values and
signing secret, and BPM keeps no second key to fall back on. Losing it loses
those values; replacing it without re-entering them makes every database
endpoint delivery fail to build its request. At boot BPM decrypts one stored
value and logs an error if the configured key cannot, so a wrong key shows up
in the log at once rather than as failed deliveries.

To rotate:

1. Store the new key next to the old one in Vault; do not delete the old one.
2. In the "Webhook 端點" admin page, note which endpoints have headers or a
   signing secret (the list shows header names and whether a secret is set).
3. Deploy with the new key. Those endpoints now fail with
   `WEBHOOK_BUILD_REQUEST_FAILED` until step 4, so do this in a quiet window.
4. For each endpoint, edit it with "取代 headers" to re-enter the header values
   and use "輪替金鑰" to re-enter the signing secret, then run "測試送出".
5. Resend any delivery that failed in between from the case page, then remove
   the old key.

Back the key up separately from database backups: a database dump alone
cannot recover the values, and one copy of both is a copy of everything.

## Staging Deployment

Staging requires:

```bash
gcloud artifacts repositories create bpm-core \
  --repository-format=docker \
  --location=asia-east1 \
  --project=develop-server

gcloud container clusters get-credentials rytass-cluster \
  --region asia-east1 \
  --project develop-server

kubectl create namespace bpm-core-staging
cp tools/vault-secret-staging.example.yml tools/vault-secret-staging.yml
# Fill real secret values before applying. Do not commit the generated file.
kubectl apply -f tools/vault-secret-staging.yml
kubectl apply -f tools/deployment-staging.yml
```

The client runs behind the same host as the API in staging. Browser endpoint
resolution therefore uses same-origin `/graphql` plus root-level `/auth/...`
and `/attachments/...`; do not set a plain `API_URL` for the client container
because the browser bundle does not read it.

### Designer AI assistant (optional)

The client container in `tools/deployment-staging.yml` already wires
`BPM_AI_ASSISTANT_ENABLED=true` and an `optional` `OPENAI_API_KEY` from
`vault-secret`. To enable the assistant, put the key in the secret:

```bash
kubectl patch secret vault-secret -n bpm-core-staging --type merge \
  --patch-file <(printf '{"stringData":{"OPENAI_API_KEY":"%s"}}' "$OPENAI_API_KEY")
kubectl rollout restart deployment/bpm-core -n bpm-core-staging
```

Because the key is `optional`, the pod stays healthy without it (the toggle then
shows a disabled placeholder). See [AI assistant](./12-ai-assistant.md) for the
full feature and env reference.

The Cloudflare DNS record should be:

| Type | Name               | Content          | Proxied |
| ---- | ------------------ | ---------------- | ------- |
| A    | `bpm-core-staging` | `35.185.155.213` | `true`  |
