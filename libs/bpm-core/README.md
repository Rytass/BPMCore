# @rytass/bpm-core-nestjs-module

Embeddable NestJS module for BPM approval workflows.

This package provides the backend BPM domain layer: GraphQL resolvers, TypeORM
entities, migrations, workflow execution, approval tasks, form definitions,
approval templates, organization/member lookup contracts, delegation,
notifications, SLA handling, attachments, and decision signatures.

It is designed to be embedded into a host NestJS application. The host
application owns runtime infrastructure such as GraphQL setup, TypeORM
connection setup, auth/session handling, Vault or secret loading, member
directory integration, storage adapters, and deployment.

## Package Status

Current version: `0.0.1`

The package is intended for NestJS backend hosts. It does not include the
Next.js backoffice UI and does not provide a production auth system by itself.

## Install

```bash
pnpm add @rytass/bpm-core-nestjs-module @rytass/bpm-core-shared
pnpm add @nestjs/common @nestjs/core @nestjs/graphql @nestjs/typeorm typeorm reflect-metadata
pnpm add pg
```

If your host uses Apollo GraphQL:

```bash
pnpm add @nestjs/apollo @apollo/server
```

If your host uses Vault-backed database settings:

```bash
pnpm add @rytass/secret-adapter-vault-nestjs
```

## Runtime Responsibilities

`@rytass/bpm-core-nestjs-module` owns BPM domain behavior.

Your host application must provide:

- A NestJS application runtime.
- A configured `GraphQLModule`.
- A configured TypeORM `DataSource` / `TypeOrmModule`.
- Auth/session/JWT logic.
- A `BPMAuthContext` bridge from the request execution context.
- A `BPM_MEMBER_RESOLVER` provider for member metadata lookup.
- Attachment storage configuration when local storage is not acceptable.
- Production secrets for attachment URL signing, signatures, SMTP, webhook, and Vault.

The package intentionally stores member IDs instead of owning user accounts.
Member profiles, roles, permissions, and email addresses are resolved by the
host.

## Quick Start

```ts
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import {
  BPMRootModule,
  BPM_MEMBER_RESOLVER,
  buildTypeOrmModuleOptions,
} from '@rytass/bpm-core-nestjs-module';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { ApiMemberResolver } from './api-member.resolver';
import { buildBPMAuthContextFromExecutionContext } from './bpm-auth-context';

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
      path: '/graphql',
      sortSchema: true,
    }),
    BPMRootModule.forRoot({
      authContextFactory: buildBPMAuthContextFromExecutionContext,
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useClass: ApiMemberResolver,
      },
    }),
  ],
})
export class AppModule {}
```

## Auth Context

BPM guards and mutations need the current BPM member. The host may provide the
context in the GraphQL context object or through `authContextFactory`.

```ts
import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { BPMAuthContext } from '@rytass/bpm-core-nestjs-module';

interface HostGraphQLContext {
  readonly bpmAuthContext?: BPMAuthContext | null;
}

export function buildBPMAuthContextFromExecutionContext(
  context?: ExecutionContext,
): BPMAuthContext | null {
  if (!context) {
    return null;
  }

  const graphqlContext = GqlExecutionContext.create(context).getContext<
    HostGraphQLContext | undefined
  >();

  return graphqlContext?.bpmAuthContext ?? null;
}
```

`BPMAuthContext` shape:

```ts
export interface BPMAuthContext {
  readonly memberId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}
```

## Member Resolver

The package resolves display names, email addresses, and approver candidates
through `BPM_MEMBER_RESOLVER`.

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BPMMemberBaseResolverAdapter,
  type BPMMemberBaseDirectory,
  type BPMMemberResolver,
} from '@rytass/bpm-core-nestjs-module';
import type { MemberMetadata } from '@rytass/bpm-core-shared';

interface HostMember {
  readonly email: string;
  readonly id: string;
  readonly name: string;
}

@Injectable()
export class HostBPMMemberResolver
  extends BPMMemberBaseResolverAdapter<HostMember>
  implements BPMMemberResolver
{
  constructor(directory: BPMMemberBaseDirectory<HostMember>) {
    super(directory, {
      readEmail: (member): string => member.email,
      readMemberId: (member): string => member.id,
      readName: (member): string => member.name,
    });
  }

  override async resolve(memberId: string): Promise<MemberMetadata> {
    try {
      return await super.resolve(memberId);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new NotFoundException(`Member ${memberId} was not found`);
      }

      throw error;
    }
  }
}
```

Required resolver contract:

```ts
export interface BPMMemberResolver {
  resolve(memberId: string): Promise<MemberMetadata>;
  resolveMany(memberIds: readonly string[]): Promise<ReadonlyMap<string, MemberMetadata>>;
  search?(searchText: string): Promise<readonly MemberMetadata[]>;
}
```

## Root Module Configuration

Use `BPMRootModule.forRoot()` for static configuration or
`BPMRootModule.forRootAsync()` when values come from Vault, ConfigService, KMS,
or another secret provider.

```ts
BPMRootModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
  useFactory: (config: ConfigService) => ({
    authContextFactory: buildBPMAuthContextFromExecutionContext,
    attachmentPublicBaseUrl: config.getOrThrow<string>('BPM_API_PUBLIC_URL'),
    attachmentSignedUrlSecret: config.getOrThrow<string>('BPM_ATTACHMENT_SIGNING_SECRET'),
    attachmentSignedUrlTtlSeconds: 300,
    identityMemberMetadataCacheTtlMs: 300_000,
    notificationEmailEnabled: 'auto',
    notificationEmailFrom: config.get<string>('BPM_NOTIFICATION_FROM'),
    notificationEmailSmtpHost: config.get<string>('BPM_SMTP_HOST'),
    notificationEmailSmtpPassword: config.get<string>('BPM_SMTP_PASSWORD'),
    notificationEmailSmtpPort: Number(config.get<string>('BPM_SMTP_PORT')),
    notificationEmailSmtpSecure: false,
    notificationEmailSmtpUsername: config.get<string>('BPM_SMTP_USERNAME'),
    notificationWebhookEnabled: 'auto',
    notificationWebhookEndpointUrl: config.get<string>('BPM_WEBHOOK_URL'),
    notificationWebhookSigningSecret: config.get<string>('BPM_WEBHOOK_SIGNING_SECRET'),
    signatureCurrentKeyVersion: 1,
    signatureKeyProvider: {
      readKey: (keyVersion: number): string => config.getOrThrow<string>(`BPM_SIGNATURE_KEY_V${keyVersion}`),
    },
    signatureTimestampProvider: {
      createTimestampToken: (): Buffer => Buffer.from('{}', 'utf8'),
    },
  }),
});
```

### Configuration Reference

| Option                                           | Default                        | Description                                                  |
| ------------------------------------------------ | ------------------------------ | ------------------------------------------------------------ |
| `authContextFactory`                             | `undefined`                    | Reads `BPMAuthContext` from NestJS `ExecutionContext`.       |
| `memberResolverProvider`                         | required                       | Provider for `BPM_MEMBER_RESOLVER`.                          |
| `attachmentStorageProvider`                      | local `.storage/attachments`   | Host-provided `@rytass/storages` adapter.                    |
| `attachmentPublicBaseUrl`                        | `http://localhost:17603`       | Public base URL for signed attachment URLs.                  |
| `attachmentSignedUrlSecret`                      | local development secret       | HMAC secret for signed attachment download/preview tokens.   |
| `attachmentSignedUrlTtlSeconds`                  | `300`                          | Signed attachment URL lifetime in seconds.                   |
| `identityMemberMetadataCacheTtlMs`               | `300000`                       | Member metadata cache TTL.                                   |
| `notificationInAppEnabled`                       | `true`                         | Enables in-app notification records.                         |
| `notificationEmailEnabled`                       | `auto`                         | Enables email when SMTP settings are complete.               |
| `notificationEmailSmtpHost`                      | `null`                         | SMTP host.                                                   |
| `notificationEmailSmtpPort`                      | `null`                         | SMTP port.                                                   |
| `notificationEmailSmtpSecure`                    | `false`                        | `true` for implicit TLS, `false` for STARTTLS.               |
| `notificationEmailSmtpUsername`                  | `null`                         | SMTP username.                                               |
| `notificationEmailSmtpPassword`                  | `null`                         | SMTP password or app password.                               |
| `notificationEmailFrom`                          | `null`                         | Email sender address.                                        |
| `notificationWebhookEnabled`                     | `auto`                         | Enables webhook when URL and signing secret are complete.    |
| `notificationWebhookEndpointUrl`                 | `null`                         | Default webhook endpoint URL.                                |
| `notificationWebhookSigningSecret`               | `null`                         | HMAC secret for webhook payload signatures.                  |
| `notificationDeliverySchedulerEnabled`           | `true`                         | Runs pending email/webhook delivery loop in the API process. |
| `notificationDeliveryScanIntervalMs`             | `30000`                        | Delivery scheduler interval.                                 |
| `notificationDeliveryBatchSize`                  | `25`                           | Maximum pending notifications per delivery scan.             |
| `notificationDeliveryMaxAttempts`                | `3`                            | Attempts before a notification is marked failed.             |
| `notificationDeliveryRetryBaseDelayMs`           | `60000`                        | Base retry delay multiplied by attempt count.                |
| `notificationSlaSchedulerEnabled`                | `true`                         | Runs automatic SLA scan loop in the API process.             |
| `notificationSlaScanIntervalMs`                  | `60000`                        | SLA scheduler interval.                                      |
| `notificationSlaTimeoutRemindEnabled`            | `true`                         | Enables SLA timeout `REMIND`.                                |
| `notificationSlaTimeoutAutoApproveEnabled`       | `false`                        | Enables SLA timeout `AUTO_APPROVE`.                          |
| `notificationSlaTimeoutEscalateEnabled`          | `false`                        | Enables SLA timeout `ESCALATE`.                              |
| `notificationSlaTimeoutTerminateInstanceEnabled` | `false`                        | Enables SLA timeout `TERMINATE_INSTANCE`.                    |
| `notificationTemplateEngine`                     | `simple`                       | `simple` or `handlebars`.                                    |
| `notificationDefaultChannels`                    | `[IN_APP]`                     | Fallback channels when a workflow node has no channel list.  |
| `notificationDefaultEmailDigestMode`             | `INSTANT`                      | Default digest mode for missing preferences.                 |
| `notificationDefaultInAppPreferenceEnabled`      | `true`                         | Default in-app preference for missing preferences.           |
| `notificationDefaultEmailPreferenceEnabled`      | `true`                         | Default email preference for missing preferences.            |
| `signatureCurrentKeyVersion`                     | `1`                            | Key version used for new signatures.                         |
| `signatureKeyProvider`                           | local development key provider | Host key provider for signing and verification.              |
| `signatureTimestampProvider`                     | mock timestamp provider        | Host timestamp token provider.                               |

Production deployments should override all local development secrets.

## Database Setup

The package exports helpers for Vault-backed TypeORM setup:

```ts
import { TypeOrmModule } from '@nestjs/typeorm';
import { VaultModule, VaultService } from '@rytass/secret-adapter-vault-nestjs';
import { buildTypeOrmModuleOptions } from '@rytass/bpm-core-nestjs-module';

TypeOrmModule.forRootAsync({
  imports: [VaultModule],
  inject: [VaultService],
  useFactory: buildTypeOrmModuleOptions,
});
```

Expected Vault keys:

| Key         | Description                |
| ----------- | -------------------------- |
| `DB_HOST`   | PostgreSQL host.           |
| `DB_PORT`   | PostgreSQL port, optional. |
| `DB_NAME`   | PostgreSQL database name.  |
| `DB_USER`   | PostgreSQL username.       |
| `DB_PASS`   | PostgreSQL password.       |
| `DB_SCHEMA` | PostgreSQL schema.         |

The local migration CLI helper can also read Vault directly from environment
variables:

```bash
VAULT_HOST=https://vault.example.com \
VAULT_ACCOUNT=your-account \
VAULT_PASSWORD=your-password \
VAULT_PATH=bpm_core/develop \
pnpm typeorm migration:run
```

Required environment variables for direct Vault loading:

| Variable         | Description                         |
| ---------------- | ----------------------------------- |
| `VAULT_HOST`     | Vault HTTP base URL.                |
| `VAULT_ACCOUNT`  | Vault userpass account.             |
| `VAULT_PASSWORD` | Vault userpass password.            |
| `VAULT_PATH`     | Vault KV path, defaults to develop. |

## Migrations

This package ships TypeORM migrations under `src/lib/migrations`.

For this repository:

```bash
pnpm migration:run
```

For an external host, import the class list instead of relying on a repository
source glob:

```ts
import { BPM_CORE_MIGRATIONS } from '@rytass/bpm-core-nestjs-module/migrations';
```

`buildDataSourceOptionsFromVaultEnv()` and `buildTypeOrmModuleOptions()` already
use this exported migration list.

Do not enable `synchronize` in production.

## Attachment Storage

By default, attachments use local storage under `.storage/attachments`. For
production, provide an `@rytass/storages` compatible adapter:

```ts
BPMRootModule.forRoot({
  attachmentStorageProvider: {
    provide: ATTACHMENT_STORAGE,
    useFactory: (): AttachmentStorage => createYourStorageAdapter(),
  },
  authContextFactory: buildBPMAuthContextFromExecutionContext,
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
});
```

Signed attachment URLs are served by BPM's attachment controller. Configure
`attachmentPublicBaseUrl`, `attachmentSignedUrlSecret`, and
`attachmentSignedUrlTtlSeconds` for production.

## Notifications and SLA

BPM creates in-app notifications by default. Email and webhook delivery are
disabled unless enough configuration is present or explicitly enabled.

Delivery and SLA schedulers run inside the API process by default. Disable them
when you run delivery or SLA scans from an external worker:

```ts
BPMRootModule.forRoot({
  notificationDeliverySchedulerEnabled: false,
  notificationSlaSchedulerEnabled: false,
  authContextFactory: buildBPMAuthContextFromExecutionContext,
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
});
```

SLA timeout actions that change workflow state are disabled by default:

- `AUTO_APPROVE`
- `ESCALATE`
- `TERMINATE_INSTANCE`

Enable them only after the host application's business policy is explicit.

## Signatures

Decision signatures use HMAC-SHA256 and are chained through the previous
signature hash. Production hosts should provide a durable key provider and real
timestamp provider:

```ts
BPMRootModule.forRoot({
  signatureCurrentKeyVersion: 2,
  signatureKeyProvider: {
    readKey: async (keyVersion: number): Promise<string | null> => readKeyFromKmsOrVault(keyVersion),
  },
  signatureTimestampProvider: {
    createTimestampToken: async ({ signedAt, signedPayloadHash }): Promise<Buffer> => requestTimestampTokenFromTsa({ signedAt, signedPayloadHash }),
  },
  authContextFactory: buildBPMAuthContextFromExecutionContext,
  memberResolverProvider: {
    provide: BPM_MEMBER_RESOLVER,
    useClass: HostBPMMemberResolver,
  },
});
```

Keep old signature keys readable after rotation. Verification needs the key
version stored on each signature row.

## GraphQL Surface

Importing `BPMRootModule` registers GraphQL resolvers for:

- Organization units, positions, memberships, manager resolution, and summary.
- Member profile lookup and member metadata cache inspection.
- Form definitions and form definition versions.
- Approval templates, template versions, categories, validation, and dry run.
- Workflow instances, tokens, tasks, task candidates, decisions, activity logs,
  submit/process/approve/return/cancel/resubmit operations.
- Delegation rule CRUD and transfer support.
- Notifications, unread counts, preferences, and read status.
- Attachments, signed download URLs, and signed preview URLs.
- Decision signatures and signature-chain verification.

The schema is generated by NestJS GraphQL code-first decorators. Configure the
host `GraphQLModule` with `autoSchemaFile` if you want NestJS to generate the
schema at runtime.

## Shared Types

Workflow, form, condition, identity, organization, and status contracts live in
`@rytass/bpm-core-shared`.

```ts
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import type { FormSchema } from '@rytass/bpm-core-shared/form';
```

Use shared contracts when building UI clients or host-side integration tests.

## Import Path

All public APIs are exported from the package root. Use the root package import
instead of deep imports or feature subpath imports.

```ts
import {
  BPMAuthenticatedGuard,
  BPMMemberBaseResolverAdapter,
  BPMRootModule,
  NotificationService,
  SignatureService,
  buildTypeOrmModuleOptions,
} from '@rytass/bpm-core-nestjs-module';
```

## Local Development

From this repository:

```bash
pnpm install
pnpm migration:run
pnpm api
pnpm client
```

Default local service URLs:

- API: `http://localhost:17603`
- GraphQL: `http://localhost:17603/graphql`
- Client: `http://localhost:17602`

The normal local flow uses Vault-backed develop secrets. `docker compose` is not
required for local verification.

## Verification

Before publishing:

```bash
pnpm nx test bpm-core --runInBand
pnpm nx typecheck bpm-core
pnpm nx build bpm-core
```

Repository-wide checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Publishing Checklist

1. Confirm package metadata in `libs/bpm-core/package.json`.
2. Confirm `@rytass/bpm-core-shared` is published at the required version.
3. Run `pnpm nx build bpm-core`.
4. Inspect `dist/libs/bpm-core/package.json`.
5. Confirm `dist/libs/bpm-core/README.md` is present.
6. Confirm `src/index.ts` exports every intended public API.
7. Publish from the built package directory:

```bash
cd dist/libs/bpm-core
npm publish --access public
```

## Production Notes

- Replace all local fallback secrets before production.
- Use a production storage adapter instead of local filesystem storage.
- Keep old signature keys available for verification after key rotation.
- Disable in-process schedulers when using separate worker processes.
- Do not enable TypeORM `synchronize` in production.
- Ensure GraphQL auth context is available for protected operations.
- Run migrations before serving traffic with a new package version.

## License

MIT
