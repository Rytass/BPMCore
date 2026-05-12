'use client';

import {
  ChangeEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  BaseCard,
  Button,
  DatePicker,
  FormField,
  Input,
  Layout,
  Modal,
  Section,
  SectionGroup,
  Select,
  Tab,
  TabItem,
  Table,
  Textarea,
  Typography,
} from '@mezzanine-ui/react';
import { FormFieldDensity, FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { PlusIcon } from '@mezzanine-ui/icons';
import {
  MemberOption,
  OrgUnitPicker,
  OrgUnitOption,
  PositionOption,
  PositionPicker,
  MemberPicker,
  readMemberOption,
  readOrgUnitOption,
  readPositionOption,
} from '../_components/admin-pickers';
import {
  createManagerResolution,
  createMembership,
  createOrgUnit,
  createPosition,
  deleteManagerResolution,
  deleteMembership,
  deleteOrgUnit,
  ManagerResolutionRecord,
  ManagerResolutionScopeType,
  MembershipRecord,
  OrgUnitRecord,
  OrgUnitType,
  OrganizationSummaryRecord,
  PositionRecord,
  readOrganizationDashboard,
  updateManagerResolution,
  updateMembership,
  updateOrgUnit,
  updatePosition,
} from '../_lib/organization-api';
import { MemberProfileRecord, resolveMembers } from '../_lib/member-api';
import styles from './orgs.module.scss';
import { renderAppNavigation } from '../../app-navigation';

type AdminOrgTab = 'MANAGERS' | 'MEMBERSHIPS' | 'ORG_UNITS' | 'POSITIONS';

type OrgUnitRow = Readonly<
  Record<string, unknown> &
    OrgUnitRecord & {
      key: string;
      parentName: string;
    }
>;

type PositionRow = Readonly<
  Record<string, unknown> &
    PositionRecord & {
      key: string;
    }
>;

type MembershipRow = Readonly<
  Record<string, unknown> &
    MembershipRecord & {
      key: string;
      memberName: string;
      orgUnitName: string;
      positionName: string;
    }
>;

type ManagerResolutionRow = Readonly<
  Record<string, unknown> &
    ManagerResolutionRecord & {
      key: string;
      managerName: string;
      scopeLabel: string;
    }
>;

type OrgModalState = Readonly<{
  record: OrgUnitRecord | null;
  type: 'CREATE' | 'EDIT';
}>;

type PositionModalState = Readonly<{
  record: PositionRecord | null;
  type: 'CREATE' | 'EDIT';
}>;

type MembershipModalState = Readonly<{
  record: MembershipRecord | null;
  type: 'CREATE' | 'EDIT';
}>;

type ManagerModalState = Readonly<{
  record: ManagerResolutionRecord | null;
  type: 'CREATE' | 'EDIT';
}>;

type DeleteConfirmationState = Readonly<{
  confirmText: string;
  description: string;
  id: string;
  title: string;
  type: 'MANAGER_RESOLUTION' | 'MEMBERSHIP' | 'ORG_UNIT';
}>;

type OrgUnitTypeOption = Readonly<{
  id: OrgUnitType;
  name: string;
}>;

type ScopeTypeOption = Readonly<{
  id: ManagerResolutionScopeType;
  name: string;
}>;

type PrimaryOption = Readonly<{
  id: 'false' | 'true';
  name: string;
  value: boolean;
}>;

const ORG_UNIT_TYPES: readonly OrgUnitTypeOption[] = [
  { id: 'company', name: '公司' },
  { id: 'division', name: '事業群' },
  { id: 'department', name: '部門' },
  { id: 'team', name: '小組' },
];

const SCOPE_TYPES: readonly ScopeTypeOption[] = [
  { id: 'MEMBER', name: '指定會員' },
  { id: 'ORG_UNIT', name: '指定組織' },
  { id: 'POSITION', name: '指定職位' },
];

const PRIMARY_OPTIONS: readonly PrimaryOption[] = [
  { id: 'true', name: '主要歸屬', value: true },
  { id: 'false', name: '一般歸屬', value: false },
];

const EMPTY_SUMMARY: OrganizationSummaryRecord = {
  managerResolutionCount: 0,
  membershipCount: 0,
  orgUnitCount: 0,
  positionCount: 0,
};
const ORG_MODAL_FIELD_DENSITY = FormFieldDensity.WIDE;
const ORG_MODAL_FIELD_LAYOUT = FormFieldLayout.HORIZONTAL;

export default function AdminOrgsPage(): ReactElement {
  const [activeTab, setActiveTab] = useState<AdminOrgTab>('ORG_UNITS');
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmationState | null>(null);
  const [lastDeleteConfirmation, setLastDeleteConfirmation] =
    useState<DeleteConfirmationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [managerModal, setManagerModal] = useState<ManagerModalState | null>(
    null,
  );
  const [managerResolutions, setManagerResolutions] = useState<
    readonly ManagerResolutionRecord[]
  >([]);
  const [memberProfiles, setMemberProfiles] = useState<
    readonly MemberProfileRecord[]
  >([]);
  const [membershipModal, setMembershipModal] =
    useState<MembershipModalState | null>(null);
  const [memberships, setMemberships] = useState<readonly MembershipRecord[]>(
    [],
  );
  const [orgModal, setOrgModal] = useState<OrgModalState | null>(null);
  const [orgUnits, setOrgUnits] = useState<readonly OrgUnitRecord[]>([]);
  const [positionModal, setPositionModal] = useState<PositionModalState | null>(
    null,
  );
  const [positions, setPositions] = useState<readonly PositionRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] =
    useState<OrganizationSummaryRecord>(EMPTY_SUMMARY);

  useEffect((): void => {
    if (deleteConfirmation) {
      setLastDeleteConfirmation(deleteConfirmation);
    }
  }, [deleteConfirmation]);

  const visibleDeleteConfirmation =
    deleteConfirmation ?? lastDeleteConfirmation;

  const refreshOrganization = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const dashboard = await readOrganizationDashboard();
      const memberIds = readReferencedMemberIds(
        dashboard.memberships,
        dashboard.managerResolutions,
      );
      const profiles = await resolveMembers(memberIds);

      setManagerResolutions(dashboard.managerResolutions);
      setMemberships(dashboard.memberships);
      setMemberProfiles(profiles);
      setOrgUnits(dashboard.orgUnits);
      setPositions(dashboard.positions);
      setSummary(dashboard.organizationSummary);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect((): void => {
    void refreshOrganization();
  }, [refreshOrganization]);

  const orgUnitsById = useMemo(
    (): ReadonlyMap<string, OrgUnitRecord> =>
      new Map(orgUnits.map((orgUnit) => [orgUnit.id, orgUnit])),
    [orgUnits],
  );
  const positionsById = useMemo(
    (): ReadonlyMap<string, PositionRecord> =>
      new Map(positions.map((position) => [position.id, position])),
    [positions],
  );
  const membersById = useMemo(
    (): ReadonlyMap<string, MemberProfileRecord> =>
      new Map(memberProfiles.map((member) => [member.memberId, member])),
    [memberProfiles],
  );

  const orgRows = useMemo(
    (): OrgUnitRow[] =>
      orgUnits.map((orgUnit) => ({
        ...orgUnit,
        key: orgUnit.id,
        parentName: orgUnit.parentId
          ? readOrgUnitLabel(orgUnitsById.get(orgUnit.parentId))
          : '根節點',
      })),
    [orgUnits, orgUnitsById],
  );
  const positionRows = useMemo(
    (): PositionRow[] =>
      positions.map((position) => ({
        ...position,
        key: position.id,
      })),
    [positions],
  );
  const membershipRows = useMemo(
    (): MembershipRow[] =>
      memberships.map((membership) => ({
        ...membership,
        key: membership.id,
        memberName: readMemberLabel(membersById.get(membership.memberId)),
        orgUnitName: readOrgUnitLabel(orgUnitsById.get(membership.orgUnitId)),
        positionName: membership.positionId
          ? readPositionLabel(positionsById.get(membership.positionId))
          : '未指定',
      })),
    [membersById, memberships, orgUnitsById, positionsById],
  );
  const managerRows = useMemo(
    (): ManagerResolutionRow[] =>
      managerResolutions.map((resolution) => ({
        ...resolution,
        key: resolution.id,
        managerName: readMemberLabel(
          membersById.get(resolution.managerMemberId),
        ),
        scopeLabel: readScopeLabel(resolution, {
          membersById,
          orgUnitsById,
          positionsById,
        }),
      })),
    [managerResolutions, membersById, orgUnitsById, positionsById],
  );

  const orgActions = useMemo(
    (): TableActions<OrgUnitRow> => ({
      render: (record): ReturnType<TableActions<OrgUnitRow>['render']> => [
        {
          name: '編輯',
          onClick: (): void => setOrgModal({ record, type: 'EDIT' }),
        },
        {
          name: '停用',
          onClick: (): void =>
            setDeleteConfirmation({
              confirmText: '停用組織',
              description: `停用「${record.name}」後，這個組織節點將不再出現在可用組織清單中。`,
              id: record.id,
              title: '停用組織節點',
              type: 'ORG_UNIT',
            }),
          variant: 'destructive-secondary',
        },
      ],
      variant: 'base-secondary',
      width: 128,
    }),
    [],
  );
  const positionActions = useMemo(
    (): TableActions<PositionRow> => ({
      render: (record): ReturnType<TableActions<PositionRow>['render']> => [
        {
          name: '編輯',
          onClick: (): void => setPositionModal({ record, type: 'EDIT' }),
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [],
  );
  const membershipActions = useMemo(
    (): TableActions<MembershipRow> => ({
      render: (record): ReturnType<TableActions<MembershipRow>['render']> => [
        {
          name: '編輯',
          onClick: (): void => setMembershipModal({ record, type: 'EDIT' }),
        },
        {
          name: '刪除',
          onClick: (): void =>
            setDeleteConfirmation({
              confirmText: '刪除歸屬',
              description: `刪除「${record.memberName}」在「${record.orgUnitName}」的會員歸屬。`,
              id: record.id,
              title: '刪除會員歸屬',
              type: 'MEMBERSHIP',
            }),
          variant: 'destructive-secondary',
        },
      ],
      variant: 'base-secondary',
      width: 128,
    }),
    [],
  );
  const managerActions = useMemo(
    (): TableActions<ManagerResolutionRow> => ({
      render: (
        record,
      ): ReturnType<TableActions<ManagerResolutionRow>['render']> => [
        {
          name: '編輯',
          onClick: (): void => setManagerModal({ record, type: 'EDIT' }),
        },
        {
          name: '刪除',
          onClick: (): void =>
            setDeleteConfirmation({
              confirmText: '刪除主管規則',
              description: `刪除「${record.scopeLabel}」指派給「${record.managerName}」的主管解析規則。`,
              id: record.id,
              title: '刪除主管解析規則',
              type: 'MANAGER_RESOLUTION',
            }),
          variant: 'destructive-secondary',
        },
      ],
      variant: 'base-secondary',
      width: 128,
    }),
    [],
  );

  function closeDeleteConfirmation(): void {
    if (saving) {
      return;
    }

    setDeleteConfirmation(null);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!deleteConfirmation) {
      return;
    }

    await runMutation(async (): Promise<void> => {
      if (deleteConfirmation.type === 'ORG_UNIT') {
        await deleteOrgUnit(deleteConfirmation.id);
      }

      if (deleteConfirmation.type === 'MEMBERSHIP') {
        await deleteMembership(deleteConfirmation.id);
      }

      if (deleteConfirmation.type === 'MANAGER_RESOLUTION') {
        await deleteManagerResolution(deleteConfirmation.id);
      }

      setDeleteConfirmation(null);
    });
  }

  async function runMutation(mutation: () => Promise<void>): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      await mutation();
      await refreshOrganization();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      {renderAppNavigation('/admin/orgs')}

      <Layout.Main>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Typography component="h1" variant="h2">
              組織管理
            </Typography>
            <Typography color="text-neutral" variant="body">
              維護 BPM 組織樹、職位、會員歸屬與簽核主管解析規則。
            </Typography>
          </div>
        </div>

        <SectionGroup>
          <Section>
            <div className={styles.summaryGrid}>
              <SummaryCard label="組織節點" value={summary.orgUnitCount} />
              <SummaryCard label="職位" value={summary.positionCount} />
              <SummaryCard label="會員歸屬" value={summary.membershipCount} />
              <SummaryCard
                label="主管規則"
                value={summary.managerResolutionCount}
              />
            </div>
          </Section>

          <Section
            tab={
              <Tab
                activeKey={activeTab}
                onChange={(key): void => setActiveTab(readAdminOrgTab(key))}
              >
                <TabItem key="ORG_UNITS">組織樹</TabItem>
                <TabItem key="POSITIONS">職位</TabItem>
                <TabItem key="MEMBERSHIPS">會員歸屬</TabItem>
                <TabItem key="MANAGERS">簽核主管</TabItem>
              </Tab>
            }
          >
            {error ? (
              <Typography color="text-error" variant="body">
                {error}
              </Typography>
            ) : null}
            {activeTab === 'ORG_UNITS' ? (
              <OrgUnitPanel
                actions={orgActions}
                loading={loading}
                onCreate={(): void =>
                  setOrgModal({ record: null, type: 'CREATE' })
                }
                rows={orgRows}
              />
            ) : null}
            {activeTab === 'POSITIONS' ? (
              <PositionPanel
                actions={positionActions}
                loading={loading}
                onCreate={(): void =>
                  setPositionModal({ record: null, type: 'CREATE' })
                }
                rows={positionRows}
              />
            ) : null}
            {activeTab === 'MEMBERSHIPS' ? (
              <MembershipPanel
                actions={membershipActions}
                loading={loading}
                onCreate={(): void =>
                  setMembershipModal({ record: null, type: 'CREATE' })
                }
                rows={membershipRows}
              />
            ) : null}
            {activeTab === 'MANAGERS' ? (
              <ManagerPanel
                actions={managerActions}
                loading={loading}
                onCreate={(): void =>
                  setManagerModal({ record: null, type: 'CREATE' })
                }
                rows={managerRows}
              />
            ) : null}
          </Section>
        </SectionGroup>

        <OrgUnitModal
          modal={orgModal}
          onClose={(): void => setOrgModal(null)}
          onSubmit={(input): Promise<void> =>
            runMutation(async (): Promise<void> => {
              if (orgModal?.type === 'EDIT' && orgModal.record) {
                await updateOrgUnit({ ...input, id: orgModal.record.id });
              } else {
                await createOrgUnit({
                  code: input.code ?? '',
                  metadataJson: input.metadataJson ?? '{}',
                  name: input.name ?? '',
                  parentId: input.parentId,
                  type: input.type ?? 'department',
                });
              }
              setOrgModal(null);
            })
          }
          orgUnits={orgUnits}
          saving={saving}
        />
        <PositionModal
          modal={positionModal}
          onClose={(): void => setPositionModal(null)}
          onSubmit={(input): Promise<void> =>
            runMutation(async (): Promise<void> => {
              if (positionModal?.type === 'EDIT' && positionModal.record) {
                await updatePosition({ ...input, id: positionModal.record.id });
              } else {
                await createPosition({
                  code: input.code ?? '',
                  level: input.level ?? 0,
                  metadataJson: input.metadataJson ?? '{}',
                  name: input.name ?? '',
                });
              }
              setPositionModal(null);
            })
          }
          saving={saving}
        />
        <MembershipModal
          membersById={membersById}
          modal={membershipModal}
          onClose={(): void => setMembershipModal(null)}
          onSubmit={(input): Promise<void> =>
            runMutation(async (): Promise<void> => {
              if (membershipModal?.type === 'EDIT' && membershipModal.record) {
                await updateMembership({
                  ...input,
                  id: membershipModal.record.id,
                });
              } else {
                await createMembership({
                  effectiveFrom: input.effectiveFrom ?? today(),
                  effectiveTo: input.effectiveTo,
                  isPrimary: input.isPrimary ?? false,
                  memberId: input.memberId ?? '',
                  orgUnitId: input.orgUnitId ?? '',
                  positionId: input.positionId,
                });
              }
              setMembershipModal(null);
            })
          }
          orgUnits={orgUnits}
          positions={positions}
          saving={saving}
        />
        <ManagerResolutionModal
          membersById={membersById}
          modal={managerModal}
          onClose={(): void => setManagerModal(null)}
          onSubmit={(input): Promise<void> =>
            runMutation(async (): Promise<void> => {
              if (managerModal?.type === 'EDIT' && managerModal.record) {
                await updateManagerResolution({
                  ...input,
                  id: managerModal.record.id,
                });
              } else {
                await createManagerResolution({
                  effectiveFrom: input.effectiveFrom ?? today(),
                  effectiveTo: input.effectiveTo,
                  managerMemberId: input.managerMemberId ?? '',
                  priority: input.priority ?? 0,
                  scopeId: input.scopeId ?? '',
                  scopeType: input.scopeType ?? 'MEMBER',
                });
              }
              setManagerModal(null);
            })
          }
          orgUnits={orgUnits}
          positions={positions}
          saving={saving}
        />
        <Modal
          cancelText="取消"
          confirmButtonProps={{ variant: 'destructive-primary' }}
          confirmText={visibleDeleteConfirmation?.confirmText ?? ''}
          loading={saving}
          modalStatusType="error"
          modalType="standard"
          onCancel={closeDeleteConfirmation}
          onClose={closeDeleteConfirmation}
          onConfirm={(): void => void handleConfirmDelete()}
          open={Boolean(deleteConfirmation)}
          showModalFooter
          showModalHeader
          size="regular"
          supportingText="此操作會立即套用，請確認後再繼續。"
          title={visibleDeleteConfirmation?.title ?? ''}
        >
          <Typography color="text-neutral" variant="body">
            {visibleDeleteConfirmation?.description ?? ''}
          </Typography>
        </Modal>
      </Layout.Main>
    </Layout>
  );
}

function SummaryCard({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): ReactElement {
  return (
    <BaseCard title={label}>
      <div className={styles.summaryItem}>
        <Typography variant="h3">{value.toLocaleString()}</Typography>
        <Typography color="text-neutral" variant="caption">
          目前有效資料
        </Typography>
      </div>
    </BaseCard>
  );
}

function OrgUnitPanel({
  actions,
  loading,
  onCreate,
  rows,
}: {
  readonly actions: TableActions<OrgUnitRow>;
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly rows: readonly OrgUnitRow[];
}): ReactElement {
  const columns = useMemo(
    (): TableColumn<OrgUnitRow>[] => [
      { dataIndex: 'code', key: 'code', title: '代碼', width: 160 },
      { dataIndex: 'name', key: 'name', title: '名稱', width: 180 },
      { dataIndex: 'type', key: 'type', title: '類型', width: 140 },
      { dataIndex: 'parentName', key: 'parentName', title: '上層', width: 220 },
      { dataIndex: 'path', key: 'path', title: 'Path', width: 260 },
    ],
    [],
  );

  return (
    <>
      <PanelIntro
        actionLabel="新增組織"
        description="組織節點使用 ltree path 維護階層，搬移節點會同步更新子節點 path。"
        onCreate={onCreate}
        title="組織樹"
      />
      <div className={styles.tableFrame}>
        <Table
          actions={actions}
          columns={columns}
          dataSource={[...rows]}
          fullWidth
          loading={loading}
        />
      </div>
    </>
  );
}

function PositionPanel({
  actions,
  loading,
  onCreate,
  rows,
}: {
  readonly actions: TableActions<PositionRow>;
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly rows: readonly PositionRow[];
}): ReactElement {
  const columns = useMemo(
    (): TableColumn<PositionRow>[] => [
      { dataIndex: 'code', key: 'code', title: '代碼', width: 180 },
      { dataIndex: 'name', key: 'name', title: '名稱', width: 220 },
      { dataIndex: 'level', key: 'level', title: '職等', width: 120 },
      {
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        title: '更新時間',
        width: 220,
      },
    ],
    [],
  );

  return (
    <>
      <PanelIntro
        actionLabel="新增職位"
        description="職位提供會員歸屬與主管解析規則使用。"
        onCreate={onCreate}
        title="職位"
      />
      <div className={styles.tableFrame}>
        <Table
          actions={actions}
          columns={columns}
          dataSource={[...rows]}
          fullWidth
          loading={loading}
        />
      </div>
    </>
  );
}

function MembershipPanel({
  actions,
  loading,
  onCreate,
  rows,
}: {
  readonly actions: TableActions<MembershipRow>;
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly rows: readonly MembershipRow[];
}): ReactElement {
  const columns = useMemo(
    (): TableColumn<MembershipRow>[] => [
      { dataIndex: 'memberName', key: 'memberName', title: '會員', width: 240 },
      {
        dataIndex: 'orgUnitName',
        key: 'orgUnitName',
        title: '組織',
        width: 220,
      },
      {
        dataIndex: 'positionName',
        key: 'positionName',
        title: '職位',
        width: 180,
      },
      {
        key: 'isPrimary',
        render: (record: MembershipRow): string =>
          record.isPrimary ? '主要' : '一般',
        title: '類型',
        width: 100,
      },
      {
        dataIndex: 'effectiveFrom',
        key: 'effectiveFrom',
        title: '生效日',
        width: 140,
      },
      {
        dataIndex: 'effectiveTo',
        key: 'effectiveTo',
        title: '結束日',
        width: 140,
      },
    ],
    [],
  );

  return (
    <>
      <PanelIntro
        actionLabel="新增歸屬"
        description="會員歸屬是 BPM 內部組織權限、主管解析與條件判斷的來源。"
        onCreate={onCreate}
        title="會員歸屬"
      />
      <div className={styles.tableFrame}>
        <Table
          actions={actions}
          columns={columns}
          dataSource={[...rows]}
          fullWidth
          loading={loading}
        />
      </div>
    </>
  );
}

function ManagerPanel({
  actions,
  loading,
  onCreate,
  rows,
}: {
  readonly actions: TableActions<ManagerResolutionRow>;
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly rows: readonly ManagerResolutionRow[];
}): ReactElement {
  const columns = useMemo(
    (): TableColumn<ManagerResolutionRow>[] => [
      {
        dataIndex: 'scopeLabel',
        key: 'scopeLabel',
        title: '套用範圍',
        width: 260,
      },
      {
        dataIndex: 'managerName',
        key: 'managerName',
        title: '簽核主管',
        width: 240,
      },
      { dataIndex: 'priority', key: 'priority', title: '優先序', width: 120 },
      {
        dataIndex: 'effectiveFrom',
        key: 'effectiveFrom',
        title: '生效日',
        width: 140,
      },
      {
        dataIndex: 'effectiveTo',
        key: 'effectiveTo',
        title: '結束日',
        width: 140,
      },
    ],
    [],
  );

  return (
    <>
      <PanelIntro
        actionLabel="新增主管規則"
        description="簽核主管規則獨立於組織樹 parent，解析優先序為會員、組織、職位。"
        onCreate={onCreate}
        title="簽核主管"
      />
      <div className={styles.tableFrame}>
        <Table
          actions={actions}
          columns={columns}
          dataSource={[...rows]}
          fullWidth
          loading={loading}
        />
      </div>
    </>
  );
}

function PanelIntro({
  actionLabel,
  description,
  onCreate,
  title,
}: {
  readonly actionLabel: string;
  readonly description: string;
  readonly onCreate: () => void;
  readonly title: string;
}): ReactElement {
  return (
    <div className={styles.tableIntro}>
      <div>
        <Typography component="h2" variant="h3">
          {title}
        </Typography>
        <Typography color="text-neutral" variant="body">
          {description}
        </Typography>
      </div>
      <Button icon={PlusIcon} iconType="leading" onClick={onCreate}>
        {actionLabel}
      </Button>
    </div>
  );
}

function OrgUnitModal({
  modal,
  onClose,
  onSubmit,
  orgUnits,
  saving,
}: {
  readonly modal: OrgModalState | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: {
    readonly code: string | null;
    readonly metadataJson: string | null;
    readonly name: string | null;
    readonly parentId: string | null;
    readonly type: OrgUnitType | null;
  }) => Promise<void>;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly saving: boolean;
}): ReactElement {
  const [code, setCode] = useState('');
  const [metadataJson, setMetadataJson] = useState('{}');
  const [name, setName] = useState('');
  const [parent, setParent] = useState<OrgUnitOption | null>(null);
  const [type, setType] = useState<OrgUnitTypeOption>(ORG_UNIT_TYPES[2]);

  useEffect((): void => {
    if (!modal) {
      return;
    }

    const record = modal.record;

    setCode(record?.code ?? '');
    setMetadataJson('{}');
    setName(record?.name ?? '');
    setParent(
      record?.parentId
        ? readOrgUnitOption(
            orgUnits.find((orgUnit) => orgUnit.id === record.parentId) ??
              record,
          )
        : null,
    );
    setType(
      ORG_UNIT_TYPES.find((option) => option.id === record?.type) ??
        ORG_UNIT_TYPES[2],
    );
  }, [modal, orgUnits]);

  return (
    <Modal
      cancelText="取消"
      confirmButtonProps={{ disabled: !code || !name }}
      confirmText={modal?.type === 'EDIT' ? '儲存' : '建立'}
      loading={saving}
      modalType="standard"
      onCancel={onClose}
      onClose={onClose}
      onConfirm={(): void =>
        void onSubmit({
          code,
          metadataJson,
          name,
          parentId: parent?.id ?? null,
          type: type.id,
        })
      }
      open={Boolean(modal)}
      showModalFooter
      showModalHeader
      size="regular"
      title={modal?.type === 'EDIT' ? '編輯組織' : '新增組織'}
    >
      <div className={styles.modalFields}>
        <TextField
          label="代碼"
          name="orgCode"
          onChange={setCode}
          placeholder="例如 FIN-TW"
          value={code}
        />
        <TextField
          label="名稱"
          name="orgName"
          onChange={setName}
          placeholder="例如 財務部"
          value={name}
        />
        <FormField
          density={ORG_MODAL_FIELD_DENSITY}
          fullWidth
          label="類型"
          layout={ORG_MODAL_FIELD_LAYOUT}
          name="orgType"
        >
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void => setType(readOrgUnitTypeOption(option))}
            options={[...ORG_UNIT_TYPES]}
            placeholder="選擇組織類型"
            value={type}
          />
        </FormField>
        <FormField
          density={ORG_MODAL_FIELD_DENSITY}
          fullWidth
          label="上層組織"
          layout={ORG_MODAL_FIELD_LAYOUT}
          name="parentId"
        >
          <OrgUnitPicker
            name="parentId"
            onChange={setParent}
            orgUnits={orgUnits.filter(
              (orgUnit) => orgUnit.id !== modal?.record?.id,
            )}
            placeholder="選擇上層組織"
            value={parent}
          />
        </FormField>
        <JsonField
          label="Metadata JSON"
          name="orgMetadataJson"
          onChange={setMetadataJson}
          placeholder='例如 {"costCenter":"FIN"}'
          value={metadataJson}
        />
      </div>
    </Modal>
  );
}

function PositionModal({
  modal,
  onClose,
  onSubmit,
  saving,
}: {
  readonly modal: PositionModalState | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: {
    readonly code: string | null;
    readonly level: number | null;
    readonly metadataJson: string | null;
    readonly name: string | null;
  }) => Promise<void>;
  readonly saving: boolean;
}): ReactElement {
  const [code, setCode] = useState('');
  const [level, setLevel] = useState('0');
  const [metadataJson, setMetadataJson] = useState('{}');
  const [name, setName] = useState('');

  useEffect((): void => {
    if (!modal) {
      return;
    }

    setCode(modal.record?.code ?? '');
    setLevel(String(modal.record?.level ?? 0));
    setMetadataJson('{}');
    setName(modal.record?.name ?? '');
  }, [modal]);

  return (
    <Modal
      cancelText="取消"
      confirmButtonProps={{ disabled: !code || !name }}
      confirmText={modal?.type === 'EDIT' ? '儲存' : '建立'}
      loading={saving}
      modalType="standard"
      onCancel={onClose}
      onClose={onClose}
      onConfirm={(): void =>
        void onSubmit({
          code,
          level: Number(level),
          metadataJson,
          name,
        })
      }
      open={Boolean(modal)}
      showModalFooter
      showModalHeader
      size="regular"
      title={modal?.type === 'EDIT' ? '編輯職位' : '新增職位'}
    >
      <div className={styles.modalFields}>
        <TextField
          label="代碼"
          name="positionCode"
          onChange={setCode}
          placeholder="例如 FIN-MGR"
          value={code}
        />
        <TextField
          label="名稱"
          name="positionName"
          onChange={setName}
          placeholder="例如 財務主管"
          value={name}
        />
        <TextField
          label="職等"
          name="positionLevel"
          onChange={setLevel}
          placeholder="例如 5"
          value={level}
        />
        <JsonField
          label="Metadata JSON"
          name="positionMetadataJson"
          onChange={setMetadataJson}
          placeholder='例如 {"grade":"M1"}'
          value={metadataJson}
        />
      </div>
    </Modal>
  );
}

function MembershipModal({
  membersById,
  modal,
  onClose,
  onSubmit,
  orgUnits,
  positions,
  saving,
}: {
  readonly membersById: ReadonlyMap<string, MemberProfileRecord>;
  readonly modal: MembershipModalState | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: {
    readonly effectiveFrom: string | null;
    readonly effectiveTo: string | null;
    readonly isPrimary: boolean | null;
    readonly memberId: string | null;
    readonly orgUnitId: string | null;
    readonly positionId: string | null;
  }) => Promise<void>;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly positions: readonly PositionRecord[];
  readonly saving: boolean;
}): ReactElement {
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [isPrimary, setIsPrimary] = useState<PrimaryOption>(PRIMARY_OPTIONS[1]);
  const [member, setMember] = useState<MemberOption | null>(null);
  const [orgUnit, setOrgUnit] = useState<OrgUnitOption | null>(null);
  const [position, setPosition] = useState<PositionOption | null>(null);

  useEffect((): void => {
    if (!modal) {
      return;
    }

    const record = modal.record;
    const profile = record ? membersById.get(record.memberId) : null;

    setEffectiveFrom(record?.effectiveFrom ?? today());
    setEffectiveTo(record?.effectiveTo ?? '');
    setIsPrimary(
      PRIMARY_OPTIONS.find((option) => option.value === record?.isPrimary) ??
        PRIMARY_OPTIONS[1],
    );
    setMember(profile ? readMemberOption(profile) : null);
    setOrgUnit(
      readNullableOption(
        orgUnits.find((candidate) => candidate.id === record?.orgUnitId),
        readOrgUnitOption,
      ),
    );
    setPosition(
      readNullableOption(
        positions.find((candidate) => candidate.id === record?.positionId),
        readPositionOption,
      ),
    );
  }, [membersById, modal, orgUnits, positions]);

  return (
    <Modal
      cancelText="取消"
      confirmButtonProps={{ disabled: !member || !orgUnit }}
      confirmText={modal?.type === 'EDIT' ? '儲存' : '建立'}
      loading={saving}
      modalType="standard"
      onCancel={onClose}
      onClose={onClose}
      onConfirm={(): void =>
        void onSubmit({
          effectiveFrom,
          effectiveTo: effectiveTo || null,
          isPrimary: isPrimary.value,
          memberId: member?.id ?? null,
          orgUnitId: orgUnit?.id ?? null,
          positionId: position?.id ?? null,
        })
      }
      open={Boolean(modal)}
      showModalFooter
      showModalHeader
      size="regular"
      title={modal?.type === 'EDIT' ? '編輯會員歸屬' : '新增會員歸屬'}
    >
      <div className={styles.modalFields}>
        <FormField
          density={ORG_MODAL_FIELD_DENSITY}
          fullWidth
          label="會員"
          layout={ORG_MODAL_FIELD_LAYOUT}
          name="memberId"
        >
          <MemberPicker
            name="memberId"
            onChange={setMember}
            placeholder="搜尋會員姓名或信箱"
            value={member}
          />
        </FormField>
        <FormField
          density={ORG_MODAL_FIELD_DENSITY}
          fullWidth
          label="組織"
          layout={ORG_MODAL_FIELD_LAYOUT}
          name="orgUnitId"
        >
          <OrgUnitPicker
            name="orgUnitId"
            onChange={setOrgUnit}
            orgUnits={orgUnits}
            placeholder="選擇歸屬組織"
            value={orgUnit}
          />
        </FormField>
        <FormField
          density={ORG_MODAL_FIELD_DENSITY}
          fullWidth
          label="職位"
          layout={ORG_MODAL_FIELD_LAYOUT}
          name="positionId"
        >
          <PositionPicker
            name="positionId"
            onChange={setPosition}
            placeholder="選擇職位"
            positions={positions}
            value={position}
          />
        </FormField>
        <FormField
          density={ORG_MODAL_FIELD_DENSITY}
          fullWidth
          label="歸屬類型"
          layout={ORG_MODAL_FIELD_LAYOUT}
          name="isPrimary"
        >
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void => setIsPrimary(readPrimaryOption(option))}
            options={[...PRIMARY_OPTIONS]}
            placeholder="選擇歸屬類型"
            value={isPrimary}
          />
        </FormField>
        <DateField
          label="生效日"
          name="membershipEffectiveFrom"
          onChange={setEffectiveFrom}
          placeholder="YYYY-MM-DD"
          value={effectiveFrom}
        />
        <DateField
          label="結束日"
          name="membershipEffectiveTo"
          onChange={setEffectiveTo}
          placeholder="YYYY-MM-DD，未設定代表無期限"
          value={effectiveTo}
        />
      </div>
    </Modal>
  );
}

function ManagerResolutionModal({
  membersById,
  modal,
  onClose,
  onSubmit,
  orgUnits,
  positions,
  saving,
}: {
  readonly membersById: ReadonlyMap<string, MemberProfileRecord>;
  readonly modal: ManagerModalState | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: {
    readonly effectiveFrom: string | null;
    readonly effectiveTo: string | null;
    readonly managerMemberId: string | null;
    readonly priority: number | null;
    readonly scopeId: string | null;
    readonly scopeType: ManagerResolutionScopeType | null;
  }) => Promise<void>;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly positions: readonly PositionRecord[];
  readonly saving: boolean;
}): ReactElement {
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [manager, setManager] = useState<MemberOption | null>(null);
  const [priority, setPriority] = useState('0');
  const [scopeMember, setScopeMember] = useState<MemberOption | null>(null);
  const [scopeOrgUnit, setScopeOrgUnit] = useState<OrgUnitOption | null>(null);
  const [scopePosition, setScopePosition] = useState<PositionOption | null>(
    null,
  );
  const [scopeType, setScopeType] = useState<ScopeTypeOption>(SCOPE_TYPES[0]);

  useEffect((): void => {
    if (!modal) {
      return;
    }

    const record = modal.record;
    const nextScopeType =
      SCOPE_TYPES.find((option) => option.id === record?.scopeType) ??
      SCOPE_TYPES[0];

    setEffectiveFrom(record?.effectiveFrom ?? today());
    setEffectiveTo(record?.effectiveTo ?? '');
    setManager(
      readNullableOption(
        record ? membersById.get(record.managerMemberId) : null,
        readMemberOption,
      ),
    );
    setPriority(String(record?.priority ?? 0));
    setScopeMember(
      nextScopeType.id === 'MEMBER'
        ? readNullableOption(
            record ? membersById.get(record.scopeId) : null,
            readMemberOption,
          )
        : null,
    );
    setScopeOrgUnit(
      nextScopeType.id === 'ORG_UNIT'
        ? readNullableOption(
            orgUnits.find((candidate) => candidate.id === record?.scopeId),
            readOrgUnitOption,
          )
        : null,
    );
    setScopePosition(
      nextScopeType.id === 'POSITION'
        ? readNullableOption(
            positions.find((candidate) => candidate.id === record?.scopeId),
            readPositionOption,
          )
        : null,
    );
    setScopeType(nextScopeType);
  }, [membersById, modal, orgUnits, positions]);

  const scopeId =
    scopeType.id === 'MEMBER'
      ? scopeMember?.id
      : scopeType.id === 'ORG_UNIT'
        ? scopeOrgUnit?.id
        : scopePosition?.id;
  const isSelfManagerResolution = Boolean(
    scopeType.id === 'MEMBER' &&
    scopeMember?.id &&
    manager?.id &&
    scopeMember.id === manager.id,
  );

  return (
    <Modal
      cancelText="取消"
      confirmButtonProps={{
        disabled: !manager || !scopeId || isSelfManagerResolution,
      }}
      confirmText={modal?.type === 'EDIT' ? '儲存' : '建立'}
      loading={saving}
      modalType="standard"
      onCancel={onClose}
      onClose={onClose}
      onConfirm={(): void =>
        void onSubmit({
          effectiveFrom,
          effectiveTo: effectiveTo || null,
          managerMemberId: manager?.id ?? null,
          priority: Number(priority),
          scopeId: scopeId ?? null,
          scopeType: scopeType.id,
        })
      }
      open={Boolean(modal)}
      showModalFooter
      showModalHeader
      size="regular"
      title={modal?.type === 'EDIT' ? '編輯主管規則' : '新增主管規則'}
    >
      <div className={styles.modalFields}>
        <FormField
          density={ORG_MODAL_FIELD_DENSITY}
          fullWidth
          label="套用範圍"
          layout={ORG_MODAL_FIELD_LAYOUT}
          name="scopeType"
        >
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void =>
              setScopeType(readScopeTypeOption(option))
            }
            options={[...SCOPE_TYPES]}
            placeholder="選擇套用範圍"
            value={scopeType}
          />
        </FormField>
        {scopeType.id === 'MEMBER' ? (
          <FormField
            density={ORG_MODAL_FIELD_DENSITY}
            fullWidth
            label="會員"
            layout={ORG_MODAL_FIELD_LAYOUT}
            name="scopeMemberId"
          >
            <MemberPicker
              name="scopeMemberId"
              onChange={setScopeMember}
              placeholder="搜尋套用會員"
              value={scopeMember}
            />
          </FormField>
        ) : null}
        {scopeType.id === 'ORG_UNIT' ? (
          <FormField
            density={ORG_MODAL_FIELD_DENSITY}
            fullWidth
            label="組織"
            layout={ORG_MODAL_FIELD_LAYOUT}
            name="scopeOrgUnitId"
          >
            <OrgUnitPicker
              name="scopeOrgUnitId"
              onChange={setScopeOrgUnit}
              orgUnits={orgUnits}
              placeholder="選擇套用組織"
              value={scopeOrgUnit}
            />
          </FormField>
        ) : null}
        {scopeType.id === 'POSITION' ? (
          <FormField
            density={ORG_MODAL_FIELD_DENSITY}
            fullWidth
            label="職位"
            layout={ORG_MODAL_FIELD_LAYOUT}
            name="scopePositionId"
          >
            <PositionPicker
              name="scopePositionId"
              onChange={setScopePosition}
              placeholder="選擇套用職位"
              positions={positions}
              value={scopePosition}
            />
          </FormField>
        ) : null}
        <FormField
          density={ORG_MODAL_FIELD_DENSITY}
          fullWidth
          label="簽核主管"
          layout={ORG_MODAL_FIELD_LAYOUT}
          name="managerMemberId"
        >
          <MemberPicker
            name="managerMemberId"
            onChange={setManager}
            placeholder="搜尋簽核主管"
            value={manager}
          />
        </FormField>
        {isSelfManagerResolution ? (
          <Typography color="text-error" variant="caption">
            簽核主管不可設定為套用會員本人。
          </Typography>
        ) : null}
        <TextField
          label="優先序"
          name="managerPriority"
          onChange={setPriority}
          placeholder="例如 10"
          value={priority}
        />
        <DateField
          label="生效日"
          name="managerEffectiveFrom"
          onChange={setEffectiveFrom}
          placeholder="YYYY-MM-DD"
          value={effectiveFrom}
        />
        <DateField
          label="結束日"
          name="managerEffectiveTo"
          onChange={setEffectiveTo}
          placeholder="YYYY-MM-DD，未設定代表無期限"
          value={effectiveTo}
        />
      </div>
    </Modal>
  );
}

function TextField({
  label,
  name,
  onChange,
  placeholder,
  value,
}: {
  readonly label: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}): ReactElement {
  return (
    <FormField
      density={ORG_MODAL_FIELD_DENSITY}
      fullWidth
      label={label}
      layout={ORG_MODAL_FIELD_LAYOUT}
      name={name}
    >
      <Input
        fullWidth
        name={name}
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        value={value}
      />
    </FormField>
  );
}

function DateField({
  label,
  name,
  onChange,
  placeholder,
  value,
}: {
  readonly label: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}): ReactElement {
  return (
    <FormField
      density={ORG_MODAL_FIELD_DENSITY}
      fullWidth
      label={label}
      layout={ORG_MODAL_FIELD_LAYOUT}
      name={name}
    >
      <DatePicker
        format="YYYY-MM-DD"
        fullWidth
        inputProps={{ name }}
        onChange={(nextValue): void => onChange(formatDateOnly(nextValue))}
        placeholder={placeholder}
        value={value.trim() ? value : undefined}
      />
    </FormField>
  );
}

function JsonField({
  label,
  name,
  onChange,
  placeholder,
  value,
}: {
  readonly label: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}): ReactElement {
  return (
    <FormField
      density={ORG_MODAL_FIELD_DENSITY}
      fullWidth
      label={label}
      layout={ORG_MODAL_FIELD_LAYOUT}
      name={name}
    >
      <Textarea
        name={name}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        rows={3}
        value={value}
      />
    </FormField>
  );
}

function readReferencedMemberIds(
  memberships: readonly MembershipRecord[],
  managerResolutions: readonly ManagerResolutionRecord[],
): readonly string[] {
  return [
    ...new Set([
      ...memberships.map((membership) => membership.memberId),
      ...managerResolutions.map((resolution) => resolution.managerMemberId),
      ...managerResolutions
        .filter((resolution) => resolution.scopeType === 'MEMBER')
        .map((resolution) => resolution.scopeId),
    ]),
  ];
}

function readScopeLabel(
  resolution: ManagerResolutionRecord,
  lookup: {
    readonly membersById: ReadonlyMap<string, MemberProfileRecord>;
    readonly orgUnitsById: ReadonlyMap<string, OrgUnitRecord>;
    readonly positionsById: ReadonlyMap<string, PositionRecord>;
  },
): string {
  if (resolution.scopeType === 'MEMBER') {
    return `會員：${readMemberLabel(lookup.membersById.get(resolution.scopeId))}`;
  }

  if (resolution.scopeType === 'ORG_UNIT') {
    return `組織：${readOrgUnitLabel(lookup.orgUnitsById.get(resolution.scopeId))}`;
  }

  return `職位：${readPositionLabel(lookup.positionsById.get(resolution.scopeId))}`;
}

function readMemberLabel(member: MemberProfileRecord | undefined): string {
  return member ? `${member.name} · ${member.email}` : '未知會員';
}

function readOrgUnitLabel(orgUnit: OrgUnitRecord | undefined): string {
  return orgUnit ? `${orgUnit.name} · ${orgUnit.code}` : '未知組織';
}

function readPositionLabel(position: PositionRecord | undefined): string {
  return position ? `${position.name} · ${position.code}` : '未指定';
}

function readAdminOrgTab(value: unknown): AdminOrgTab {
  return value === 'MANAGERS' ||
    value === 'MEMBERSHIPS' ||
    value === 'POSITIONS'
    ? value
    : 'ORG_UNITS';
}

function readOrgUnitTypeOption(value: unknown): OrgUnitTypeOption {
  return readOption(value, ORG_UNIT_TYPES, ORG_UNIT_TYPES[2]);
}

function readScopeTypeOption(value: unknown): ScopeTypeOption {
  return readOption(value, SCOPE_TYPES, SCOPE_TYPES[0]);
}

function readPrimaryOption(value: unknown): PrimaryOption {
  return readOption(value, PRIMARY_OPTIONS, PRIMARY_OPTIONS[1]);
}

function readOption<TOption extends { readonly id: string }>(
  value: unknown,
  options: readonly TOption[],
  fallback: TOption,
): TOption {
  const id = isRecord(value) && typeof value.id === 'string' ? value.id : null;

  return options.find((option) => option.id === id) ?? fallback;
}

function readNullableOption<TValue, TOption>(
  value: TValue | null | undefined,
  mapper: (value: TValue) => TOption,
): TOption | null {
  return value ? mapper(value) : null;
}

function today(): string {
  return formatDateParts(new Date());
}

function formatDateOnly(value: string | undefined): string {
  const date = value ? new Date(value) : null;

  return date && !Number.isNaN(date.getTime()) ? formatDateParts(date) : '';
}

function formatDateParts(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate(),
  )}`;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '讀取組織資料失敗。';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
