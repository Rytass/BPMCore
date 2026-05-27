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
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Input,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import styles from './users.module.scss';
import { useBPMRoutes } from '../../../lib/routes-config';
import { AppLayout } from '../../../components/app-navigation';
import {
  listMemberDirectoryPage,
  MemberProfileRecord,
  resolveMembers,
} from '@rytass/bpm-core-client';
import {
  listMemberships,
  MembershipRecord,
  OrgUnitRecord,
  PositionRecord,
  readOrganizationDashboard,
  readResolvedManager,
  ResolvedManagerRecord,
} from '@rytass/bpm-core-client/organization';

type MemberRow = Readonly<
  Record<string, unknown> &
    MemberProfileRecord & {
      key: string;
    }
>;

const MEMBER_PAGE_SIZE_OPTIONS = [10, 20, 50];

export interface AdminUsersViewProps {
  readonly activeHref?: string;
}

export function AdminUsersView({
  activeHref,
}: AdminUsersViewProps = {}): ReactElement {
  const routes = useBPMRoutes();
  const resolvedActiveHref = activeHref ?? routes.adminUsers();
  const [detailMember, setDetailMember] = useState<MemberProfileRecord | null>(
    null,
  );
  const [detailMemberships, setDetailMemberships] = useState<
    readonly MembershipRecord[]
  >([]);
  const [detailManagerProfile, setDetailManagerProfile] =
    useState<MemberProfileRecord | null>(null);
  const [detailResolvedManager, setDetailResolvedManager] =
    useState<ResolvedManagerRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberPage, setMemberPage] = useState(1);
  const [memberPageSize, setMemberPageSize] = useState(10);
  const [memberTotalCount, setMemberTotalCount] = useState(0);
  const [members, setMembers] = useState<readonly MemberProfileRecord[]>([]);
  const [orgUnits, setOrgUnits] = useState<readonly OrgUnitRecord[]>([]);
  const [positions, setPositions] = useState<readonly PositionRecord[]>([]);
  const [searchText, setSearchText] = useState('');

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

  const refreshMembers = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const [memberPageResult, organization] = await Promise.all([
        listMemberDirectoryPage({
          page: memberPage,
          pageSize: memberPageSize,
          searchText,
        }),
        readOrganizationDashboard(),
      ]);

      setMembers(memberPageResult.members);
      setMemberTotalCount(memberPageResult.totalCount);
      setOrgUnits(organization.orgUnits);
      setPositions(organization.positions);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [memberPage, memberPageSize, searchText]);

  useEffect((): void => {
    void refreshMembers();
  }, [refreshMembers]);

  const rows = useMemo(
    (): MemberRow[] =>
      members.map((member) => ({
        ...member,
        key: member.memberId,
      })),
    [members],
  );

  const openDetail = useCallback(
    async (member: MemberProfileRecord): Promise<void> => {
      setDetailMember(member);
      setDetailManagerProfile(null);
      setError(null);

      try {
        const [memberships, resolvedManager] = await Promise.all([
          listMemberships({ memberId: member.memberId }),
          readResolvedManager(member.memberId),
        ]);

        setDetailMemberships(memberships);
        setDetailResolvedManager(resolvedManager);
        setDetailManagerProfile(
          (
            await resolveMembers(
              resolvedManager.managerMemberId
                ? [resolvedManager.managerMemberId]
                : [],
            )
          )[0] ?? null,
        );
      } catch (requestError: unknown) {
        setError(readErrorMessage(requestError));
      }
    },
    [],
  );

  const columns = useMemo(
    (): TableColumn<MemberRow>[] => [
      { dataIndex: 'name', key: 'name', title: '姓名', width: 160 },
      { dataIndex: 'email', key: 'email', title: '信箱', width: 260 },
    ],
    [],
  );
  const tableActions = useMemo(
    (): TableActions<MemberRow> => ({
      render: (): ReturnType<TableActions<MemberRow>['render']> => [
        {
          name: '檢視',
          onClick: (record): void => {
            void openDetail(record);
          },
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [openDetail],
  );

  function closeDetail(): void {
    setDetailMember(null);
    setDetailManagerProfile(null);
    setDetailMemberships([]);
    setDetailResolvedManager(null);
  }

  return (
    <AppLayout activeHref={resolvedActiveHref}>
        <PageHeader>
          <ContentHeader
            description="會員資料由 host member resolver 提供，BPM 僅維護組織歸屬與主管解析。"
            title="會員對照"
          />
        </PageHeader>

        <SectionGroup>
          <Section
            filterArea={
              <FilterArea className={styles.memberFilterArea}>
                <FilterLine>
                  <Filter span={3}>
                    <FormField
                      fullWidth
                      layout={FormFieldLayout.VERTICAL}
                      name="memberSearchText"
                    >
                      <Input
                        fullWidth
                        onChange={(
                          event: ChangeEvent<HTMLInputElement>,
                        ): void => {
                          setSearchText(event.target.value);
                          setMemberPage(1);
                        }}
                        placeholder="搜尋姓名或信箱"
                        size="sub"
                        value={searchText}
                        variant="base"
                      />
                    </FormField>
                  </Filter>
                </FilterLine>
              </FilterArea>
            }
          >
            {error ? (
              <Typography color="text-error" variant="body">
                {error}
              </Typography>
            ) : null}
            <Table
              actions={tableActions}
              columns={columns}
              dataSource={rows}
              fullWidth
              loading={loading}
              pagination={{
                current: memberPage,
                onChange: (page): void => {
                  setMemberPage(page);
                },
                onChangePageSize: (pageSize): void => {
                  setMemberPage(1);
                  setMemberPageSize(pageSize);
                },
                pageSize: memberPageSize,
                pageSizeLabel: '每頁筆數',
                pageSizeOptions: MEMBER_PAGE_SIZE_OPTIONS,
                renderResultSummary: (from, to, total): string =>
                  `顯示 ${from}-${to} 筆，共 ${total} 筆`,
                showPageSizeOptions: true,
                total: memberTotalCount,
              }}
            />
          </Section>
        </SectionGroup>

        <MemberDetailModal
          managerProfile={detailManagerProfile}
          member={detailMember}
          memberships={detailMemberships}
          onClose={closeDetail}
          orgUnitsById={orgUnitsById}
          positionsById={positionsById}
          resolvedManager={detailResolvedManager}
        />
      </AppLayout>
  );
}

function MemberDetailModal({
  managerProfile,
  member,
  memberships,
  onClose,
  orgUnitsById,
  positionsById,
  resolvedManager,
}: {
  readonly managerProfile: MemberProfileRecord | null;
  readonly member: MemberProfileRecord | null;
  readonly memberships: readonly MembershipRecord[];
  readonly onClose: () => void;
  readonly orgUnitsById: ReadonlyMap<string, OrgUnitRecord>;
  readonly positionsById: ReadonlyMap<string, PositionRecord>;
  readonly resolvedManager: ResolvedManagerRecord | null;
}): ReactElement {
  return (
    <Modal
      cancelText="關閉"
      confirmText="關閉"
      modalType="standard"
      onCancel={onClose}
      onClose={onClose}
      onConfirm={onClose}
      open={Boolean(member)}
      showModalFooter
      showModalHeader
      size="regular"
      title={member?.name ?? '會員明細'}
    >
      {member ? (
        <div className={styles.detailFields}>
          <BaseCard title="基本資料">
            <div className={styles.detailSection}>
              <Typography variant="body">信箱：{member.email}</Typography>
            </div>
          </BaseCard>
          <BaseCard title="BPM 組織歸屬">
            <div className={styles.membershipList}>
              {memberships.length ? (
                memberships.map((membership) => (
                  <Typography key={membership.id} variant="body">
                    {readOrgUnitLabel(orgUnitsById.get(membership.orgUnitId))}
                    {' / '}
                    {membership.positionId
                      ? readPositionLabel(
                          positionsById.get(membership.positionId),
                        )
                      : '未指定職位'}
                    {' / '}
                    {membership.isPrimary ? '主要' : '一般'}
                  </Typography>
                ))
              ) : (
                <Typography color="text-neutral" variant="body">
                  尚未建立 BPM 組織歸屬
                </Typography>
              )}
            </div>
          </BaseCard>
          <BaseCard title="主管解析">
            <Typography variant="body">
              {resolvedManager?.managerMemberId
                ? readMemberLabel(managerProfile)
                : '尚未解析到主管'}
            </Typography>
          </BaseCard>
        </div>
      ) : null}
    </Modal>
  );
}

function readOrgUnitLabel(orgUnit: OrgUnitRecord | undefined): string {
  return orgUnit ? `${orgUnit.name} · ${orgUnit.code}` : '未知組織';
}

function readPositionLabel(position: PositionRecord | undefined): string {
  return position ? `${position.name} · ${position.code}` : '未知職位';
}

function readMemberLabel(member: MemberProfileRecord | null): string {
  return member ? `${member.name} · ${member.email}` : '主管資料尚未載入';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '讀取會員資料失敗。';
}
