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

Use `tools/vault-secrets.example.json` as the key list. Do not commit real
secret values.

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
kubectl apply -f tools/vault-secret-staging.yml
kubectl apply -f tools/deployment-staging.yml
```

The Cloudflare DNS record should be:

| Type | Name               | Content          | Proxied |
| ---- | ------------------ | ---------------- | ------- |
| A    | `bpm-core-staging` | `35.185.155.213` | `true`  |
