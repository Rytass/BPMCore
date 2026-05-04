import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { HealthController } from '../health/health.controller';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationModule } from '../organization/organization.module';
import { FormModule } from '../form/form.module';
import { TemplateModule } from '../template/template.module';
import { buildTypeOrmModuleOptions } from '../database/typeorm.config';
import { SystemResolver } from '../system/system.resolver';

@Module({
  imports: [
    VaultModule.forRoot({
      path: process.env.VAULT_PATH ?? 'bpm_core/develop',
    }),
    TypeOrmModule.forRootAsync({
      imports: [VaultModule],
      inject: [VaultService],
      useFactory: buildTypeOrmModuleOptions,
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      autoSchemaFile: true,
      driver: ApolloDriver,
      introspection: process.env.NODE_ENV !== 'production',
      path: '/graphql',
      playground: false,
      sortSchema: true,
    }),
    IdentityModule,
    OrganizationModule,
    FormModule,
    TemplateModule,
  ],
  controllers: [HealthController],
  providers: [SystemResolver],
})
export class AppModule {}
