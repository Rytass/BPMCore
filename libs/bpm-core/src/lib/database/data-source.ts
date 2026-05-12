import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptionsFromVaultEnv } from './typeorm.config';

export default buildDataSourceOptionsFromVaultEnv(process.env).then(
  (options) => new DataSource(options),
);
