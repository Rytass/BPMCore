import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { BPMRootModule } from '@rytass/bpm-core-nestjs-module';
import { buildTypeOrmModuleOptions } from '@rytass/bpm-core-nestjs-module';
import { BPM_MEMBER_RESOLVER } from '@rytass/bpm-core-nestjs-module';
import { BPM_BUSINESS_CALENDAR } from '@rytass/bpm-core-nestjs-module';
import type { Request } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { buildApiBPMAuthContextFromExecutionContext } from './api-auth';
import { ApiAuthModule } from './api-auth.module';
import { ApiSimulationSeedService } from './api-simulation-seed.service';
import { ApiMemberResolver } from './api-member.resolver';
import { ApiSessionService } from './api-session.service';
import { ApiTaiwanBusinessCalendar } from './api-taiwan-business-calendar';

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
      useFactory: (sessionService: ApiSessionService): ApolloDriverConfig => ({
        autoSchemaFile: true,
        context: async ({ req }: { readonly req?: Request }) => ({
          bpmAuthContext:
            await sessionService.readBPMAuthContextFromRequest(req),
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
      imports: [ApiAuthModule],
      attachmentPublicBaseUrl:
        process.env.BPM_API_PUBLIC_URL ??
        process.env.BPM_ATTACHMENT_PUBLIC_BASE_URL,
      attachmentSignedUrlSecret: process.env.BPM_ATTACHMENT_SIGNING_SECRET,
      authContextFactory: buildApiBPMAuthContextFromExecutionContext,
      businessCalendarProvider: {
        provide: BPM_BUSINESS_CALENDAR,
        useClass: ApiTaiwanBusinessCalendar,
      },
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: ApiMemberResolver,
      },
    }),
  ],
  controllers: [AppController],
  // `businessCalendarProvider` uses `useClass`, so BPM instantiates the
  // calendar inside its own module context; it needs no provider entry here.
  providers: [AppService, ApiSimulationSeedService],
})
export class AppModule {}
