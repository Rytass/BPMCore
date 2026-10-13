import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('WorkflowDashboardSummary')
export class WorkflowDashboardSummaryObject {
  @Field(() => Int, {
    description: '成員可讀取的簽核單中，進行中的件數',
  })
  activeInstanceCount!: number;

  @Field(() => Int, {
    description: '成員可讀取的簽核單中，已核准的件數',
  })
  completedInstanceCount!: number;

  @Field(() => Int, {
    description:
      '本人目前的待辦任務中，已超過 SLA 期限的件數（與待簽清單使用同一套判斷）',
  })
  overdueTaskCount!: number;

  @Field(() => Int, {
    description: '本人目前的待辦任務數（與待簽清單一致）',
  })
  pendingTaskCount!: number;

  @Field(() => Int, {
    description: '成員可讀取的簽核單中，已駁回的件數',
  })
  rejectedInstanceCount!: number;

  @Field(() => Int, {
    description: '成員可讀取的簽核單總件數',
  })
  totalInstanceCount!: number;
}
