import { NestFactory } from '@nestjs/core';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
  Query,
  Resolver,
} from '@nestjs/graphql';
import {
  GraphQLInputObjectType,
  GraphQLSchema,
  GraphQLString,
  isNonNullType,
} from 'graphql';
import { WorkflowEngineMutations } from './workflow-engine.mutations';

// A code-first schema cannot be built without a Query root.
@Resolver()
class SchemaRootQuery {
  @Query(() => Boolean)
  schemaRoot(): boolean {
    return true;
  }
}

describe('WorkflowEngineMutations schema', () => {
  let schema: GraphQLSchema;

  beforeAll(async (): Promise<void> => {
    const app = await NestFactory.create(GraphQLSchemaBuilderModule, {
      logger: false,
    });

    try {
      schema = await app
        .get(GraphQLSchemaFactory)
        .create([SchemaRootQuery, WorkflowEngineMutations]);
    } finally {
      await app.close();
    }
  });

  // bpm-core-client's resubmitApprovalInstance sends `comment` when the
  // applicant writes one; GraphQL rejects an undeclared input key with HTTP
  // 400, and an existing caller that sends nothing must keep working.
  it('accepts an optional comment on ResubmitApprovalInstanceInput', (): void => {
    const inputType = schema.getType('ResubmitApprovalInstanceInput');

    expect(inputType).toBeInstanceOf(GraphQLInputObjectType);

    const comment = (inputType as GraphQLInputObjectType).getFields()[
      'comment'
    ];

    expect(comment?.type).toBe(GraphQLString);
    expect(isNonNullType(comment?.type)).toBe(false);
  });
});
