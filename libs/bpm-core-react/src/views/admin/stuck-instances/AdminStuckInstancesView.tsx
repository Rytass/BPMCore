'use client';

import {
  CSSProperties,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PageHeader,
  Section,
  SectionGroup,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { resolveMembers } from '@rytass/bpm-core-client';
import type { MemberProfileRecord } from '@rytass/bpm-core-client/template';
import {
  listStuckApprovalInstances,
  type StuckApprovalInstanceRecord,
} from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../../lib/format-date-time';
import { resolveMemberProfilesPerIdOnFailure } from '../../../lib/member-profile-resolution';
import { StuckInstanceCancelModal } from './StuckInstanceCancelModal';

type StuckRow = Readonly<
  Record<string, unknown> & {
    instance: StuckApprovalInstanceRecord;
    key: string;
  }
>;

const STACK_STYLE: CSSProperties = { display: 'grid', gap: 12 };

/**
 * Administrator list of approval instances that could not move on to their
 * next stage (the next approver could not be resolved, say) and still cannot.
 * Each row names where it stuck, who pressed last, who has to press again, and
 * why. The only action is cancelling the instance; fixing the cause and having
 * the listed person press again clears the row by itself. Administrator-only on
 * the server.
 */
export function AdminStuckInstancesView(): ReactElement {
  const [instances, setInstances] = useState<
    readonly StuckApprovalInstanceRecord[]
  >([]);
  const [profilesById, setProfilesById] = useState<
    ReadonlyMap<string, MemberProfileRecord>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] =
    useState<StuckApprovalInstanceRecord | null>(null);

  // Only the latest listing may write, so a slow earlier answer cannot replace
  // the list that a cancellation just reloaded.
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const request = latestRequestRef.current + 1;

    latestRequestRef.current = request;
    setLoading(true);

    try {
      const loaded = await listStuckApprovalInstances();
      const resolution = await resolveMemberProfilesPerIdOnFailure(
        readMemberIds(loaded),
        resolveMembers,
      );

      if (latestRequestRef.current !== request) {
        return;
      }

      // Ids that cannot be resolved stay out of the map and show as the raw id.
      setInstances(loaded);
      setProfilesById(
        new Map(
          resolution.profiles.map((profile) => [profile.memberId, profile]),
        ),
      );
      setError(null);
    } catch (requestError: unknown) {
      if (latestRequestRef.current === request) {
        setError(readErrorMessage(requestError));
      }
    } finally {
      if (latestRequestRef.current === request) {
        setLoading(false);
      }
    }
  }, []);

  useEffect((): void => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(
    (): StuckRow[] =>
      instances.map((instance) => ({ instance, key: instance.instanceId })),
    [instances],
  );

  const columns = useMemo(
    (): TableColumn<StuckRow>[] => [
      {
        key: 'instanceTitle',
        render: ({ instance }: StuckRow): string => instance.instanceTitle,
        title: '案件',
        width: 220,
      },
      {
        key: 'templateName',
        render: ({ instance }: StuckRow): string =>
          instance.templateName ?? '-',
        title: '範本',
        width: 160,
      },
      {
        key: 'stuckAt',
        render: ({ instance }: StuckRow): string =>
          instance.kind === 'RESUBMIT'
            ? '退件後重送'
            : (instance.nodeLabel ?? '-'),
        title: '卡在哪一關',
        width: 160,
      },
      {
        key: 'failedActor',
        render: ({ instance }: StuckRow): string =>
          instance.automatic === 'SLA_AUTO_APPROVE'
            ? '系統逾時自動同意'
            : readMemberText(instance.failedActorMemberId, profilesById),
        title: '上次失敗的人',
        width: 160,
      },
      {
        key: 'pendingActors',
        render: ({ instance }: StuckRow): string =>
          instance.pendingActorMemberIds.length
            ? instance.pendingActorMemberIds
                .map((memberId) => readMemberText(memberId, profilesById))
                .join('、')
            : '目前沒有人能按',
        title: '現在該重按的人',
        width: 180,
      },
      {
        key: 'message',
        render: ({ instance }: StuckRow): string => instance.message,
        title: '原因',
        width: 260,
      },
      {
        key: 'failedAt',
        render: ({ instance }: StuckRow): string =>
          formatDateTime(instance.failedAt),
        title: '時間',
        width: 180,
      },
    ],
    [profilesById],
  );

  const actions = useMemo(
    (): TableActions<StuckRow> => ({
      render: ({
        instance,
      }): ReturnType<TableActions<StuckRow>['render']> => [
        {
          name: '撤銷',
          onClick: (): void => setCancelTarget(instance),
        },
      ],
      variant: 'base-secondary',
      width: 100,
    }),
    [],
  );

  return (
    <>
      <PageHeader>
        <ContentHeader
          description="往下一關失敗、至今仍停在原處的案件。排除原因後由「現在該重按的人」再按一次即可；無法處理時可撤銷。"
          title="卡住的案件"
        />
      </PageHeader>

      <SectionGroup>
        <Section>
          <div style={STACK_STYLE}>
            {error ? (
              <Typography color="text-error" variant="body">
                {error}
              </Typography>
            ) : null}
            {!loading && !error && instances.length === 0 ? (
              <Typography color="text-neutral" variant="body">
                目前沒有卡住的案件
              </Typography>
            ) : null}
            {loading || instances.length ? (
              <Table
                actions={actions}
                columns={columns}
                dataSource={rows}
                fullWidth
                loading={loading}
              />
            ) : null}
          </div>
        </Section>
      </SectionGroup>

      <StuckInstanceCancelModal
        instance={cancelTarget}
        onCancelled={(): void => {
          setCancelTarget(null);
          void refresh();
        }}
        onClose={(): void => setCancelTarget(null)}
      />
    </>
  );
}

function readMemberIds(
  instances: readonly StuckApprovalInstanceRecord[],
): readonly string[] {
  return [
    ...new Set(
      instances.flatMap((instance): readonly string[] => [
        ...(instance.failedActorMemberId ? [instance.failedActorMemberId] : []),
        ...instance.pendingActorMemberIds,
      ]),
    ),
  ];
}

function readMemberText(
  memberId: string | null,
  profilesById: ReadonlyMap<string, MemberProfileRecord>,
): string {
  if (!memberId) {
    return '-';
  }

  return profilesById.get(memberId)?.name ?? memberId;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '載入卡住的案件失敗。';
}
