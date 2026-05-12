import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { BPMRootModule } from '@bpm/core';
import { buildTypeOrmModuleOptions } from '@bpm/core';
import { BPM_MEMBER_RESOLVER } from '@bpm/core';
import type { Request } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  buildApiBPMAuthContextFromExecutionContext,
  buildApiBPMAuthContextFromRequest,
} from './api-auth';
import { ApiAuthModule } from './api-auth.module';
import { ApiDemoOrganizationSeedService } from './api-demo-organization-seed.service';
import { ApiMemberResolver } from './api-member.resolver';
import { ApiSessionService } from './api-session.service';

@Module({
  imports: [
    ApiAuthModule,
    VaultModule.forRoot({
      path: process.env.VAULT_PATH ?? 'bpm_core/develop',
    }),
    TypeOrmModule.forRootAsync({
      imports: [VaultModule],
      inject: [VaultService],
      useFactory: buildTypeOrmModuleOptions,
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ApiAuthModule],
      inject: [ApiSessionService],
      useFactory: (
        sessionService: ApiSessionService,
      ): ApolloDriverConfig => ({
        autoSchemaFile: true,
        context: ({ req }: { readonly req?: Request }) => ({
          bpmAuthContext:
            sessionService.readBPMAuthContextFromRequest(req) ??
            buildApiBPMAuthContextFromRequest(req),
          req,
        }),
        driver: ApolloDriver,
        introspection: process.env.NODE_ENV !== 'production',
        path: '/graphql',
        playground: false,
        sortSchema: true,
      }),
    }),
    BPMRootModule.forRoot({
      auth: {
        contextFactory: buildApiBPMAuthContextFromExecutionContext,
      },
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useClass: ApiMemberResolver,
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, ApiDemoOrganizationSeedService],
})
export class AppModule {}
