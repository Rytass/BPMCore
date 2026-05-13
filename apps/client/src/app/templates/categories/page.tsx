'use client';

import type { ChangeEvent, Key, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Input,
  Layout,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Tab,
  TabItem,
  Table,
  Textarea,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon } from '@mezzanine-ui/icons';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { BPMFormField } from '../../_components/bpm-form-field';
import { formatDateTime } from '../../_lib/date-time';
import { renderAppNavigation } from '../../app-navigation';
import {
  ApprovalTemplateCategoryRecord,
  ApprovalTemplateCategoryStatus,
  createApprovalTemplateCategory,
  deleteApprovalTemplateCategory,
  listApprovalTemplateCategoriesPage,
  updateApprovalTemplateCategory,
} from '../_lib/template-api';
import styles from '../templates.module.scss';

const CATEGORY_PAGE_SIZE_OPTIONS = [10, 20, 50];
const CATEGORY_STATUS_TABS: readonly {
  readonly key: CategoryStatusTabKey;
  readonly label: string;
}[] = [
  { key: 'ALL', label: '全部' },
  { key: 'ACTIVE', label: '啟用' },
  { key: 'INACTIVE', label: '停用' },
];
type CategoryStatusTabKey = 'ACTIVE' | 'ALL' | 'INACTIVE';

type CategoryRow = Readonly<
  Record<string, unknown> &
    ApprovalTemplateCategoryRecord & {
      key: string;
      updatedAtLabel: string;
    }
>;

type CategoryModalState = Readonly<{
  record: ApprovalTemplateCategoryRecord | null;
  type: 'CREATE' | 'EDIT';
}>;

type DeleteConfirmationState = Readonly<{
  id: string;
  name: string;
}>;

export default function TemplateCategoriesPage(): ReactElement {
  const [categories, setCategories] = useState<
    readonly ApprovalTemplateCategoryRecord[]
  >([]);
  const [categoryPage, setCategoryPage] = useState(1);
  const [categoryPageSize, setCategoryPageSize] = useState(10);
  const [categoryStatus, setCategoryStatus] =
    useState<CategoryStatusTabKey>('ALL');
  const [categoryTotalCount, setCategoryTotalCount] = useState(0);
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState<CategoryModalState | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');

  const refreshCategories = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const categoryPageResult = await listApprovalTemplateCategoriesPage({
        page: categoryPage,
        pageSize: categoryPageSize,
        searchText,
        status: readCategoryStatus(categoryStatus),
      });

      setCategories(categoryPageResult.categories);
      setCategoryTotalCount(categoryPageResult.totalCount);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [categoryPage, categoryPageSize, categoryStatus, searchText]);

  useEffect((): void => {
    void refreshCategories();
  }, [refreshCategories]);

  const rows = useMemo(
    (): CategoryRow[] =>
      categories.map((category) => ({
        ...category,
        key: category.id,
        updatedAtLabel: formatDateTime(category.updatedAt),
      })),
    [categories],
  );

  const columns = useMemo(
    (): TableColumn<CategoryRow>[] => [
      { dataIndex: 'name', key: 'name', title: '分類名稱', width: 180 },
      {
        key: 'status',
        render: (record: CategoryRow): ReactElement => (
          <CategoryStatusBadge isActive={record.isActive} />
        ),
        title: '狀態',
        width: 120,
      },
      {
        dataIndex: 'sortOrder',
        key: 'sortOrder',
        title: '排序',
        width: 100,
      },
      {
        key: 'description',
        render: (record: CategoryRow): ReactElement => (
          <Typography component="span" variant="body">
            {record.description || '無'}
          </Typography>
        ),
        title: '說明',
        width: 260,
      },
      {
        dataIndex: 'updatedAtLabel',
        key: 'updatedAtLabel',
        title: '更新時間',
        width: 220,
      },
    ],
    [],
  );

  async function handleSaveCategory(input: CategoryFormInput): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      if (modalState?.type === 'EDIT' && modalState.record) {
        await updateApprovalTemplateCategory({
          ...input,
          id: modalState.record.id,
        });
      } else {
        await createApprovalTemplateCategory(input);
      }

      setModalState(null);
      await refreshCategories();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
      throw requestError;
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleCategory(
    record: ApprovalTemplateCategoryRecord,
  ): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      await updateApprovalTemplateCategory({
        description: record.description,
        id: record.id,
        isActive: !record.isActive,
        name: record.name,
        sortOrder: record.sortOrder,
      });
      await refreshCategories();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!deleteConfirmation) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await deleteApprovalTemplateCategory(deleteConfirmation.id);
      setDeleteConfirmation(null);
      await refreshCategories();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const tableActions = useMemo(
    (): TableActions<CategoryRow> => ({
      render: (record): ReturnType<TableActions<CategoryRow>['render']> => [
        {
          name: '編輯',
          onClick: (): void => setModalState({ record, type: 'EDIT' }),
        },
        {
          name: record.isActive ? '停用' : '啟用',
          onClick: (): void => void handleToggleCategory(record),
          variant: record.isActive ? 'destructive-secondary' : 'base-secondary',
        },
        {
          name: '刪除',
          onClick: (): void =>
            setDeleteConfirmation({ id: record.id, name: record.name }),
          variant: 'destructive-secondary',
        },
      ],
      variant: 'base-secondary',
      width: 192,
    }),
    [refreshCategories],
  );

  return (
    <>
      <Layout>
        {renderAppNavigation('/templates/categories')}

        <Layout.Main>
          <PageHeader>
            <ContentHeader
              description="維護簽核模板分類，供模板建立、篩選與列表標示使用。"
              title="簽核模板分類"
            >
              <Button
                icon={PlusIcon}
                iconType="leading"
                onClick={(): void =>
                  setModalState({ record: null, type: 'CREATE' })
                }
                variant="base-primary"
              >
                建立分類
              </Button>
            </ContentHeader>
          </PageHeader>

          <SectionGroup>
            <Section
              filterArea={
                <FilterArea className={styles.templateFilterArea} size="sub">
                  <FilterLine>
                    <Filter span={3}>
                      <FormField
                        fullWidth
                        label="關鍵字"
                        layout={FormFieldLayout.VERTICAL}
                        name="categorySearchText"
                      >
                        <Input
                          fullWidth
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>,
                          ): void => {
                            setSearchText(event.target.value);
                            setCategoryPage(1);
                          }}
                          placeholder="搜尋分類名稱或說明"
                          size="sub"
                          value={searchText}
                          variant="base"
                        />
                      </FormField>
                    </Filter>
                  </FilterLine>
                </FilterArea>
              }
              tab={
                <Tab
                  activeKey={categoryStatus}
                  onChange={(activeKey): void => {
                    setCategoryStatus(readCategoryStatusTabKey(activeKey));
                    setCategoryPage(1);
                  }}
                >
                  {CATEGORY_STATUS_TABS.map((statusTab) => (
                    <TabItem key={statusTab.key}>{statusTab.label}</TabItem>
                  ))}
                </Tab>
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
                loading={loading || saving}
                pagination={{
                  current: categoryPage,
                  onChange: (page): void => {
                    setCategoryPage(page);
                  },
                  onChangePageSize: (pageSize): void => {
                    setCategoryPage(1);
                    setCategoryPageSize(pageSize);
                  },
                  pageSize: categoryPageSize,
                  pageSizeLabel: '每頁筆數',
                  pageSizeOptions: CATEGORY_PAGE_SIZE_OPTIONS,
                  renderResultSummary: (from, to, total): string =>
                    `顯示 ${from}-${to} 筆，共 ${total} 筆`,
                  showPageSizeOptions: true,
                  total: categoryTotalCount,
                }}
              />
            </Section>
          </SectionGroup>
        </Layout.Main>
      </Layout>

      <CategoryModal
        loading={saving}
        modal={modalState}
        onClose={(): void => setModalState(null)}
        onSubmit={handleSaveCategory}
      />
      <Modal
        cancelText="取消"
        confirmButtonProps={{ variant: 'destructive-primary' }}
        confirmText="刪除"
        loading={saving}
        modalStatusType="error"
        modalType="standard"
        onCancel={(): void => setDeleteConfirmation(null)}
        onClose={(): void => setDeleteConfirmation(null)}
        onConfirm={(): void => void handleConfirmDelete()}
        open={Boolean(deleteConfirmation)}
        showModalFooter
        showModalHeader
        size="regular"
        supportingText="若分類已被模板使用，系統會改為停用分類並保留既有模板關聯。"
        title="刪除分類"
      >
        <Typography color="text-neutral" variant="body">
          確定要刪除「{deleteConfirmation?.name ?? ''}」嗎？
        </Typography>
      </Modal>
    </>
  );
}

interface CategoryFormInput {
  readonly description: string | null;
  readonly isActive: boolean;
  readonly name: string;
  readonly sortOrder: number;
}

function CategoryModal({
  loading,
  modal,
  onClose,
  onSubmit,
}: {
  readonly loading: boolean;
  readonly modal: CategoryModalState | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: CategoryFormInput) => Promise<void>;
}): ReactElement {
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');

  useEffect((): void => {
    if (!modal) {
      return;
    }

    setDescription(modal.record?.description ?? '');
    setError(null);
    setName(modal.record?.name ?? '');
    setSortOrder(String(modal.record?.sortOrder ?? 0));
  }, [modal]);

  async function handleConfirm(): Promise<void> {
    const trimmedName = name.trim();
    const parsedSortOrder = Number(sortOrder);

    if (!trimmedName) {
      setError('請輸入分類名稱');
      return;
    }

    if (!Number.isInteger(parsedSortOrder)) {
      setError('排序必須是整數');
      return;
    }

    try {
      await onSubmit({
        description: description.trim() || null,
        isActive: modal?.record?.isActive ?? true,
        name: trimmedName,
        sortOrder: parsedSortOrder,
      });
    } catch (submitError: unknown) {
      setError(readErrorMessage(submitError));
    }
  }

  return (
    <Modal
      cancelText="取消"
      confirmButtonProps={{ disabled: !name.trim() }}
      confirmText={modal?.type === 'EDIT' ? '儲存' : '建立'}
      loading={loading}
      modalType="standard"
      onCancel={onClose}
      onClose={onClose}
      onConfirm={(): void => void handleConfirm()}
      open={Boolean(modal)}
      showModalFooter
      showModalHeader
      size="regular"
      title={modal?.type === 'EDIT' ? '編輯分類' : '建立分類'}
    >
      <div className={styles.templateModalFields}>
        <BPMFormField label="分類名稱" name="categoryName" required>
          <Input
            autoFocus
            fullWidth
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="例如：行政管理"
            value={name}
            variant="base"
          />
        </BPMFormField>
        <BPMFormField label="排序" name="categorySortOrder">
          <Input
            fullWidth
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              setSortOrder(event.target.value);
              setError(null);
            }}
            placeholder="0"
            value={sortOrder}
            variant="base"
          />
        </BPMFormField>
        <BPMFormField label="說明" name="categoryDescription">
          <Textarea
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
              setDescription(event.target.value);
              setError(null);
            }}
            placeholder="補充分類用途"
            value={description}
          />
        </BPMFormField>
      </div>
      {error ? (
        <Typography color="text-error" variant="body">
          {error}
        </Typography>
      ) : null}
    </Modal>
  );
}

function CategoryStatusBadge({
  isActive,
}: {
  readonly isActive: boolean;
}): ReactElement {
  return isActive ? (
    <Badge size="sub" text="啟用" variant="dot-success" />
  ) : (
    <Badge size="sub" text="停用" variant="dot-inactive" />
  );
}

function readCategoryStatusTabKey(activeKey: Key): CategoryStatusTabKey {
  if (activeKey === 'ACTIVE' || activeKey === 'INACTIVE') {
    return activeKey;
  }

  return 'ALL';
}

function readCategoryStatus(
  status: CategoryStatusTabKey,
): ApprovalTemplateCategoryStatus {
  return status;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
