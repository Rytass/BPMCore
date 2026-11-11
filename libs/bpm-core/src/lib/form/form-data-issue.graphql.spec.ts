import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GraphQLModule, Query, Resolver } from '@nestjs/graphql';
import type { INestApplication } from '@nestjs/common';
import {
  createFormDataBadRequest,
  createFormDataIssue,
  readFieldIssueLocation,
} from './form-data-issue';

// A resolver that refuses a write the way the workflow engine does, so the
// assertion runs through Nest's Apollo driver and its error formatting.
@Resolver()
class RefusingWriteResolver {
  @Query(() => String, { name: 'refuseWrite' })
  refuseWrite(): string {
    throw createFormDataBadRequest('欄位「備註」為必填', [
      createFormDataIssue(
        readFieldIssueLocation({ fieldKey: 'note', label: '備註' }),
        'REQUIRED',
        '為必填',
      ),
    ]);
  }
}

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      autoSchemaFile: true,
      driver: ApolloDriver,
      path: '/graphql',
    }),
  ],
  providers: [RefusingWriteResolver],
})
class RefusingWriteModule {}

interface GraphQLErrorPayload {
  readonly errors: readonly {
    readonly message: string;
    readonly extensions: Readonly<Record<string, unknown>>;
  }[];
}

describe('form data issues over GraphQL', (): void => {
  let app: INestApplication;
  let endpoint: string;

  beforeAll(async (): Promise<void> => {
    app = await NestFactory.create(RefusingWriteModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    endpoint = `${await app.getUrl()}/graphql`;
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('keeps the Chinese message and the structured issues in extensions.originalError', async (): Promise<void> => {
    const response = await fetch(endpoint, {
      body: JSON.stringify({ query: '{ refuseWrite }' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const payload = (await response.json()) as GraphQLErrorPayload;

    expect(payload.errors[0]?.message).toBe('欄位「備註」為必填');
    expect(payload.errors[0]?.extensions['originalError']).toEqual({
      error: 'Bad Request',
      formDataErrors: [
        {
          message: '欄位「備註」為必填',
          path: 'note',
          reason: 'REQUIRED',
        },
      ],
      message: '欄位「備註」為必填',
      statusCode: 400,
    });
  });
});
