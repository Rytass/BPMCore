import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { DataSourceOptions } from 'typeorm';

const DEFAULT_PORT = 5432;
const DEFAULT_VAULT_PATH = 'bpm_core/develop';

interface DatabaseSecrets {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly database: string;
  readonly schema: string;
}

interface VaultJsonResponse {
  readonly data?: unknown;
  readonly auth?: unknown;
}

export async function buildTypeOrmModuleOptions(
  vault: VaultService,
): Promise<TypeOrmModuleOptions> {
  const secrets = await readDatabaseSecretsFromVaultService(vault);

  return {
    ...buildDataSourceOptions(secrets),
    autoLoadEntities: true,
    migrations: [],
  };
}

export async function buildDataSourceOptionsFromVaultEnv(
  env: NodeJS.ProcessEnv,
): Promise<DataSourceOptions> {
  return buildDataSourceOptions(await readDatabaseSecretsFromVaultEnv(env));
}

function buildDataSourceOptions(secrets: DatabaseSecrets): DataSourceOptions {
  return {
    database: secrets.database,
    entities: [],
    host: secrets.host,
    migrations: ['apps/api/src/migrations/*.ts'],
    migrationsRun: false,
    password: secrets.password,
    port: secrets.port,
    schema: secrets.schema,
    synchronize: false,
    type: 'postgres',
    username: secrets.username,
  };
}

async function readDatabaseSecretsFromVaultService(
  vault: VaultService,
): Promise<DatabaseSecrets> {
  const port = await vault.get<string>('DB_PORT');

  return {
    database: await readRequiredVaultValue(vault, 'DB_NAME'),
    host: await readRequiredVaultValue(vault, 'DB_HOST'),
    password: await readRequiredVaultValue(vault, 'DB_PASS'),
    port: parseDatabasePort(port),
    schema: await readRequiredVaultValue(vault, 'DB_SCHEMA'),
    username: await readRequiredVaultValue(vault, 'DB_USER'),
  };
}

async function readRequiredVaultValue(
  vault: VaultService,
  key: string,
): Promise<string> {
  const value = await vault.get<string>(key);

  if (!value) {
    throw new Error(`Missing required Vault secret: ${key}`);
  }

  return value;
}

async function readDatabaseSecretsFromVaultEnv(
  env: NodeJS.ProcessEnv,
): Promise<DatabaseSecrets> {
  const vaultHost = readRequiredEnv(env, 'VAULT_HOST');
  const vaultAccount = readRequiredEnv(env, 'VAULT_ACCOUNT');
  const vaultPassword = readRequiredEnv(env, 'VAULT_PASSWORD');
  const vaultPath = env.VAULT_PATH ?? DEFAULT_VAULT_PATH;
  const vaultToken = await loginVault(vaultHost, vaultAccount, vaultPassword);
  const secrets = await readVaultKvSecret(vaultHost, vaultToken, vaultPath);

  return {
    database: readRequiredSecret(secrets, 'DB_NAME'),
    host: readRequiredSecret(secrets, 'DB_HOST'),
    password: readRequiredSecret(secrets, 'DB_PASS'),
    port: parseDatabasePort(readOptionalSecret(secrets, 'DB_PORT')),
    schema: readRequiredSecret(secrets, 'DB_SCHEMA'),
    username: readRequiredSecret(secrets, 'DB_USER'),
  };
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

async function loginVault(
  vaultHost: string,
  account: string,
  password: string,
): Promise<string> {
  const response = await fetch(
    `${trimTrailingSlash(vaultHost)}/v1/auth/userpass/login/${account}`,
    {
      body: JSON.stringify({ password }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );

  if (!response.ok) {
    throw new Error(`Vault login failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as VaultJsonResponse;
  const auth = payload.auth;

  if (!isRecord(auth) || typeof auth.client_token !== 'string') {
    throw new Error('Vault login response did not include a client token');
  }

  return auth.client_token;
}

async function readVaultKvSecret(
  vaultHost: string,
  token: string,
  path: string,
): Promise<Readonly<Record<string, string>>> {
  const response = await fetch(
    `${trimTrailingSlash(vaultHost)}/v1/secret/data/${path}`,
    {
      headers: { 'X-Vault-Token': token },
      method: 'GET',
    },
  );

  if (!response.ok) {
    throw new Error(`Vault secret read failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as VaultJsonResponse;
  const data = payload.data;

  if (!isRecord(data) || !isRecord(data.data)) {
    throw new Error('Vault KV response did not include secret data');
  }

  return Object.entries(data.data).reduce<Readonly<Record<string, string>>>(
    (accumulator, [key, value]) => ({
      ...accumulator,
      ...(typeof value === 'string' ? { [key]: value } : {}),
    }),
    {},
  );
}

function readRequiredSecret(
  secrets: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = secrets[key];

  if (!value) {
    throw new Error(`Missing required Vault secret: ${key}`);
  }

  return value;
}

function readOptionalSecret(
  secrets: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  return secrets[key];
}

function parseDatabasePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    return DEFAULT_PORT;
  }

  return port;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
