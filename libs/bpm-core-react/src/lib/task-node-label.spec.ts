import { readTaskNodeText } from './task-node-label';

describe('readTaskNodeText', () => {
  const base = {
    adhocType: null,
    isAdhoc: false,
    nodeId: 'band-0',
    nodeLabel: '部門主管簽核',
  } as const;

  it('shows the node name, not the internal id', () => {
    expect(readTaskNodeText(base)).toBe('部門主管簽核');
  });

  it('falls back to the node id when the label is null, missing or blank', () => {
    expect(readTaskNodeText({ ...base, nodeLabel: null })).toBe('band-0');
    expect(readTaskNodeText({ ...base, nodeLabel: undefined })).toBe('band-0');
    expect(readTaskNodeText({ ...base, nodeLabel: '  ' })).toBe('band-0');
  });

  it('marks ad-hoc tasks the way the instance timeline does', () => {
    expect(
      readTaskNodeText({ ...base, adhocType: 'COUNTERSIGN', isAdhoc: true }),
    ).toBe('部門主管簽核（臨時會簽）');
    expect(
      readTaskNodeText({ ...base, adhocType: 'PRE_APPROVAL', isAdhoc: true }),
    ).toBe('部門主管簽核（臨時加簽）');
    expect(
      readTaskNodeText({
        ...base,
        adhocType: 'PRE_APPROVAL',
        isAdhoc: true,
        nodeLabel: null,
      }),
    ).toBe('band-0（臨時加簽）');
  });
});
