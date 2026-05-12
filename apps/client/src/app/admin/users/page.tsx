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
  Layout,
  Modal,
  Section,
  SectionGroup,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import styles from './users.module.scss';
import { renderAppNavigation } from '../../app-navigation';
import {
  listMemberDirectoryPage,
  MemberProfileRecord,
} from '../_lib/member-api';
import {
  listMemberships,
  MembershipRecord,
  OrgUnitRecord,
  PositionRecord,
  readOrganizationDashboard,
  readResolvedManager,
  ResolvedManagerRecord,
} from '../_lib/organization-api';

type MemberRow = Readonly<
  Record<string, unknown> &
    MemberProfileRecord & {
      key: string;
      orgUnit: string;
      position: string;
    }
>;

const MEMBER_PAGE_SIZE_OPTIONS = [10, 20, 50];

export default function AdminUsersPage(): ReactElement {
  const [detailMember, setDetailMember] = useState<MemberProfileRecord | null>(
    null,
  );
  const [detailMemberships, setDetailMemberships] = useState<
    readonly MembershipRecord[]
  >([]);
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
        orgUnit: member.primaryOrgUnitId
          ? readOrgUnitLabel(orgUnitsById.get(member.primaryOrgUnitId))
          : '未綁定',
        position: member.positionId
          ? readPositionLabel(positionsById.get(member.positionId))
          : '未綁定',
      })),
    [members, orgUnitsById, positionsById],
  );

  const openDetail = useCallback(
    async (member: MemberProfileRecord): Promise<void> => {
      setDetailMember(member);
      setError(null);

      try {
        const [memberships, resolvedManager] = await Promise.all([
          listMemberships({ memberId: member.memberId }),
          readResolvedManager(member.memberId),
        ]);

        setDetailMemberships(memberships);
        setDetailResolvedManager(resolvedManager);
      } catch (requestError: unknown) {
        setError(readErrorMessage(requestError));
      }
    },
    [],
  );

  const columns = useMemo(
    (): TableColumn<MemberRow>[] => [
      { dataIndex: 'memberId', key: 'memberId', title: 'Member ID', width: 180 },
      { dataIndex: 'name', key: 'name', title: '姓名', width: 160 },
      { dataIndex: 'email', key: 'email', title: 'Email', width: 260 },
      { dataIndex: 'orgUnit', key: 'orgUnit', title: '主要組織', width: 200 },
      { dataIndex: 'position', key: 'position', title: '職位', width: 180 },
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
    setDetailMemberships([]);
    setDetailResolvedManager(null);
  }

  return (
    <Layout>
      {renderAppNavigation('/admin/users')}

      <Layout.Main>
        <div className={styles.header}>
          <Typography component="h1" variant="h2">
            會員對照
          </Typography>
          <Typography color="text-neutral" variant="body">
            會員資料由 host member resolver 提供，BPM 僅維護組織歸屬與主管解析。
          </Typography>
        </div>

        <SectionGroup>
          <Section
            filterArea={
              <FilterArea className={styles.memberFilterArea}>
                <FilterLine>
                  <Filter span={3}>
                    <FormField
                      fullWidth
                      label="關鍵字"
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
                        placeholder="搜尋姓名、Email 或 member_id"
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
            <Typography component="h2" variant="h3">
              會員列表
            </Typography>
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
          member={detailMember}
          memberships={detailMemberships}
          onClose={closeDetail}
          orgUnitsById={orgUnitsById}
          positionsById={positionsById}
          resolvedManager={detailResolvedManager}
        />
      </Layout.Main>
    </Layout>
  );
}

function MemberDetailModal({
  member,
  memberships,
  onClose,
  orgUnitsById,
  positionsById,
  resolvedManager,
}: {
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
              <Typography variant="body">Member ID：{member.memberId}</Typography>
              <Typography variant="body">Email：{member.email}</Typography>
              <Typography variant="body">
                外部主要組織：{member.primaryOrgUnitId ?? '未提供'}
              </Typography>
              <Typography variant="body">
                外部職位：{member.positionId ?? '未提供'}
              </Typography>
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
              {resolvedManager?.managerMemberId ?? '尚未解析到主管'}
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '讀取會員資料失敗。';
}
