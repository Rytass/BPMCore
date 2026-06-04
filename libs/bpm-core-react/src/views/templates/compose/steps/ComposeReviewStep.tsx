'use client';

import type { CSSProperties, ReactElement } from 'react';
import { Empty, Table, Tag, Typography } from '@mezzanine-ui/react';
import type { TableColumn } from '@mezzanine-ui/core/table';
import type {
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import type {
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import { FormRenderer } from '../../../forms/renderer/FormRendererView';

type FlowNodeRow = Readonly<
  Record<string, unknown> & {
    detail: string;
    key: string;
    label: string;
    typeLabel: string;
  }
>;

type BranchRow = Readonly<
  Record<string, unknown> & {
    condition: string;
    key: string;
    source: string;
    target: string;
  }
>;

export interface ComposeReviewStepProps {
  readonly name: string;
  readonly formSchema: FormDefinitionSchema;
  readonly formUiSchema: FormUiSchema;
  readonly workflowDefinition: WorkflowDefinition | null;
  readonly initiatorPolicyCel: string | null;
  readonly publishError: string | null;
}

export function ComposeReviewStep({
  formSchema,
  formUiSchema,
  initiatorPolicyCel,
  name,
  publishError,
  workflowDefinition,
}: ComposeReviewStepProps): ReactElement {
  const nodes = workflowDefinition?.nodes ?? [];
  const edges = workflowDefinition?.edges ?? [];
  const fieldCount = formSchema.fields.length;
  const nodeLabelById = new Map(
    nodes.map((node) => [node.id, node.data.label] as const),
  );
  const nodeRows: FlowNodeRow[] = nodes.map((node) => ({
    detail: readNodeDetail(node) ?? '—',
    key: node.id,
    label: node.data.label,
    typeLabel: readNodeTypeLabel(node),
  }));
  const branchRows: BranchRow[] = edges
    .filter((edge) => Boolean(edge.data.condition))
    .map((edge) => ({
      condition: edge.data.condition ?? '',
      key: edge.id,
      source: nodeLabelById.get(edge.source) ?? edge.source,
      target: nodeLabelById.get(edge.target) ?? edge.target,
    }));

  return (
    <div style={STACK_STYLE}>
      <Typography component="h2" style={TITLE_STYLE} variant="h2">
        {name || '（未命名）'}
      </Typography>

      <div style={STACK_STYLE}>
        <Typography variant="h3">表單預覽</Typography>
        {fieldCount > 0 ? (
          <FormRenderer readonly schema={formSchema} uiSchema={formUiSchema} />
        ) : (
          <Empty title="尚未設計表單欄位" />
        )}
      </div>

      <div style={STACK_STYLE}>
        <Typography variant="h3">流程概覽</Typography>
        {nodes.length > 0 ? (
          <Table columns={NODE_COLUMNS} dataSource={nodeRows} fullWidth />
        ) : (
          <Empty title="尚未設計流程節點" />
        )}
        {branchRows.length > 0 ? (
          <>
            <Typography color="text-neutral" variant="caption">
              條件分流
            </Typography>
            <Table columns={BRANCH_COLUMNS} dataSource={branchRows} fullWidth />
          </>
        ) : null}
        {initiatorPolicyCel ? (
          <Typography color="text-neutral" variant="caption">
            發起權限：{initiatorPolicyCel}
          </Typography>
        ) : null}
      </div>

      {publishError ? (
        <Typography color="text-error" variant="body">
          {publishError}
        </Typography>
      ) : null}
    </div>
  );
}

const NODE_COLUMNS: TableColumn<FlowNodeRow>[] = [
  {
    key: 'type',
    render: (record: FlowNodeRow): ReactElement => (
      <Tag label={record.typeLabel} size="sub" type="static" />
    ),
    title: '類型',
    width: 130,
  },
  { dataIndex: 'label', key: 'label', title: '節點' },
  { dataIndex: 'detail', key: 'detail', title: '簽核方式', width: 160 },
];

const BRANCH_COLUMNS: TableColumn<BranchRow>[] = [
  { dataIndex: 'source', key: 'source', title: '來源', width: 180 },
  { dataIndex: 'target', key: 'target', title: '目標', width: 180 },
  { dataIndex: 'condition', key: 'condition', title: '條件' },
];

function readNodeTypeLabel(node: WorkflowNode): string {
  switch (node.type) {
    case 'startEvent':
      return '開始';
    case 'endEvent':
      return node.data.endState === 'REJECTED' ? '結束（駁回）' : '結束（核准）';
    case 'userTask':
      return '簽核';
    case 'serviceTask':
      return '服務';
    case 'exclusiveGateway':
      return '條件閘道';
    case 'parallelGateway':
      return '平行閘道';
    default:
      return '節點';
  }
}

function readNodeDetail(node: WorkflowNode): string | null {
  if (node.type !== 'userTask') {
    return null;
  }

  switch (node.data.approverResolver.type) {
    case 'DIRECT':
      return '指定成員';
    case 'POSITION':
      return '指定職位';
    case 'ORG_UNIT_MEMBER':
      return '單位成員';
    case 'ORG_UNIT_POSITION':
      return '單位職位';
    case 'ORG_MANAGER':
      return '主管';
    case 'ORG_UNIT_MANAGER':
      return '單位主管';
    case 'DYNAMIC_FORM':
      return '表單動態指派';
    case 'EXPRESSION':
      return '運算式';
    default:
      return '簽核人';
  }
}

const STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
};

// Match the breathing room between the stepper and the PageHeader, which is the
// Section's top padding token.
const TITLE_STYLE: CSSProperties = {
  marginTop: 'var(--mzn-spacing-padding-vertical-spacious)',
};
