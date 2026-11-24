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
import { validate } from 'class-validator';
import { SIGNER_RECALL_ERROR_CODES } from '@rytass/bpm-core-shared/status';
import { RecallTaskApprovalInput } from './dto/recall-task-approval.input';
import { ResubmitApprovalInstanceInput } from './dto/resubmit-approval-instance.input';
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

  // The comment is stored whole in the activity log payload.
  it('caps the resubmission comment at 2000 characters', async (): Promise<void> => {
    const input = new ResubmitApprovalInstanceInput();
    input.formDataJson = '{}';
    input.instanceId = '11111111-1111-4111-8111-111111111111';
    input.title = null;

    input.comment = 'x'.repeat(2000);
    expect(await validate(input)).toEqual([]);

    input.comment = 'x'.repeat(2001);
    expect(await validate(input)).toEqual([
      expect.objectContaining({ property: 'comment' }),
    ]);
  });

  // G3: the signer's note is optional and capped like the resubmission one;
  // a task id that is not a UUID would fail the uuid lookup as a 500.
  it('accepts an optional comment on RecallTaskApprovalInput', (): void => {
    const inputType = schema.getType('RecallTaskApprovalInput');

    expect(inputType).toBeInstanceOf(GraphQLInputObjectType);

    const comment = (inputType as GraphQLInputObjectType).getFields()[
      'comment'
    ];

    expect(comment?.type).toBe(GraphQLString);
    expect(isNonNullType(comment?.type)).toBe(false);
  });

  it('caps the recall comment at 2000 characters', async (): Promise<void> => {
    const input = new RecallTaskApprovalInput();
    input.taskId = '11111111-1111-4111-8111-111111111111';

    expect(await validate(input)).toEqual([]);

    input.comment = 'x'.repeat(2000);
    expect(await validate(input)).toEqual([]);

    input.comment = 'x'.repeat(2001);
    expect(await validate(input)).toEqual([
      expect.objectContaining({ property: 'comment' }),
    ]);
  });

  it('rejects a recall task id that is not a UUID', async (): Promise<void> => {
    const input = new RecallTaskApprovalInput();
    input.taskId = 'not-a-uuid';

    expect(await validate(input)).toEqual([
      expect.objectContaining({ property: 'taskId' }),
    ]);
  });

  // A refused recall is a 409 whose code the client maps to its own wording;
  // the mutation's description is where a GraphQL consumer finds the list.
  it('lists every refusal code in the recallTaskApproval description', (): void => {
    const description =
      schema.getMutationType()?.getFields()['recallTaskApproval']
        ?.description ?? '';

    expect(Object.values(SIGNER_RECALL_ERROR_CODES)).toHaveLength(12);
    Object.values(SIGNER_RECALL_ERROR_CODES).forEach((code): void => {
      expect(description).toContain(code);
    });
  });
});
