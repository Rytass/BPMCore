import { HttpException, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { unwrapResolverError } from '@apollo/server/errors';
import type { GraphQLFormattedError } from 'graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { BPMRootModule } from '@rytass/bpm-core-nestjs-module';
import { buildTypeOrmModuleOptions } from '@rytass/bpm-core-nestjs-module';
import { BPM_MEMBER_RESOLVER } from '@rytass/bpm-core-nestjs-module';
import { BPM_BUSINESS_CALENDAR } from '@rytass/bpm-core-nestjs-module';
import { BPM_FORM_DATA_SOURCE_REGISTRY } from '@rytass/bpm-core-nestjs-module';
import { BPM_WORKFLOW_WEBHOOK_REGISTRY } from '@rytass/bpm-core-nestjs-module';
import type { Request } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { buildApiBPMAuthContextFromExecutionContext } from './api-auth';
import { ApiAuthModule } from './api-auth.module';
import { ApiSimulationSeedService } from './api-simulation-seed.service';
import { ApiMemberResolver } from './api-member.resolver';
import { ApiSessionService } from './api-session.service';
import { ApiTaiwanBusinessCalendar } from './api-taiwan-business-calendar';
import { ApiFormDataSourceRegistry } from './api-form-data-source';
import { ApiDemoWebhookModule } from './api-demo-webhook.module';
import {
  ApiDemoWebhookSigningSecret,
  createApiDemoWebhookRegistry,
} from './api-demo-webhooks';

@Module({
  imports: [
    ApiAuthModule,
    ApiDemoWebhookModule,
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
        // Apollo passes an unhandled error's own message straight through, so a
        // driver-level failure answers with something like
        // `invalid input syntax for type uuid: "..."` — naming the database and
        // the column type. Deliberate errors keep their message; only the
        // internal ones are replaced, and `code`/`path` survive either way so
        // clients can still branch on them.
        formatError: (
          formattedError: GraphQLFormattedError,
          error: unknown,
        ): GraphQLFormattedError =>
          formattedError.extensions?.code === 'INTERNAL_SERVER_ERROR' &&
          !(unwrapResolverError(error) instanceof HttpException)
            ? { ...formattedError, message: 'Internal server error' }
            : redactInvalidVariableValue(formattedError),
        // Stack traces carry absolute repository paths and dependency versions.
        // Apollo only hides them when NODE_ENV is exactly 'production', so a
        // staging host left on any other value would ship them to the browser.
        includeStacktraceInErrorResponses: false,
        introspection: process.env.NODE_ENV !== 'production',
        path: '/graphql',
        playground: false,
        sortSchema: true,
      }),
    }),
    BPMRootModule.forRoot({
      imports: [ApiAuthModule, ApiDemoWebhookModule],
      attachmentPublicBaseUrl:
        process.env.BPM_API_PUBLIC_URL ??
        process.env.BPM_ATTACHMENT_PUBLIC_BASE_URL,
      attachmentSignedUrlSecret: process.env.BPM_ATTACHMENT_SIGNING_SECRET,
      authContextFactory: buildApiBPMAuthContextFromExecutionContext,
      businessCalendarProvider: {
        provide: BPM_BUSINESS_CALENDAR,
        useClass: ApiTaiwanBusinessCalendar,
      },
      formDataSourceRegistryProvider: {
        provide: BPM_FORM_DATA_SOURCE_REGISTRY,
        useClass: ApiFormDataSourceRegistry,
      },
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: ApiMemberResolver,
      },
      // Database-managed webhook endpoints (ADR 18 §3.13). Needs both an
      // allowlist and an encryption key; outside production the demo ones
      // below let the back office point endpoints at the local receiver.
      workflowWebhookAllowedUrlPatterns: readWebhookAllowedUrlPatterns(),
      workflowWebhookSecretEncryptionKey: readWebhookSecretEncryptionKey(),
      workflowWebhookTargetSources: ['REGISTRY', 'DATABASE'],
      // Demo endpoints for the NOTIFY webhook feature; empty in production.
      // A provider rather than a value, so the endpoints can read their
      // signing secret from Vault.
      workflowWebhookRegistryProvider: {
        inject: [ApiDemoWebhookSigningSecret],
        provide: BPM_WORKFLOW_WEBHOOK_REGISTRY,
        useFactory: createApiDemoWebhookRegistry,
      },
    }),
  ],
  controllers: [AppController],
  // `businessCalendarProvider` uses `useClass`, so BPM instantiates the
  // calendar inside its own module context; it needs no provider entry here.
  providers: [AppService, ApiSimulationSeedService],
})
export class AppModule {}

/**
 * `BPM_WEBHOOK_ALLOWED_URL_PATTERNS` is a comma-separated list. Outside
 * production the local demo receiver is allowed by default, named by its
 * literal host (a wildcard host never matches localhost).
 */
function readWebhookAllowedUrlPatterns(): readonly string[] {
  const configured = (process.env.BPM_WEBHOOK_ALLOWED_URL_PATTERNS ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  if (configured.length || process.env.NODE_ENV === 'production') {
    return configured;
  }

  return [`http://localhost:${process.env.PORT ?? 17603}/demo/webhook-sink/*`];
}

/**
 * 32 bytes as hex or base64 from `BPM_WEBHOOK_SECRET_ENCRYPTION_KEY`. Outside
 * production a fixed development key applies so the demo works out of the
 * box; production gets no default, which leaves database endpoints off.
 */
function readWebhookSecretEncryptionKey(): string | undefined {
  return (
    process.env.BPM_WEBHOOK_SECRET_ENCRYPTION_KEY ||
    (process.env.NODE_ENV === 'production'
      ? undefined
      : '6270d2d56465762d776562686f6f6b2d7365637265742d6b65792d3332627974')
  );
}

/**
 * GraphQL answers a variable of the wrong shape with the value it got —
 * `Variable "$input" got invalid value { value: "Bearer …" }` — which would
 * copy a webhook header or signing secret into proxies, APM and devtools.
 * The value and the reasons after it (which can quote the value too) are
 * dropped; the path to the offending field stays.
 */
function redactInvalidVariableValue(
  formattedError: GraphQLFormattedError,
): GraphQLFormattedError {
  return formattedError.message.startsWith('Variable "$')
    ? {
        ...formattedError,
        message: formattedError.message.replace(
          /got invalid value[\s\S]*?( at "[^"]*")?(?:;[\s\S]*)?$/u,
          'got invalid value$1',
        ),
      }
    : formattedError;
}
