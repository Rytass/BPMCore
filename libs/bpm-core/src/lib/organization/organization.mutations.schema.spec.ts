import { NestFactory } from '@nestjs/core';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { GraphQLInputObjectType, GraphQLSchema } from 'graphql';
import { OrganizationMutations } from './organization.mutations';

// bpm-core-client's updateMembership (organization-api.ts) sends exactly
// these keys. GraphQL rejects an input key the type does not declare with
// HTTP 400, so a field dropped from UpdateMembershipInput breaks the admin
// membership editor; this list is pinned on both sides on purpose.
const CLIENT_UPDATE_MEMBERSHIP_FIELDS = [
  'effectiveFrom',
  'effectiveTo',
  'id',
  'isPrimary',
  'orgUnitId',
  'positionId',
];

// A code-first schema cannot be built without a Query root.
@Resolver()
class SchemaRootQuery {
  @Query(() => Boolean)
  schemaRoot(): boolean {
    return true;
  }
}

describe('OrganizationMutations schema', () => {
  let schema: GraphQLSchema;

  beforeAll(async (): Promise<void> => {
    const app = await NestFactory.create(GraphQLSchemaBuilderModule, {
      logger: false,
    });

    try {
      schema = await app
        .get(GraphQLSchemaFactory)
        .create([SchemaRootQuery, OrganizationMutations]);
    } finally {
      await app.close();
    }
  });

  it('declares every field the client sends in UpdateMembershipInput', (): void => {
    const inputType = schema.getType('UpdateMembershipInput');

    expect(inputType).toBeInstanceOf(GraphQLInputObjectType);

    const fields = Object.keys(
      (inputType as GraphQLInputObjectType).getFields(),
    ).sort();

    expect(fields).toEqual(CLIENT_UPDATE_MEMBERSHIP_FIELDS);
  });
});
