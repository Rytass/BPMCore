'use client';

import {
  ChangeEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AutoComplete,
  Button,
  DatePicker,
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Input,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Tab,
  TabItem,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import {
  CloseIcon,
  EditIcon,
  PlusIcon,
  SaveIcon,
} from '@mezzanine-ui/icons';
import type { IconDefinition } from '@mezzanine-ui/icons';
import { BPMFormField } from '../../../components/bpm-form-field';
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
} from '../../../components/admin-pickers';
import {
  commitOrgUnitTreeDraft,
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
  PositionRecord,
  readOrganizationDashboard,
  updateManagerResolution,
  updateMembership,
  updateOrgUnit,
  updatePosition,
} from '@rytass/bpm-core-client/organization';
import { MemberProfileRecord, resolveMembers } from '@rytass/bpm-core-client';
import {
  OrgUnitTreeDraftEditor,
  OrgUnitTreeDraftEditorHandle,
  OrgUnitTreeDraftEditorState,
} from '../../../components/org-unit-tree-draft-editor';
import type { OrgUnitHierarchyDraftChange } from '../../../lib/org-tree-draft';
import styles from './orgs.module.scss';

type AdminOrgTab = 'MANAGERS' | 'MEMBERSHIPS' | 'ORG_UNITS' | 'POSITIONS';
type OrgUnitViewMode = 'FLOW' | 'TABLE';

const INITIAL_ORG_TREE_EDITOR_STATE: OrgUnitTreeDraftEditorState = {
  hasDraftChanges: false,
  isEditing: false,
};

type OrgUnitRow = Readonly<
  Record<string, unknown> &
    OrgUnitRecord & {
      key: string;
      parentName: string;
      typeLabel: string;
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
  parentId?: string | null;
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

type OrgUnitTypeFilterOption = Readonly<{
  id: 'ALL' | OrgUnitType;
  name: string;
}>;

type ScopeTypeOption = Readonly<{
  id: ManagerResolutionScopeType;
  name: string;
}>;

type ScopeTypeFilterOption = Readonly<{
  id: 'ALL' | ManagerResolutionScopeType;
  name: string;
}>;

type ActiveFilterOption = Readonly<{
  activeOnly: boolean;
  id: 'ACTIVE' | 'ALL';
  name: string;
}>;

type PrimaryOption = Readonly<{
  id: 'false' | 'true';
  name: string;
  value: boolean;
}>;

type TablePaginationState = Readonly<{
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  page: number;
  pageSize: number;
  total: number;
}>;

const ORG_UNIT_TYPES: readonly OrgUnitTypeOption[] = [
  { id: 'COMPANY', name: '公司' },
  { id: 'DIVISION', name: '事業群' },
  { id: 'DEPARTMENT', name: '部門' },
  { id: 'TEAM', name: '小組' },
];
const ALL_ORG_UNIT_TYPE_FILTER: OrgUnitTypeFilterOption = {
  id: 'ALL',
  name: '全部類型',
};
const ORG_UNIT_TYPE_FILTER_OPTIONS: readonly OrgUnitTypeFilterOption[] = [
  ALL_ORG_UNIT_TYPE_FILTER,
  ...ORG_UNIT_TYPES,
];

const SCOPE_TYPES: readonly ScopeTypeOption[] = [
  { id: 'MEMBER', name: '指定會員' },
  { id: 'ORG_UNIT', name: '指定組織' },
  { id: 'POSITION', name: '指定職位' },
];
const ALL_SCOPE_TYPE_FILTER: ScopeTypeFilterOption = {
  id: 'ALL',
  name: '全部範圍',
};
const SCOPE_TYPE_FILTER_OPTIONS: readonly ScopeTypeFilterOption[] = [
  ALL_SCOPE_TYPE_FILTER,
  ...SCOPE_TYPES,
];
const ALL_ACTIVE_FILTER: ActiveFilterOption = {
  activeOnly: false,
  id: 'ALL',
  name: '全部狀態',
};
const ACTIVE_FILTER_OPTIONS: readonly ActiveFilterOption[] = [
  ALL_ACTIVE_FILTER,
  { activeOnly: true, id: 'ACTIVE', name: '目前有效' },
];

const PRIMARY_OPTIONS: readonly PrimaryOption[] = [
  { id: 'true', name: '主要歸屬', value: true },
  { id: 'false', name: '一般歸屬', value: false },
];
const ORGANIZATION_TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const ORG_UNIT_TABLE_MIN_WIDTH = 1368;
const POSITION_TABLE_MIN_WIDTH = 908;
const MEMBERSHIP_TABLE_MIN_WIDTH = 1292;
const MANAGER_TABLE_MIN_WIDTH = 1124;


export function AdminOrgsView(): ReactElement {
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
  const [managerActiveFilter, setManagerActiveFilter] =
    useState<ActiveFilterOption>(ALL_ACTIVE_FILTER);
  const [managerPage, setManagerPage] = useState(1);
  const [managerPageSize, setManagerPageSize] = useState(10);
  const [managerScopeTypeFilter, setManagerScopeTypeFilter] =
    useState<ScopeTypeFilterOption>(ALL_SCOPE_TYPE_FILTER);
  const [managerTotalCount, setManagerTotalCount] = useState(0);
  const [memberProfiles, setMemberProfiles] = useState<
    readonly MemberProfileRecord[]
  >([]);
  const [membershipActiveFilter, setMembershipActiveFilter] =
    useState<ActiveFilterOption | null>(null);
  const [membershipModal, setMembershipModal] =
    useState<MembershipModalState | null>(null);
  const [membershipOrgUnitFilter, setMembershipOrgUnitFilter] =
    useState<OrgUnitOption | null>(null);
  const [membershipPage, setMembershipPage] = useState(1);
  const [membershipPageSize, setMembershipPageSize] = useState(10);
  const [membershipPositionFilter, setMembershipPositionFilter] =
    useState<PositionOption | null>(null);
  const [membershipTotalCount, setMembershipTotalCount] = useState(0);
  const [orgModal, setOrgModal] = useState<OrgModalState | null>(null);
  const [orgUnitPage, setOrgUnitPage] = useState(1);
  const [orgUnitPageSize, setOrgUnitPageSize] = useState(10);
  const [orgUnitSearchText, setOrgUnitSearchText] = useState('');
  const [orgUnitTotalCount, setOrgUnitTotalCount] = useState(0);
  const [orgUnitTypeFilter, setOrgUnitTypeFilter] =
    useState<OrgUnitTypeFilterOption>(ALL_ORG_UNIT_TYPE_FILTER);
  const [orgUnitViewMode, setOrgUnitViewMode] =
    useState<OrgUnitViewMode>('TABLE');
  const [orgUnits, setOrgUnits] = useState<readonly OrgUnitRecord[]>([]);
  const [visibleOrgUnits, setVisibleOrgUnits] = useState<
    readonly OrgUnitRecord[]
  >([]);
  const [visiblePositions, setVisiblePositions] = useState<
    readonly PositionRecord[]
  >([]);
  const [positionModal, setPositionModal] = useState<PositionModalState | null>(
    null,
  );
  const [positionPage, setPositionPage] = useState(1);
  const [positionPageSize, setPositionPageSize] = useState(10);
  const [positionSearchText, setPositionSearchText] = useState('');
  const [positionTotalCount, setPositionTotalCount] = useState(0);
  const [positions, setPositions] = useState<readonly PositionRecord[]>([]);
  const [visibleManagerResolutions, setVisibleManagerResolutions] = useState<
    readonly ManagerResolutionRecord[]
  >([]);
  const [visibleMemberships, setVisibleMemberships] = useState<
    readonly MembershipRecord[]
  >([]);
  const [saving, setSaving] = useState(false);

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
      const dashboard = await readOrganizationDashboard({
        managerActiveOnly: managerActiveFilter.activeOnly,
        managerPage,
        managerPageSize,
        managerScopeType:
          managerScopeTypeFilter.id === 'ALL'
            ? null
            : managerScopeTypeFilter.id,
        membershipActiveOnly: membershipActiveFilter?.activeOnly ?? false,
        membershipOrgUnitId: membershipOrgUnitFilter?.id ?? null,
        membershipPage,
        membershipPageSize,
        membershipPositionId: membershipPositionFilter?.id ?? null,
        orgUnitPage,
        orgUnitPageSize,
        orgUnitSearchText,
        orgUnitType:
          orgUnitTypeFilter.id === 'ALL' ? null : orgUnitTypeFilter.id,
        positionPage,
        positionPageSize,
        positionSearchText,
      });
      const memberIds = readReferencedMemberIds(
        dashboard.memberships,
        dashboard.managerResolutions,
      );
      const profiles = await resolveMembers(memberIds);

      setMemberProfiles(profiles);
      setOrgUnits(dashboard.orgUnits);
      setOrgUnitTotalCount(dashboard.orgUnitCount);
      setVisibleOrgUnits(dashboard.filteredOrgUnits);
      setPositions(dashboard.positions);
      setPositionTotalCount(dashboard.positionCount);
      setVisiblePositions(dashboard.filteredPositions);
      setMembershipTotalCount(dashboard.membershipCount);
      setVisibleMemberships(dashboard.filteredMemberships);
      setManagerTotalCount(dashboard.managerResolutionCount);
      setVisibleManagerResolutions(dashboard.filteredManagerResolutions);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [
    managerActiveFilter,
    managerPage,
    managerPageSize,
    managerScopeTypeFilter,
    membershipActiveFilter,
    membershipOrgUnitFilter,
    membershipPage,
    membershipPageSize,
    membershipPositionFilter,
    orgUnitPage,
    orgUnitPageSize,
    orgUnitSearchText,
    orgUnitTypeFilter,
    positionPage,
    positionPageSize,
    positionSearchText,
  ]);

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
      visibleOrgUnits.map((orgUnit) => ({
        ...orgUnit,
        key: orgUnit.id,
        parentName: orgUnit.parentId
          ? readOrgUnitLabel(orgUnitsById.get(orgUnit.parentId))
          : '根節點',
        typeLabel: readOrgUnitTypeLabel(orgUnit.type),
      })),
    [visibleOrgUnits, orgUnitsById],
  );
  const positionRows = useMemo(
    (): PositionRow[] =>
      visiblePositions.map((position) => ({
        ...position,
        key: position.id,
      })),
    [visiblePositions],
  );
  const membershipRows = useMemo(
    (): MembershipRow[] =>
      visibleMemberships.map((membership) => ({
        ...membership,
        key: membership.id,
        memberName: readMemberLabel(membersById.get(membership.memberId)),
        orgUnitName: readOrgUnitLabel(orgUnitsById.get(membership.orgUnitId)),
        positionName: membership.positionId
          ? readPositionLabel(positionsById.get(membership.positionId))
          : '未指定',
      })),
    [membersById, visibleMemberships, orgUnitsById, positionsById],
  );
  const managerRows = useMemo(
    (): ManagerResolutionRow[] =>
      visibleManagerResolutions.map((resolution) => ({
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
    [visibleManagerResolutions, membersById, orgUnitsById, positionsById],
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

  function updateOrgUnitSearchText(value: string): void {
    setOrgUnitPage(1);
    setOrgUnitSearchText(value);
  }

  function updateOrgUnitTypeFilter(value: OrgUnitTypeFilterOption): void {
    setOrgUnitPage(1);
    setOrgUnitTypeFilter(value);
  }

  function updatePositionSearchText(value: string): void {
    setPositionPage(1);
    setPositionSearchText(value);
  }

  function updateMembershipActiveFilter(value: ActiveFilterOption | null): void {
    setMembershipPage(1);
    setMembershipActiveFilter(value);
  }

  function updateMembershipOrgUnitFilter(value: OrgUnitOption | null): void {
    setMembershipPage(1);
    setMembershipOrgUnitFilter(value);
  }

  function updateMembershipPositionFilter(value: PositionOption | null): void {
    setMembershipPage(1);
    setMembershipPositionFilter(value);
  }

  function updateManagerActiveFilter(value: ActiveFilterOption): void {
    setManagerPage(1);
    setManagerActiveFilter(value);
  }

  function updateManagerScopeTypeFilter(value: ScopeTypeFilterOption): void {
    setManagerPage(1);
    setManagerScopeTypeFilter(value);
  }

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

  async function saveOrgUnitTreeDraft(
    changes: readonly OrgUnitHierarchyDraftChange[],
  ): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      await commitOrgUnitTreeDraft({
        moves: changes.map((change) => {
          const orgUnit = orgUnitsById.get(change.orgUnitId);

          return {
            baseUpdatedAt: orgUnit?.updatedAt ?? '',
            id: change.orgUnitId,
            parentId: change.parentId,
          };
        }),
      });
      await refreshOrganization();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
      throw requestError;
    } finally {
      setSaving(false);
    }
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
    <>
        <PageHeader>
          <ContentHeader
            description="維護組織樹、職位、會員歸屬與簽核主管解析規則。"
            title="組織管理"
          />
        </PageHeader>

        <SectionGroup>
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
                  setOrgModal({ parentId: null, record: null, type: 'CREATE' })
                }
                onCreateChild={(parentId): void =>
                  setOrgModal({ parentId, record: null, type: 'CREATE' })
                }
                onEditOrgUnit={(record): void =>
                  setOrgModal({ record, type: 'EDIT' })
                }
                onPageChange={setOrgUnitPage}
                onSaveDraft={saveOrgUnitTreeDraft}
                onPageSizeChange={(pageSize): void => {
                  setOrgUnitPage(1);
                  setOrgUnitPageSize(pageSize);
                }}
                onSearchTextChange={updateOrgUnitSearchText}
                onTypeFilterChange={updateOrgUnitTypeFilter}
                orgUnits={orgUnits}
                page={orgUnitPage}
                pageSize={orgUnitPageSize}
                rows={orgRows}
                searchText={orgUnitSearchText}
                saving={saving}
                total={orgUnitTotalCount}
                typeFilter={orgUnitTypeFilter}
                viewMode={orgUnitViewMode}
                onViewModeChange={setOrgUnitViewMode}
              />
            ) : null}
            {activeTab === 'POSITIONS' ? (
              <PositionPanel
                actions={positionActions}
                loading={loading}
                onCreate={(): void =>
                  setPositionModal({ record: null, type: 'CREATE' })
                }
                onPageChange={setPositionPage}
                onPageSizeChange={(pageSize): void => {
                  setPositionPage(1);
                  setPositionPageSize(pageSize);
                }}
                onSearchTextChange={updatePositionSearchText}
                page={positionPage}
                pageSize={positionPageSize}
                rows={positionRows}
                searchText={positionSearchText}
                total={positionTotalCount}
              />
            ) : null}
            {activeTab === 'MEMBERSHIPS' ? (
              <MembershipPanel
                actions={membershipActions}
                loading={loading}
                onCreate={(): void =>
                  setMembershipModal({ record: null, type: 'CREATE' })
                }
                onActiveFilterChange={updateMembershipActiveFilter}
                onOrgUnitFilterChange={updateMembershipOrgUnitFilter}
                onPageChange={setMembershipPage}
                onPageSizeChange={(pageSize): void => {
                  setMembershipPage(1);
                  setMembershipPageSize(pageSize);
                }}
                onPositionFilterChange={updateMembershipPositionFilter}
                orgUnitFilter={membershipOrgUnitFilter}
                orgUnits={orgUnits}
                page={membershipPage}
                pageSize={membershipPageSize}
                positionFilter={membershipPositionFilter}
                positions={positions}
                rows={membershipRows}
                statusFilter={membershipActiveFilter}
                total={membershipTotalCount}
              />
            ) : null}
            {activeTab === 'MANAGERS' ? (
              <ManagerPanel
                actions={managerActions}
                loading={loading}
                onCreate={(): void =>
                  setManagerModal({ record: null, type: 'CREATE' })
                }
                onActiveFilterChange={updateManagerActiveFilter}
                onPageChange={setManagerPage}
                onPageSizeChange={(pageSize): void => {
                  setManagerPage(1);
                  setManagerPageSize(pageSize);
                }}
                onScopeTypeFilterChange={updateManagerScopeTypeFilter}
                page={managerPage}
                pageSize={managerPageSize}
                rows={managerRows}
                scopeTypeFilter={managerScopeTypeFilter}
                statusFilter={managerActiveFilter}
                total={managerTotalCount}
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
                await updateOrgUnit({
                  ...input,
                  id: orgModal.record.id,
                  metadataJson: null,
                });
              } else {
                await createOrgUnit({
                  code: input.code ?? '',
                  metadataJson: '{}',
                  name: input.name ?? '',
                  parentId: input.parentId,
                  type: input.type ?? 'DEPARTMENT',
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
                await updatePosition({
                  ...input,
                  id: positionModal.record.id,
                  metadataJson: null,
                });
              } else {
                await createPosition({
                  code: input.code ?? '',
                  level: input.level ?? 0,
                  metadataJson: '{}',
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
      </>
  );
}

function OrgUnitPanel({
  actions,
  loading,
  onCreate,
  onCreateChild,
  onEditOrgUnit,
  onPageChange,
  onSaveDraft,
  onPageSizeChange,
  onSearchTextChange,
  onTypeFilterChange,
  onViewModeChange,
  orgUnits,
  page,
  pageSize,
  rows,
  searchText,
  saving,
  total,
  typeFilter,
  viewMode,
}: {
  readonly actions: TableActions<OrgUnitRow>;
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly onCreateChild: (parentId: string) => void;
  readonly onEditOrgUnit: (record: OrgUnitRecord) => void;
  readonly onPageChange: (page: number) => void;
  readonly onSaveDraft: (
    changes: readonly OrgUnitHierarchyDraftChange[],
  ) => Promise<void>;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly onSearchTextChange: (value: string) => void;
  readonly onTypeFilterChange: (value: OrgUnitTypeFilterOption) => void;
  readonly onViewModeChange: (mode: OrgUnitViewMode) => void;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly rows: readonly OrgUnitRow[];
  readonly searchText: string;
  readonly saving: boolean;
  readonly total: number;
  readonly typeFilter: OrgUnitTypeFilterOption;
  readonly viewMode: OrgUnitViewMode;
}): ReactElement {
  const treeEditorRef = useRef<OrgUnitTreeDraftEditorHandle | null>(null);
  const [treeEditorState, setTreeEditorState] =
    useState<OrgUnitTreeDraftEditorState>(INITIAL_ORG_TREE_EDITOR_STATE);
  const nextViewMode: OrgUnitViewMode = viewMode === 'TABLE' ? 'FLOW' : 'TABLE';
  const viewModeToggleLabel = viewMode === 'TABLE' ? '切換樹狀圖' : '切換表格';
  const isTreeMode = viewMode === 'FLOW';
  const primaryActionLabel = readOrgUnitPrimaryActionLabel({
    isTreeMode,
    isTreeEditing: treeEditorState.isEditing,
  });
  const primaryActionIcon = readOrgUnitPrimaryActionIcon({
    isTreeMode,
    isTreeEditing: treeEditorState.isEditing,
  });
  const primaryActionDisabled = readOrgUnitPrimaryActionDisabled({
    hasDraftChanges: treeEditorState.hasDraftChanges,
    isTreeEditing: treeEditorState.isEditing,
    isTreeMode,
    loading,
    saving,
  });
  const columns = useMemo(
    (): TableColumn<OrgUnitRow>[] => [
      { dataIndex: 'code', key: 'code', title: '代碼', width: 180 },
      { dataIndex: 'name', key: 'name', title: '名稱', width: 240 },
      { dataIndex: 'typeLabel', key: 'typeLabel', title: '類型', width: 120 },
      { dataIndex: 'parentName', key: 'parentName', title: '上層', width: 280 },
      { dataIndex: 'path', key: 'path', title: 'Path', width: 420 },
    ],
    [],
  );

  useEffect((): void => {
    if (viewMode === 'TABLE') {
      setTreeEditorState(INITIAL_ORG_TREE_EDITOR_STATE);
    }
  }, [viewMode]);

  return (
    <>
      <PanelIntro
        actionDisabled={primaryActionDisabled}
        actionIcon={primaryActionIcon}
        actionLabel={primaryActionLabel}
        actions={
          <>
            <Button
              onClick={(): void => onViewModeChange(nextViewMode)}
              variant="base-secondary"
            >
              {viewModeToggleLabel}
            </Button>
            {isTreeMode && treeEditorState.isEditing ? (
              <Button
                disabled={saving}
                icon={CloseIcon}
                iconType="leading"
                onClick={(): void => treeEditorRef.current?.cancelEditing()}
                variant="base-secondary"
              >
                取消
              </Button>
            ) : null}
          </>
        }
        description="組織節點使用 ltree path 維護階層，搬移節點會同步更新子節點 path。"
        onCreate={(): void => {
          if (!isTreeMode) {
            onCreate();
            return;
          }

          if (treeEditorState.isEditing) {
            void treeEditorRef.current?.saveDraft();
            return;
          }

          treeEditorRef.current?.startEditing();
        }}
        title="組織樹"
      />
      {viewMode === 'TABLE' ? (
        <>
          <FilterArea className={styles.orgFilterArea} size="sub">
            <FilterLine>
              <Filter span={3}>
                <FormField
                  fullWidth
                  layout={FormFieldLayout.VERTICAL}
                  name="orgUnitSearchText"
                >
                  <Input
                    fullWidth
                    onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                      onSearchTextChange(event.target.value)
                    }
                    placeholder="搜尋組織名稱或代碼"
                    size="sub"
                    value={searchText}
                    variant="base"
                  />
                </FormField>
              </Filter>
              <Filter span={2}>
                <FormField
                  fullWidth
                  layout={FormFieldLayout.VERTICAL}
                  name="orgUnitTypeFilter"
                >
                  <Select
                    clearable={false}
                    fullWidth
                    onChange={(option): void =>
                      onTypeFilterChange(readOrgUnitTypeFilterOption(option))
                    }
                    options={[...ORG_UNIT_TYPE_FILTER_OPTIONS]}
                    placeholder="類型"
                    size="sub"
                    value={typeFilter}
                  />
                </FormField>
              </Filter>
            </FilterLine>
          </FilterArea>
          <div className={styles.tableFrame}>
            <Table
              actions={actions}
              columns={columns}
              dataSource={[...rows]}
              fullWidth
              loading={loading}
              pagination={createTablePagination({
                onPageChange,
                onPageSizeChange,
                page,
                pageSize,
                total,
              })}
              style={{ minWidth: ORG_UNIT_TABLE_MIN_WIDTH }}
            />
          </div>
        </>
      ) : (
        <OrgUnitTreeDraftEditor
          ref={treeEditorRef}
          onCreateChild={onCreateChild}
          onCreateRoot={onCreate}
          onEditOrgUnit={onEditOrgUnit}
          onSaveDraft={onSaveDraft}
          onStateChange={setTreeEditorState}
          orgUnits={orgUnits}
          saving={saving}
        />
      )}
    </>
  );
}

function PositionPanel({
  actions,
  loading,
  onCreate,
  onPageChange,
  onPageSizeChange,
  onSearchTextChange,
  page,
  pageSize,
  rows,
  searchText,
  total,
}: {
  readonly actions: TableActions<PositionRow>;
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly onSearchTextChange: (value: string) => void;
  readonly page: number;
  readonly pageSize: number;
  readonly rows: readonly PositionRow[];
  readonly searchText: string;
  readonly total: number;
}): ReactElement {
  const columns = useMemo(
    (): TableColumn<PositionRow>[] => [
      { dataIndex: 'code', key: 'code', title: '代碼', width: 180 },
      { dataIndex: 'name', key: 'name', title: '名稱', width: 280 },
      { dataIndex: 'level', key: 'level', title: '職等', width: 96 },
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
      <FilterArea className={styles.orgFilterArea} size="sub">
        <FilterLine>
          <Filter span={3}>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              name="positionSearchText"
            >
              <Input
                fullWidth
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  onSearchTextChange(event.target.value)
                }
                placeholder="搜尋職位名稱或代碼"
                size="sub"
                value={searchText}
                variant="base"
              />
            </FormField>
          </Filter>
        </FilterLine>
      </FilterArea>
      <div className={styles.tableFrame}>
        <Table
          actions={actions}
          columns={columns}
          dataSource={[...rows]}
          fullWidth
          loading={loading}
          pagination={createTablePagination({
            onPageChange,
            onPageSizeChange,
            page,
            pageSize,
            total,
          })}
          style={{ minWidth: POSITION_TABLE_MIN_WIDTH }}
        />
      </div>
    </>
  );
}

function MembershipPanel({
  actions,
  loading,
  onCreate,
  onActiveFilterChange,
  onOrgUnitFilterChange,
  onPageChange,
  onPageSizeChange,
  onPositionFilterChange,
  orgUnitFilter,
  orgUnits,
  page,
  pageSize,
  positionFilter,
  positions,
  rows,
  statusFilter,
  total,
}: {
  readonly actions: TableActions<MembershipRow>;
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly onActiveFilterChange: (value: ActiveFilterOption | null) => void;
  readonly onOrgUnitFilterChange: (value: OrgUnitOption | null) => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly onPositionFilterChange: (value: PositionOption | null) => void;
  readonly orgUnitFilter: OrgUnitOption | null;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly positionFilter: PositionOption | null;
  readonly positions: readonly PositionRecord[];
  readonly rows: readonly MembershipRow[];
  readonly statusFilter: ActiveFilterOption | null;
  readonly total: number;
}): ReactElement {
  const columns = useMemo(
    (): TableColumn<MembershipRow>[] => [
      { dataIndex: 'memberName', key: 'memberName', title: '會員', width: 280 },
      {
        dataIndex: 'orgUnitName',
        key: 'orgUnitName',
        title: '組織',
        width: 280,
      },
      {
        dataIndex: 'positionName',
        key: 'positionName',
        title: '職位',
        width: 220,
      },
      {
        key: 'isPrimary',
        render: (record: MembershipRow): string =>
          record.isPrimary ? '主要' : '一般',
        title: '類型',
        width: 104,
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
  const orgUnitOptions = useMemo(
    (): readonly OrgUnitOption[] => orgUnits.map(readOrgUnitOption),
    [orgUnits],
  );
  const positionOptions = useMemo(
    (): readonly PositionOption[] => positions.map(readPositionOption),
    [positions],
  );

  return (
    <>
      <PanelIntro
        actionLabel="新增歸屬"
        description="會員歸屬是 BPM 內部組織權限、主管解析與條件判斷的來源。"
        onCreate={onCreate}
        title="會員歸屬"
      />
      <FilterArea
        className={[styles.orgFilterArea, styles.membershipFilterArea].join(
          ' ',
        )}
        size="sub"
      >
        <FilterLine>
          <Filter span={2}>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              name="membershipOrgUnitFilter"
            >
              <AutoComplete
                disabledOptionsFilter
                emptyText="沒有符合的組織"
                inputProps={{
                  autoCapitalize: 'none',
                  autoCorrect: 'off',
                  name: 'membershipOrgUnitFilter',
                  spellCheck: false,
                }}
                mode="single"
                name="membershipOrgUnitFilter"
                onChange={(option): void =>
                  onOrgUnitFilterChange(readOrgUnitOptionFromValue(option))
                }
                options={[...orgUnitOptions]}
                placeholder="全部組織"
                size="sub"
                value={orgUnitFilter}
              />
            </FormField>
          </Filter>
          <Filter span={2}>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              name="membershipPositionFilter"
            >
              <AutoComplete
                disabledOptionsFilter
                emptyText="沒有符合的職位"
                inputProps={{
                  autoCapitalize: 'none',
                  autoCorrect: 'off',
                  name: 'membershipPositionFilter',
                  spellCheck: false,
                }}
                mode="single"
                name="membershipPositionFilter"
                onChange={(option): void =>
                  onPositionFilterChange(readPositionOptionFromValue(option))
                }
                options={[...positionOptions]}
                placeholder="全部職位"
                size="sub"
                value={positionFilter}
              />
            </FormField>
          </Filter>
          <Filter span={2}>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              name="membershipStatusFilter"
            >
              <AutoComplete
                disabledOptionsFilter
                emptyText="沒有符合的狀態"
                inputProps={{
                  autoCapitalize: 'none',
                  autoCorrect: 'off',
                  name: 'membershipStatusFilter',
                  spellCheck: false,
                }}
                mode="single"
                name="membershipStatusFilter"
                onChange={(option): void =>
                  onActiveFilterChange(readNullableActiveFilterOption(option))
                }
                options={[...ACTIVE_FILTER_OPTIONS]}
                placeholder="全部狀態"
                size="sub"
                value={statusFilter}
              />
            </FormField>
          </Filter>
        </FilterLine>
      </FilterArea>
      <div className={styles.tableFrame}>
        <Table
          actions={actions}
          columns={columns}
          dataSource={[...rows]}
          fullWidth
          loading={loading}
          pagination={createTablePagination({
            onPageChange,
            onPageSizeChange,
            page,
            pageSize,
            total,
          })}
          style={{ minWidth: MEMBERSHIP_TABLE_MIN_WIDTH }}
        />
      </div>
    </>
  );
}

function ManagerPanel({
  actions,
  loading,
  onCreate,
  onActiveFilterChange,
  onPageChange,
  onPageSizeChange,
  onScopeTypeFilterChange,
  page,
  pageSize,
  rows,
  scopeTypeFilter,
  statusFilter,
  total,
}: {
  readonly actions: TableActions<ManagerResolutionRow>;
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly onActiveFilterChange: (value: ActiveFilterOption) => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly onScopeTypeFilterChange: (value: ScopeTypeFilterOption) => void;
  readonly page: number;
  readonly pageSize: number;
  readonly rows: readonly ManagerResolutionRow[];
  readonly scopeTypeFilter: ScopeTypeFilterOption;
  readonly statusFilter: ActiveFilterOption;
  readonly total: number;
}): ReactElement {
  const columns = useMemo(
    (): TableColumn<ManagerResolutionRow>[] => [
      {
        dataIndex: 'scopeLabel',
        key: 'scopeLabel',
        title: '套用範圍',
        width: 320,
      },
      {
        dataIndex: 'managerName',
        key: 'managerName',
        title: '簽核主管',
        width: 300,
      },
      { dataIndex: 'priority', key: 'priority', title: '優先序', width: 96 },
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
      <FilterArea className={styles.orgFilterArea} size="sub">
        <FilterLine>
          <Filter span={3}>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              name="managerScopeTypeFilter"
            >
              <Select
                clearable={false}
                fullWidth
                onChange={(option): void =>
                  onScopeTypeFilterChange(readScopeTypeFilterOption(option))
                }
                options={[...SCOPE_TYPE_FILTER_OPTIONS]}
                placeholder="套用範圍"
                size="sub"
                value={scopeTypeFilter}
              />
            </FormField>
          </Filter>
          <Filter span={2}>
            <FormField
              fullWidth
              layout={FormFieldLayout.VERTICAL}
              name="managerStatusFilter"
            >
              <Select
                clearable={false}
                fullWidth
                onChange={(option): void =>
                  onActiveFilterChange(readActiveFilterOption(option))
                }
                options={[...ACTIVE_FILTER_OPTIONS]}
                placeholder="狀態"
                size="sub"
                value={statusFilter}
              />
            </FormField>
          </Filter>
        </FilterLine>
      </FilterArea>
      <div className={styles.tableFrame}>
        <Table
          actions={actions}
          columns={columns}
          dataSource={[...rows]}
          fullWidth
          loading={loading}
          pagination={createTablePagination({
            onPageChange,
            onPageSizeChange,
            page,
            pageSize,
            total,
          })}
          style={{ minWidth: MANAGER_TABLE_MIN_WIDTH }}
        />
      </div>
    </>
  );
}

function createTablePagination({
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  total,
}: TablePaginationState): {
  current: number;
  onChange: (page: number) => void;
  onChangePageSize: (pageSize: number) => void;
  pageSize: number;
  pageSizeLabel: string;
  pageSizeOptions: number[];
  renderResultSummary: (from: number, to: number, total: number) => string;
  showPageSizeOptions: true;
  total: number;
} {
  return {
    current: page,
    onChange: onPageChange,
    onChangePageSize: onPageSizeChange,
    pageSize,
    pageSizeLabel: '每頁筆數',
    pageSizeOptions: [...ORGANIZATION_TABLE_PAGE_SIZE_OPTIONS],
    renderResultSummary: (from, to, resultTotal): string =>
      `顯示 ${from}-${to} 筆，共 ${resultTotal} 筆`,
    showPageSizeOptions: true,
    total,
  };
}

function readOrgUnitPrimaryActionLabel({
  isTreeEditing,
  isTreeMode,
}: {
  readonly isTreeEditing: boolean;
  readonly isTreeMode: boolean;
}): string {
  if (!isTreeMode) {
    return '新增組織';
  }

  return isTreeEditing ? '儲存' : '開始編輯';
}

function readOrgUnitPrimaryActionIcon({
  isTreeEditing,
  isTreeMode,
}: {
  readonly isTreeEditing: boolean;
  readonly isTreeMode: boolean;
}): IconDefinition {
  if (!isTreeMode) {
    return PlusIcon;
  }

  return isTreeEditing ? SaveIcon : EditIcon;
}

function readOrgUnitPrimaryActionDisabled({
  hasDraftChanges,
  isTreeEditing,
  isTreeMode,
  loading,
  saving,
}: {
  readonly hasDraftChanges: boolean;
  readonly isTreeEditing: boolean;
  readonly isTreeMode: boolean;
  readonly loading: boolean;
  readonly saving: boolean;
}): boolean {
  if (!isTreeMode) {
    return false;
  }

  if (!isTreeEditing) {
    return loading;
  }

  return !hasDraftChanges || saving;
}

function PanelIntro({
  actionDisabled = false,
  actionIcon = PlusIcon,
  actionLabel,
  actions,
  description,
  onCreate,
  title,
}: {
  readonly actionDisabled?: boolean;
  readonly actionIcon?: IconDefinition;
  readonly actionLabel: string;
  readonly actions?: ReactElement;
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
      <div className={styles.tableIntroActions}>
        {actions}
        <Button
          disabled={actionDisabled}
          icon={actionIcon}
          iconType="leading"
          onClick={onCreate}
        >
          {actionLabel}
        </Button>
      </div>
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
    readonly name: string | null;
    readonly parentId: string | null;
    readonly type: OrgUnitType | null;
  }) => Promise<void>;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly saving: boolean;
}): ReactElement {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState<OrgUnitOption | null>(null);
  const [type, setType] = useState<OrgUnitTypeOption>(ORG_UNIT_TYPES[2]);

  useEffect((): void => {
    if (!modal) {
      return;
    }

    const record = modal.record;
    const parentId = record?.parentId ?? modal.parentId ?? null;
    const parentOrgUnit = parentId
      ? (orgUnits.find((orgUnit) => orgUnit.id === parentId) ?? null)
      : null;

    setCode(record?.code ?? '');
    setName(record?.name ?? '');
    setParent(parentOrgUnit ? readOrgUnitOption(parentOrgUnit) : null);
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
        <OrgModalTextField
          label="代碼"
          name="orgCode"
          onChange={setCode}
          placeholder="例如 FIN-TW"
          value={code}
        />
        <OrgModalTextField
          label="名稱"
          name="orgName"
          onChange={setName}
          placeholder="例如 財務部"
          value={name}
        />
        <BPMFormField label="類型" name="orgType">
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void => setType(readOrgUnitTypeOption(option))}
            options={[...ORG_UNIT_TYPES]}
            placeholder="選擇組織類型"
            value={type}
          />
        </BPMFormField>
        <BPMFormField label="上層組織" name="parentId">
          <OrgUnitPicker
            name="parentId"
            onChange={setParent}
            orgUnits={orgUnits.filter(
              (orgUnit) => orgUnit.id !== modal?.record?.id,
            )}
            placeholder="選擇上層組織"
            value={parent}
          />
        </BPMFormField>
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
    readonly name: string | null;
  }) => Promise<void>;
  readonly saving: boolean;
}): ReactElement {
  const [code, setCode] = useState('');
  const [level, setLevel] = useState('0');
  const [name, setName] = useState('');

  useEffect((): void => {
    if (!modal) {
      return;
    }

    setCode(modal.record?.code ?? '');
    setLevel(String(modal.record?.level ?? 0));
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
        <OrgModalTextField
          label="代碼"
          name="positionCode"
          onChange={setCode}
          placeholder="例如 FIN-MGR"
          value={code}
        />
        <OrgModalTextField
          label="名稱"
          name="positionName"
          onChange={setName}
          placeholder="例如 財務主管"
          value={name}
        />
        <OrgModalTextField
          label="職等"
          name="positionLevel"
          onChange={setLevel}
          placeholder="例如 5"
          value={level}
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
        <BPMFormField label="會員" name="memberId">
          <MemberPicker
            name="memberId"
            onChange={setMember}
            placeholder="搜尋會員姓名或信箱"
            value={member}
          />
        </BPMFormField>
        <BPMFormField label="組織" name="orgUnitId">
          <OrgUnitPicker
            name="orgUnitId"
            onChange={setOrgUnit}
            orgUnits={orgUnits}
            placeholder="選擇歸屬組織"
            value={orgUnit}
          />
        </BPMFormField>
        <BPMFormField label="職位" name="positionId">
          <PositionPicker
            name="positionId"
            onChange={setPosition}
            placeholder="選擇職位"
            positions={positions}
            value={position}
          />
        </BPMFormField>
        <BPMFormField label="歸屬類型" name="isPrimary">
          <Select
            clearable={false}
            fullWidth
            onChange={(option): void => setIsPrimary(readPrimaryOption(option))}
            options={[...PRIMARY_OPTIONS]}
            placeholder="選擇歸屬類型"
            value={isPrimary}
          />
        </BPMFormField>
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
        <BPMFormField label="套用範圍" name="scopeType">
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
        </BPMFormField>
        {scopeType.id === 'MEMBER' ? (
          <BPMFormField label="會員" name="scopeMemberId">
            <MemberPicker
              name="scopeMemberId"
              onChange={setScopeMember}
              placeholder="搜尋套用會員"
              value={scopeMember}
            />
          </BPMFormField>
        ) : null}
        {scopeType.id === 'ORG_UNIT' ? (
          <BPMFormField label="組織" name="scopeOrgUnitId">
            <OrgUnitPicker
              name="scopeOrgUnitId"
              onChange={setScopeOrgUnit}
              orgUnits={orgUnits}
              placeholder="選擇套用組織"
              value={scopeOrgUnit}
            />
          </BPMFormField>
        ) : null}
        {scopeType.id === 'POSITION' ? (
          <BPMFormField label="職位" name="scopePositionId">
            <PositionPicker
              name="scopePositionId"
              onChange={setScopePosition}
              placeholder="選擇套用職位"
              positions={positions}
              value={scopePosition}
            />
          </BPMFormField>
        ) : null}
        <BPMFormField label="簽核主管" name="managerMemberId">
          <MemberPicker
            name="managerMemberId"
            onChange={setManager}
            placeholder="搜尋簽核主管"
            value={manager}
          />
        </BPMFormField>
        {isSelfManagerResolution ? (
          <Typography color="text-error" variant="caption">
            簽核主管不可設定為套用會員本人。
          </Typography>
        ) : null}
        <OrgModalTextField
          hintText="數字越大越優先，同一位成員命中多條規則時只會採用最高的那一層。建議：指定到人 200、部門主管 100、全公司通用的墊底規則 10。"
          label="優先序"
          name="managerPriority"
          onChange={setPriority}
          placeholder="例如 100"
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

function OrgModalTextField({
  hintText,
  label,
  name,
  onChange,
  placeholder,
  value,
}: {
  readonly hintText?: string;
  readonly label: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}): ReactElement {
  return (
    <BPMFormField hintText={hintText} label={label} name={name}>
      <Input
        fullWidth
        name={name}
        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        value={value}
      />
    </BPMFormField>
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
    <BPMFormField label={label} name={name}>
      <DatePicker
        format="YYYY-MM-DD"
        fullWidth
        inputProps={{ name }}
        onChange={(nextValue): void => onChange(formatDateOnly(nextValue))}
        placeholder={placeholder}
        value={value.trim() ? value : undefined}
      />
    </BPMFormField>
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

function readOrgUnitTypeLabel(type: OrgUnitType): string {
  return (
    ORG_UNIT_TYPES.find(
      (option) => option.id.toLowerCase() === type.toLowerCase(),
    )?.name ?? '未知類型'
  );
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
  const record = isRecord(value) ? value : null;

  if (typeof record?.id === 'string') {
    const id = record.id;

    return (
      ORG_UNIT_TYPES.find(
        (option) => option.id.toLowerCase() === id.toLowerCase(),
      ) ?? ORG_UNIT_TYPES[2]
    );
  }

  return ORG_UNIT_TYPES[2];
}

function readOrgUnitTypeFilterOption(value: unknown): OrgUnitTypeFilterOption {
  const record = isRecord(value) ? value : null;

  if (typeof record?.id === 'string') {
    const id = record.id;

    return (
      ORG_UNIT_TYPE_FILTER_OPTIONS.find(
        (option) => option.id.toLowerCase() === id.toLowerCase(),
      ) ?? ALL_ORG_UNIT_TYPE_FILTER
    );
  }

  return ALL_ORG_UNIT_TYPE_FILTER;
}

function readScopeTypeOption(value: unknown): ScopeTypeOption {
  return readOption(value, SCOPE_TYPES, SCOPE_TYPES[0]);
}

function readScopeTypeFilterOption(value: unknown): ScopeTypeFilterOption {
  return readOption(value, SCOPE_TYPE_FILTER_OPTIONS, ALL_SCOPE_TYPE_FILTER);
}

function readActiveFilterOption(value: unknown): ActiveFilterOption {
  return readOption(value, ACTIVE_FILTER_OPTIONS, ALL_ACTIVE_FILTER);
}

function readNullableActiveFilterOption(
  value: unknown,
): ActiveFilterOption | null {
  const record = isRecord(value) ? value : null;
  const id = typeof record?.id === 'string' ? record.id : null;

  return ACTIVE_FILTER_OPTIONS.find((option) => option.id === id) ?? null;
}

function readOrgUnitOptionFromValue(value: unknown): OrgUnitOption | null {
  const record = isRecord(value) ? value : null;
  const id = typeof record?.id === 'string' ? record.id : null;
  const name = typeof record?.name === 'string' ? record.name : null;

  return id && name ? { id, name } : null;
}

function readPositionOptionFromValue(value: unknown): PositionOption | null {
  const record = isRecord(value) ? value : null;
  const id = typeof record?.id === 'string' ? record.id : null;
  const name = typeof record?.name === 'string' ? record.name : null;

  return id && name ? { id, name } : null;
}

function readPrimaryOption(value: unknown): PrimaryOption {
  return readOption(value, PRIMARY_OPTIONS, PRIMARY_OPTIONS[1]);
}

function readOption<TOption extends { readonly id: string }>(
  value: unknown,
  options: readonly TOption[],
  fallback: TOption,
): TOption {
  const record = isRecord(value) ? value : null;
  const id = typeof record?.id === 'string' ? record.id : null;

  return options.find((option) => option.id === id) ?? fallback;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
