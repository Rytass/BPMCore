import {
  applyOpenColumnCells,
  ApproverFilledDeferral,
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
