import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum FilterableFieldIssueKind {
  TYPE_CHANGED = 'TYPE_CHANGED',
  INVALID_VALUES = 'INVALID_VALUES',
}

registerEnumType(FilterableFieldIssueKind, {
  name: 'FilterableFieldIssueKind',
});

/**
 * One reason a field cannot be marked filterable yet (ADR 25 §5.4). Only the
 * fields that matter for the kind are filled: `conflictVersionNumbers` for a
 * type change, `invalidInstanceCount` and `sampleInstanceIds` for bad values.
 */
@ObjectType('FilterableFieldIssue')
export class FilterableFieldIssueObject {
  @Field(() => FilterableFieldIssueKind)
  kind!: FilterableFieldIssueKind;

  @Field(() => String)
  path!: string;

  @Field(() => String)
  label!: string;

  @Field(() => String)
  fieldType!: string;

  @Field(() => ID)
  templateId!: string;

  @Field(() => String)
  templateName!: string;

  @Field(() => String)
  message!: string;

  @Field(() => [Int])
  conflictVersionNumbers!: readonly number[];

  @Field(() => Int)
  invalidInstanceCount!: number;

  @Field(() => [String])
  sampleInstanceIds!: readonly string[];
}
