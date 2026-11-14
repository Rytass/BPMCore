import { ConflictException } from '@nestjs/common';

import {
  FieldAccessEntry,
  FormDefinitionSchema,
  UserTaskNode,
} from '@rytass/bpm-core-shared';

import {
  APPROVER_FILL_ERROR_CODES,
  applyOpenColumnCells,
  ApproverFilledDeferral,
  NodeColumnFillMap,
  projectNodeOpenColumnsRequired,
  readNodeColumnFillMap,
  settleColumnFillPayload,
} from './approver-filled-table-columns';

const deferral: ApproverFilledDeferral = {
  openColumnsByTable: new Map([['items', new Set(['seq'])]]),
  wholeKeys: new Set(),
};

type Row = Readonly<Record<string, unknown>>;

const stored: Row = {
  amount: 10,
  items: [
    { name: 'A', seq: 1 },
    { name: 'B', seq: 2 },
  ],
};

describe('applyOpenColumnCells', () => {
  it('keeps the stored open cell on a row the applicant did not change', (): void => {
    const result = applyOpenColumnCells(
      { amount: 10, items: [{ name: 'A' }, { name: 'B' }] },
      stored,
      deferral,
    );

    expect(result).toEqual({
      amount: 10,
      items: [
        { name: 'A', seq: 1 },
        { name: 'B', seq: 2 },
      ],
    });
  });

  it('drops the approver value only on the row the applicant edited', (): void => {
    const result = applyOpenColumnCells(
      { amount: 10, items: [{ name: 'A-edited' }, { name: 'B' }] },
      stored,
      deferral,
    );

    expect(result).toEqual({
      amount: 10,
      items: [{ name: 'A-edited' }, { name: 'B', seq: 2 }],
    });
  });

  it('drops the approver values of a reordered list', (): void => {
    const result = applyOpenColumnCells(
      { amount: 10, items: [{ name: 'B' }, { name: 'A' }] },
      stored,
      deferral,
    );

    expect(result).toEqual({
      amount: 10,
      items: [{ name: 'B' }, { name: 'A' }],
    });
  });

  it('does not carry an approver value onto the row that moves up after a deletion', (): void => {
    const result = applyOpenColumnCells(
      { amount: 10, items: [{ name: 'B' }] },
      stored,
      deferral,
    );

    expect(result).toEqual({ amount: 10, items: [{ name: 'B' }] });
  });

  it('does not carry an approver value across an inserted row', (): void => {
    const result = applyOpenColumnCells(
      { amount: 10, items: [{ name: 'NEW' }, { name: 'A' }, { name: 'B' }] },
      stored,
      deferral,
    );

    expect(result).toEqual({
      amount: 10,
      items: [{ name: 'NEW' }, { name: 'A' }, { name: 'B' }],
    });
  });

  it('never keeps a submitted open cell, even one that matches the stored value', (): void => {
    const result = applyOpenColumnCells(
      { amount: 10, items: [{ name: 'A', seq: 99 }] },
      { items: [{ name: 'A' }] },
      deferral,
    );

    expect(result).toEqual({ amount: 10, items: [{ name: 'A' }] });
  });

  it('keeps no open cell on a first submission', (): void => {
    const result = applyOpenColumnCells(
      { amount: 10, items: [{ name: 'A', seq: 7 }] },
      null,
      deferral,
    );

    expect(result).toEqual({ amount: 10, items: [{ name: 'A' }] });
  });
});

const openSeq: NodeColumnFillMap = new Map([
  ['items', new Map<string, 'OPTIONAL'>([['seq', 'OPTIONAL']])],
]);

const readErrorCode = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    if (error instanceof ConflictException) {
      const response: unknown = error.getResponse();

      return typeof response === 'object' &&
        response !== null &&
        'code' in response
        ? response.code
        : undefined;
    }

    throw error;
  }

  return 'NO_ERROR';
};

describe('settleColumnFillPayload', () => {
  it('takes the open cell from the payload and every other cell from the stored row', (): void => {
    const result = settleColumnFillPayload(
      {
        amount: 10,
        items: [
          { name: 'A', seq: 5 },
          { name: 'B', seq: 6 },
        ],
      },
      stored,
      openSeq,
    );

    expect(result).toEqual({
      amount: 10,
      items: [
        { name: 'A', seq: 5 },
        { name: 'B', seq: 6 },
      ],
    });
  });

  it('stores a missing open cell as null', (): void => {
    const result = settleColumnFillPayload(
      { amount: 10, items: [{ name: 'A' }, { name: 'B' }] },
      stored,
      openSeq,
    );

    expect(result).toEqual({
      amount: 10,
      items: [
        { name: 'A', seq: null },
        { name: 'B', seq: null },
      ],
    });
  });

  it('rejects a changed applicant cell with CELL_LOCKED', (): void => {
    expect(
      readErrorCode(() =>
        settleColumnFillPayload(
          { amount: 10, items: [{ name: 'A-edited', seq: 5 }, { name: 'B' }] },
          stored,
          openSeq,
        ),
      ),
    ).toBe(APPROVER_FILL_ERROR_CODES.CELL_LOCKED);
  });

  it('rejects an added row with TABLE_ROWS_LOCKED', (): void => {
    expect(
      readErrorCode(() =>
        settleColumnFillPayload(
          {
            amount: 10,
            items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
          },
          stored,
          openSeq,
        ),
      ),
    ).toBe(APPROVER_FILL_ERROR_CODES.TABLE_ROWS_LOCKED);
  });

  it('rejects a deleted row with TABLE_ROWS_LOCKED', (): void => {
    expect(
      readErrorCode(() =>
        settleColumnFillPayload(
          { amount: 10, items: [{ name: 'A' }] },
          stored,
          openSeq,
        ),
      ),
    ).toBe(APPROVER_FILL_ERROR_CODES.TABLE_ROWS_LOCKED);
  });

  it('rejects a reordered list with TABLE_ROWS_LOCKED, not CELL_LOCKED', (): void => {
    expect(
      readErrorCode(() =>
        settleColumnFillPayload(
          { amount: 10, items: [{ name: 'B' }, { name: 'A' }] },
          stored,
          openSeq,
        ),
      ),
    ).toBe(APPROVER_FILL_ERROR_CODES.TABLE_ROWS_LOCKED);
  });

  it('rejects a null table when stored rows exist, so rows cannot be wiped', (): void => {
    expect(
      readErrorCode(() =>
        settleColumnFillPayload({ amount: 10, items: null }, stored, openSeq),
      ),
    ).toBe(APPROVER_FILL_ERROR_CODES.TABLE_ROWS_LOCKED);
  });

  it('keeps a null table null when the stored data has no rows', (): void => {
    const result = settleColumnFillPayload(
      { amount: 10, items: null },
      { amount: 10 },
      openSeq,
    );

    expect(result).toEqual({ amount: 10, items: null });
  });

  it('passes fields outside the column map through unchanged', (): void => {
    const result = settleColumnFillPayload(
      {
        amount: 99,
        items: [
          { name: 'A', seq: 5 },
          { name: 'B', seq: 6 },
        ],
      },
      stored,
      openSeq,
    );

    expect(result.amount).toBe(99);
  });
});

const columnField = (
  fieldKey: string,
  required: boolean,
): FormDefinitionSchema['fields'][number] => ({
  columns: [
    { fieldKey: 'seq', label: '序號', required, type: 'number' },
    { fieldKey: 'name', label: '名稱', required: false, type: 'text' },
  ],
  fieldKey,
  label: '明細',
  minRows: 1,
  required: false,
  type: 'table',
});

describe('projectNodeOpenColumnsRequired', () => {
  it('makes an open column REQUIRED and leaves the other columns alone', (): void => {
    const schema: FormDefinitionSchema = {
      fields: [columnField('items', false)],
      schemaVersion: 1,
    };

    const projected = projectNodeOpenColumnsRequired(
      schema,
      new Map([['items', new Map<string, 'REQUIRED'>([['seq', 'REQUIRED']])]]),
    );

    const field = projected.fields[0];

    expect(field.type).toBe('table');
    if (field.type !== 'table') {
      return;
    }
    expect(field.columns.map((column) => column.required)).toEqual([
      true,
      false,
    ]);
    expect(field.minRows).toBe(1);
  });

  it('keeps an OPTIONAL open column optional', (): void => {
    const schema: FormDefinitionSchema = {
      fields: [columnField('items', false)],
      schemaVersion: 1,
    };

    const projected = projectNodeOpenColumnsRequired(schema, openSeq);
    const field = projected.fields[0];

    expect(field.type).toBe('table');
    if (field.type !== 'table') {
      return;
    }
    expect(field.columns[0].required).toBe(false);
  });
});

describe('readNodeColumnFillMap', () => {
  const node = (fieldAccess: readonly FieldAccessEntry[]): UserTaskNode => ({
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: true,
      approverResolver: { memberIds: ['member-finance'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      fieldAccess,
      label: '財務簽核',
      returnBehavior: { allowReturn: false, allowedTargets: 'PREVIOUS' },
    },
    id: 'task_finance',
    position: { x: 0, y: 0 },
    type: 'userTask',
  });

  it('maps each column-mode table to its open columns and their fills', (): void => {
    const map = readNodeColumnFillMap(
      node([
        {
          display: 'SHOW',
          fieldKey: 'items',
          fill: 'NONE',
          columns: [
            { columnKey: 'seq', fill: 'OPTIONAL' },
            { columnKey: 'name', fill: 'REQUIRED' },
          ],
        },
      ]),
    );

    expect(map.get('items')).toEqual(
      new Map([
        ['seq', 'OPTIONAL'],
        ['name', 'REQUIRED'],
      ]),
    );
  });

  it('leaves out a table this node grants whole', (): void => {
    const map = readNodeColumnFillMap(
      node([
        { display: 'SHOW', fieldKey: 'items', fill: 'OPTIONAL' },
        {
          display: 'SHOW',
          fieldKey: 'items',
          fill: 'NONE',
          columns: [{ columnKey: 'seq', fill: 'OPTIONAL' }],
        },
      ]),
    );

    expect(map.has('items')).toBe(false);
  });

  it('is empty for a node with no column-mode entry', (): void => {
    expect(
      readNodeColumnFillMap(
        node([{ display: 'SHOW', fieldKey: 'amount', fill: 'OPTIONAL' }]),
      ).size,
    ).toBe(0);
  });
});
