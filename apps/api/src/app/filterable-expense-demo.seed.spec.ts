import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FormDataSourceValueSnapshot,
  readFilterableFieldIssues,
  readFilterableFieldPaths,
} from '@rytass/bpm-core-shared';
import {
  DEMO_VENDOR_OPTIONS,
  VENDOR_DATA_SOURCE_KEY,
} from './api-form-data-source';
import {
  FILTERABLE_EXPENSE_FORM_SCHEMA,
  FILTERABLE_EXPENSE_FINANCE_REVIEWER_MEMBER_ID,
  FILTERABLE_EXPENSE_IDS,
  FILTERABLE_EXPENSE_ORG_UNIT_IDS,
  FILTERABLE_EXPENSE_RECIPES,
  FILTERABLE_EXPENSE_UNRELATED_MEMBER_ID,
  readFilterableExpenseInstances,
  readFilterableExpenseNotifications,
} from './filterable-expense-demo.seed';

type SeedInstance = ReturnType<typeof readFilterableExpenseInstances>[number];

const instances = readFilterableExpenseInstances();
const notifications = readFilterableExpenseNotifications();

function readInstance(id: string): SeedInstance {
  const instance = instances.find((item) => item.id === id);

  if (!instance) {
    throw new Error(`Missing seed instance ${id}`);
  }

  return instance;
}

function readItems(
  instance: SeedInstance,
): readonly { readonly sku: string; readonly qty: number }[] {
  return instance.formData.items as readonly {
    readonly sku: string;
    readonly qty: number;
  }[];
}

function readCaseNumber(instance: SeedInstance): number {
  return Number(instance.id.slice(-3)) - 100;
}

describe('filterable expense demo seed (ADR 25 acceptance template)', () => {
  it('passes the enable check with no history and no dirty values', (): void => {
    expect(
      readFilterableFieldIssues({
        history: [],
        instances: instances.map((instance) => ({
          formData: instance.formData,
          id: instance.id,
        })),
        schema: FILTERABLE_EXPENSE_FORM_SCHEMA,
      }),
    ).toEqual([]);
  });

  it('marks exactly the acceptance fields as filterable, leaving note and memo out', (): void => {
    expect(
      readFilterableFieldPaths(FILTERABLE_EXPENSE_FORM_SCHEMA).map(
        (item) => item.path,
      ),
    ).toEqual([
      'vendor',
      'amountTwd',
      'applyDate',
      'companyCode',
      'requestType',
      'demandDept',
      'items.sku',
      'items.qty',
    ]);
  });

  it('stores values in the canonical formats of ADR 25 §6', (): void => {
    for (const instance of instances) {
      const { amountTwd, applyDate } = instance.formData;

      if (amountTwd !== undefined) {
        expect(
          amountTwd === null || typeof amountTwd === 'number',
        ).toBe(true);
      }
      expect(
        applyDate === null ||
          (typeof applyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(applyDate)),
      ).toBe(true);
      expect(new Date(instance.startedAt).toISOString()).toBe(instance.startedAt);
      expect(new Date(instance.updatedAt).toISOString()).toBe(instance.updatedAt);

      if (instance.completedAt !== null) {
        expect(new Date(instance.completedAt).toISOString()).toBe(
          instance.completedAt,
        );
      }
    }
  });

  it('has 24 cases with unique instance, token and task ids', (): void => {
    const ids = instances.map((instance) => instance.id);
    const tokenIds = instances.map((instance) => instance.token.id);
    const taskIds = instances.flatMap((instance) =>
      instance.tasks.map((task) => task.id),
    );

    expect(instances).toHaveLength(24);
    expect(new Set(ids).size).toBe(24);
    expect(new Set(tokenIds).size).toBe(24);
    expect(new Set(taskIds).size).toBe(taskIds.length);
  });

  it('covers several initiators, a shared finance reviewer, and CC notifications', (): void => {
    const initiators = new Set(instances.map((item) => item.initiatorMemberId));
    const financeCases = new Set(
      instances
        .filter((instance) =>
          instance.tasks.some(
            (task) =>
              task.assigneeMemberId === FILTERABLE_EXPENSE_FINANCE_REVIEWER_MEMBER_ID,
          ),
        )
        .map((instance) => instance.id),
    );
    const ccCases = new Set(notifications.map((item) => item.instanceId));

    expect(initiators.size).toBeGreaterThanOrEqual(3);
    expect(financeCases.size).toBeGreaterThanOrEqual(3);
    expect(ccCases.size).toBeGreaterThanOrEqual(3);
  });

  it('keeps the unrelated member out of every initiator, task and CC', (): void => {
    const unrelated = FILTERABLE_EXPENSE_UNRELATED_MEMBER_ID;

    expect(instances.some((item) => item.initiatorMemberId === unrelated)).toBe(
      false,
    );
    expect(
      instances.some((item) =>
        item.tasks.some((task) => task.assigneeMemberId === unrelated),
      ),
    ).toBe(false);
    expect(notifications.some((item) => item.recipientMemberId === unrelated)).toBe(
      false,
    );
  });

  it('mixes every state, with completedAt only on finished cases', (): void => {
    const states = new Set(instances.map((item) => item.state));

    expect([...states].sort()).toEqual(
      ['APPROVED', 'CANCELLED', 'REJECTED', 'RETURNED', 'RUNNING'],
    );

    for (const instance of instances) {
      if (instance.state === 'RUNNING') {
        expect(instance.completedAt).toBeNull();
        expect(instance.token.status).toBe('ACTIVE');
      } else {
        expect(instance.completedAt).not.toBeNull();
        expect(instance.token.status).toBe('CONSUMED');
      }
    }
  });

  it('spreads submission and update dates across days', (): void => {
    const startDays = new Set(instances.map((item) => item.startedAt.slice(0, 10)));
    const updateDays = new Set(instances.map((item) => item.updatedAt.slice(0, 10)));

    expect(startDays.size).toBeGreaterThanOrEqual(15);
    expect(updateDays.size).toBeGreaterThanOrEqual(15);
  });

  it('has one case with no amount key and one with an empty application date', (): void => {
    expect(
      instances.filter((item) => !('amountTwd' in item.formData)),
    ).toHaveLength(1);
    expect(
      instances.filter((item) => item.formData.applyDate === null),
    ).toHaveLength(1);
  });

  it('separates a SKU-A and quantity match on one row from the same two conditions on different rows', (): void => {
    const matchesOnOneRow = (instance: SeedInstance): boolean =>
      readItems(instance).some((row) => row.sku === 'SKU-A' && row.qty >= 10);
    const matchesOnDifferentRows = (instance: SeedInstance): boolean =>
      readItems(instance).some((row) => row.sku === 'SKU-A') &&
      readItems(instance).some((row) => row.qty >= 10) &&
      !matchesOnOneRow(instance);

    expect(
      instances.filter(matchesOnOneRow).map(readCaseNumber),
    ).toEqual([5, 12]);
    expect(
      instances.filter(matchesOnDifferentRows).map(readCaseNumber),
    ).toEqual([4, 10, 16]);
  });

  it('gives one vendor enough cases and a wide amount spread for range filters', (): void => {
    const vendorCounts = new Map<string, number>();

    for (const instance of instances) {
      const vendor = String(instance.formData.vendor);
      vendorCounts.set(vendor, (vendorCounts.get(vendor) ?? 0) + 1);
    }

    expect(Math.max(...vendorCounts.values())).toBeGreaterThanOrEqual(5);

    const amounts = instances
      .map((item) => item.formData.amountTwd)
      .filter((value): value is number => typeof value === 'number');

    expect(Math.min(...amounts)).toBeLessThan(10000);
    expect(Math.max(...amounts)).toBeGreaterThan(500000);
  });

  it('writes an option snapshot whose label matches the vendor the value points at', (): void => {
    for (const instance of instances) {
      const vendorId = String(instance.formData.vendor);
      const snapshot: FormDataSourceValueSnapshot | undefined =
        instance.optionSnapshot.vendor;
      const option = DEMO_VENDOR_OPTIONS.find((item) => item.value === vendorId);

      expect(snapshot).toBeDefined();
      expect(snapshot?.dataSourceKey).toBe(VENDOR_DATA_SOURCE_KEY);
      expect(snapshot?.dataSourceVersion).toBe(1);
      expect(snapshot?.options).toEqual([option]);
    }
  });

  it('uses the same org unit ids as the reset script', (): void => {
    const resetSource = readFileSync(
      join(__dirname, '../../tools/reset-demo-data.ts'),
      'utf8',
    );

    for (const id of Object.values(FILTERABLE_EXPENSE_ORG_UNIT_IDS)) {
      expect(resetSource).toContain(id);
    }
  });

  it('exposes the template ids that verifiers rely on', (): void => {
    expect(FILTERABLE_EXPENSE_IDS).toEqual({
      FORM_DEFINITION: '30000000-0000-4000-8000-000000000010',
      FORM_VERSION: '31000000-0000-4000-8000-000000000012',
      TEMPLATE: '50000000-0000-4000-8000-000000000014',
      TEMPLATE_VERSION: '51000000-0000-4000-8000-000000000016',
    });
    expect(FILTERABLE_EXPENSE_RECIPES.map((item) => item.id)).toEqual(
      instances.map((item) => item.id),
    );
    expect(readInstance(FILTERABLE_EXPENSE_RECIPES[0].id).id).toBe(
      '60000000-0000-4000-8000-000000000101',
    );
  });
});
