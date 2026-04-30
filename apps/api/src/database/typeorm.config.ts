import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';

const DEFAULT_PORT = 5432;

export function buildTypeOrmModuleOptions(): TypeOrmModuleOptions {
  return {
    ...buildDataSourceOptions(process.env),
    autoLoadEntities: true,
  };
}

export function buildDataSourceOptions(
  env: NodeJS.ProcessEnv,
): DataSourceOptions {
  return {
    database: env.DB_NAME ?? 'bpm',
    entities: [],
    host: env.DB_HOST ?? 'localhost',
    migrations: ['apps/api/src/migrations/*.ts'],
    migrationsRun: false,
    password: env.DB_PASSWORD ?? 'bpm',
    port: parseDatabasePort(env.DB_PORT),
    schema: env.DB_SCHEMA ?? 'public',
    synchronize: false,
    type: 'postgres',
    username: env.DB_USER ?? 'bpm',
  };
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
