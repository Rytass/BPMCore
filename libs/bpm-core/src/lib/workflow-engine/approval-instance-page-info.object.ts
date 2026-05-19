import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('ApprovalInstancePageInfo')
export class ApprovalInstancePageInfoObject {
  @Field(() => Boolean)
  hasNextPage!: boolean;

  @Field(() => Boolean)
  hasPreviousPage!: boolean;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  totalPages!: number;
}
