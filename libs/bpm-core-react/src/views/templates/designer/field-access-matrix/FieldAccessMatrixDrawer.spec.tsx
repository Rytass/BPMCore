import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  FieldAccessEntry,
  FieldAccessMatrixEntry,
} from '@rytass/bpm-core-shared';
import type {
  FormDefinitionSchema,
  FormFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import type {
  UserTaskNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  FieldAccessMatrixDrawer,
  rebaseFieldAccessDraft,
  updateFieldAccessDraft,
} from './FieldAccessMatrixDrawer';
import { FieldAccessNodeSection } from './FieldAccessNodeSection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/table', () => ({}));

jest.mock('@mezzanine-ui/react/Drawer', () => ({
  __esModule: true,
  default: (props: Readonly<Record<string, unknown>>): ReactElement | null =>
    props.open ? (
      <div>
        {props.children as ReactNode}
        <button
          onClick={props.bottomOnPrimaryActionClick as () => void}
          type="button"
        >
          {props.bottomPrimaryActionText as string}
        </button>
        <button
          onClick={props.bottomOnGhostActionClick as () => void}
          type="button"
        >
          {props.bottomGhostActionText as string}
        </button>
      </div>
    ) : null,
}));

jest.mock('@mezzanine-ui/react', () => {
  const Table = (props: Readonly<Record<string, unknown>>): ReactElement => {
    const columns = props.columns as readonly {
      readonly key: string;
      readonly render: (row: unknown) => ReactNode;
    }[];
    const rows = props.dataSource as readonly Readonly<{ key: string }>[];

    return (
      <div>
        {rows.map((row): ReactElement => (
          <div data-row={row.key} key={row.key}>
            {columns.map((column): ReactElement => (
              <span data-column={column.key} key={column.key}>
                {column.render(row)}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  };
  const Select = (props: Readonly<Record<string, unknown>>): ReactElement => {
    const options = props.options as readonly {
      readonly id: string;
      readonly name: string;
    }[];
    const value = props.value as { readonly id: string } | null;
    const inputProps = props.inputProps as Readonly<Record<string, string>>;

    return (
      <select
        aria-label={inputProps['aria-label']}
        onChange={(event): void =>
          (props.onChange as (option: unknown) => void)(
            options.find((option) => option.id === event.target.value) ?? null,
          )
        }
        value={value?.id ?? ''}
      >
        {options.map((option): ReactElement => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  };

  return {
    Badge: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span data-variant={props.variant as string}>{props.text as string}</span>
    ),
    Button: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <button
        disabled={Boolean(props.disabled)}
        onClick={props.onClick as () => void}
        type="button"
      >
        {props.children as ReactNode}
      </button>
    ),
    InlineMessage: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <div data-severity={props.severity as string}>
        {props.content as string}
      </div>
    ),
    Select,
    Table,
    Toggle: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <label>
        <input
          checked={Boolean(props.checked)}
          onChange={props.onChange as () => void}
          type="checkbox"
        />
        {props.label as string}
      </label>
    ),
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
  };
});

const userTask = (
  id: string,
  fieldAccess: readonly FieldAccessEntry[] = [],
  data: Readonly<Record<string, unknown>> = {},
): UserTaskNode =>
  ({
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      ...(fieldAccess.length ? { fieldAccess } : {}),
      label: id === 'manager' ? '主管' : '財務',
      returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
      ...data,
    },
    id,
    position: { x: 0, y: 0 },
    type: 'userTask',
  }) as UserTaskNode;

const edge = (source: string, target: string): WorkflowEdge => ({
  data: {},
  id: `${source}-${target}`,
  source,
  target,
});

const field = (
  fieldKey: string,
  type: FormFieldDefinition['type'] = 'text',
): FormFieldDefinition =>
  ({
    fieldKey,
    label: `欄位${fieldKey}`,
    required: false,
    type,
  }) as FormFieldDefinition;

const schema: FormDefinitionSchema = {
  fields: [field('amount', 'number'), field('note'), field('flag', 'boolean')],
  schemaVersion: 1,
};

const definitionOf = (nodes: readonly WorkflowNode[]): WorkflowDefinition => ({
  edges: [edge('manager', 'finance')],
  meta: { schemaVersion: 1 },
  nodes: [...nodes],
});

describe('FieldAccessMatrixDrawer', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onApply = jest.fn<string | null, [readonly FieldAccessMatrixEntry[]]>();
  const onClose = jest.fn<void, []>();

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onApply.mockReset();
    onApply.mockReturnValue(null);
    onClose.mockReset();
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  function render(definition: WorkflowDefinition): void {
    act((): void => {
      root.render(
        <FieldAccessMatrixDrawer
          definition={definition}
          formSchema={schema}
          language="zh-TW"
          onApply={onApply}
          onClose={onClose}
          open
        />,
      );
    });
  }

  function select(label: string): HTMLSelectElement {
    const element = container.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    );

    if (!element) {
      throw new Error(`No select labelled ${label}`);
    }

    return element;
  }

  function choose(label: string, value: string): void {
    act((): void => {
      const element = select(label);

      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function click(text: string): void {
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === text,
    );

    act((): void => button?.click());
  }

  function rowKeys(): readonly string[] {
    return [...container.querySelectorAll('[data-row]')].map(
      (row) => row.getAttribute('data-row') ?? '',
    );
  }

  function toggleFilter(): void {
    act((): void => {
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click();
    });
  }

  function showAllFields(): void {
    if (
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked
    ) {
      toggleFilter();
    }
  }

  it('shows the derived value for a cell nobody set', () => {
    render(
      definitionOf([
        userTask('manager'),
        userTask('finance', [
          { display: 'SHOW', fieldKey: 'note', fill: 'OPTIONAL' },
        ]),
      ]),
    );

    const manager = select('欄位note 在關卡 1的設定');

    expect(manager.value).toBe('DEFAULT');
    expect(manager.selectedOptions[0].textContent).toBe('預設：不顯示');
    expect(
      container.querySelector('[data-row="note"] [data-column="applicant"]')
        ?.textContent,
    ).toBe('不顯示（關卡 2 補填）');
  });

  it('applies nothing and closes when only a default was picked back', () => {
    render(definitionOf([userTask('manager'), userTask('finance')]));
    showAllFields();
    choose('欄位amount 在關卡 1的設定', 'HIDE');
    choose('欄位amount 在關卡 1的設定', 'DEFAULT');
    click('套用');

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not touch the definition before 套用, then sends the whole matrix once', () => {
    const definition = definitionOf([
      userTask('manager', [
        { display: 'HIDE', fieldKey: 'amount', fill: 'NONE' },
        { display: 'SHOW', fieldKey: 'gone', fill: 'NONE' },
      ]),
      userTask('finance'),
    ]);
    const before = JSON.stringify(definition);

    render(definition);
    choose('欄位amount 在關卡 2的設定', 'FILL_OPTIONAL');

    expect(JSON.stringify(definition)).toBe(before);
    expect(onApply).not.toHaveBeenCalled();

    click('套用');

    // The collapsed rows and the entry for a field the form no longer has are
    // carried over: the command overwrites every node.
    expect(onApply).toHaveBeenCalledWith([
      { display: 'HIDE', fieldKey: 'amount', fill: 'NONE', nodeId: 'manager' },
      { display: 'SHOW', fieldKey: 'gone', fill: 'NONE', nodeId: 'manager' },
      {
        display: 'SHOW',
        fieldKey: 'amount',
        fill: 'OPTIONAL',
        nodeId: 'finance',
      },
    ]);
  });

  it('clears a blank field key on 套用 instead of being refused for it', () => {
    render(
      definitionOf([
        userTask('manager', [
          { display: 'HIDE', fieldKey: '  ', fill: 'NONE' },
        ]),
        userTask('finance'),
      ]),
    );
    showAllFields();
    choose('欄位amount 在關卡 2的設定', 'HIDE');
    click('套用');

    expect(onApply).toHaveBeenCalledWith([
      { display: 'HIDE', fieldKey: 'amount', fill: 'NONE', nodeId: 'finance' },
    ]);
  });

  it('rewrites a stored entry the reader repairs even with nothing edited', () => {
    render(
      definitionOf([
        userTask('manager', [
          {
            display: 'SHOW',
            fieldKey: 'note',
            fill: 'ALWAYS',
          } as unknown as FieldAccessEntry,
        ]),
        userTask('finance'),
      ]),
    );
    click('套用');

    expect(onApply).toHaveBeenCalledWith([
      { display: 'SHOW', fieldKey: 'note', fill: 'NONE', nodeId: 'manager' },
    ]);
  });

  it('stays open on its draft and shows why when 套用 is refused', () => {
    onApply.mockReturnValue('節點 finance 不是簽核節點。');
    render(definitionOf([userTask('manager'), userTask('finance')]));
    showAllFields();
    choose('欄位amount 在關卡 1的設定', 'HIDE');
    click('套用');

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[data-severity="error"]')).not.toBeNull();
    expect(
      container.querySelector('[data-variant="dot-error"]')?.textContent,
    ).toBe('節點 finance 不是簽核節點。');
    expect(select('欄位amount 在關卡 1的設定').value).toBe('HIDE');

    choose('欄位amount 在關卡 1的設定', 'SHOW');

    expect(container.querySelector('[data-variant="dot-error"]')).toBeNull();
  });

  it('keeps a change made to the flow while it was open', () => {
    render(definitionOf([userTask('manager'), userTask('finance')]));
    showAllFields();
    choose('欄位amount 在關卡 1的設定', 'HIDE');
    // e.g. the assistant sets another cell behind the open drawer
    render(
      definitionOf([
        userTask('manager'),
        userTask('finance', [
          { display: 'SHOW', fieldKey: 'note', fill: 'OPTIONAL' },
        ]),
      ]),
    );
    click('套用');

    expect(onApply).toHaveBeenCalledWith([
      {
        display: 'SHOW',
        fieldKey: 'note',
        fill: 'OPTIONAL',
        nodeId: 'finance',
      },
      { display: 'HIDE', fieldKey: 'amount', fill: 'NONE', nodeId: 'manager' },
    ]);
  });

  it('applies nothing on 取消', () => {
    render(definitionOf([userTask('manager'), userTask('finance')]));
    showAllFields();
    choose('欄位amount 在關卡 1的設定', 'HIDE');
    click('取消');

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves out the fill choices a boolean or a group decision cannot take', () => {
    render(
      definitionOf([
        userTask('manager', [], {
          decisionPolicy: { quorum: 2, type: 'QUORUM' },
        }),
        userTask('finance'),
      ]),
    );
    showAllFields();

    const options = (label: string): readonly string[] =>
      [...select(label).options].map((option) => option.value);

    expect(options('欄位flag 在關卡 2的設定')).toEqual([
      'DEFAULT',
      'SHOW',
      'HIDE',
      'FILL_OPTIONAL',
    ]);
    expect(options('欄位note 在關卡 1的設定')).toEqual([
      'DEFAULT',
      'SHOW',
      'HIDE',
    ]);
  });

  it('keeps a disabled choice an old draft already holds', () => {
    render(
      definitionOf([
        userTask('manager'),
        userTask('finance', [
          { display: 'SHOW', fieldKey: 'flag', fill: 'REQUIRED' },
        ]),
      ]),
    );

    expect(select('欄位flag 在關卡 2的設定').value).toBe('FILL_REQUIRED');
    expect(
      container.querySelector('[data-row="flag"] [data-variant="dot-warning"]'),
    ).not.toBeNull();
  });

  it('flags two chained fill nodes as blocking, in designer copy', () => {
    render(
      definitionOf([
        userTask('manager', [
          { display: 'SHOW', fieldKey: 'note', fill: 'OPTIONAL' },
        ]),
        userTask('finance', [
          { display: 'SHOW', fieldKey: 'note', fill: 'REQUIRED' },
        ]),
      ]),
    );

    const warnings = [
      ...container.querySelectorAll(
        '[data-row="note"] [data-variant="dot-warning"]',
      ),
    ].map((badge) => badge.textContent ?? '');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('workflow.nodes.');
    expect(warnings[0]).toContain('主管');
    expect(
      container.querySelector('[data-severity="warning"]')?.textContent,
    ).toContain('1 個欄位設定問題');
  });

  it('translates a conflict only the draft raises', () => {
    render(
      definitionOf([
        userTask('manager'),
        userTask('finance', [
          { display: 'SHOW', fieldKey: 'note', fill: 'REQUIRED' },
        ]),
      ]),
    );
    choose('欄位note 在關卡 1的設定', 'FILL_OPTIONAL');

    const warning =
      container.querySelector('[data-row="note"] [data-variant="dot-warning"]')
        ?.textContent ?? '';

    expect(warning).not.toContain('workflow.nodes.');
    expect(warning).toContain('主管');
  });

  it('marks a clean row and explains the semantics when nothing blocks', () => {
    render(
      definitionOf([
        userTask('manager', [
          { display: 'HIDE', fieldKey: 'amount', fill: 'NONE' },
        ]),
        userTask('finance'),
      ]),
    );

    expect(
      container
        .querySelector('[data-row="amount"] [data-variant]')
        ?.getAttribute('data-variant'),
    ).toBe('dot-success');
    expect(container.textContent).toContain('不是權限');
  });

  it('collapses untouched rows and keeps a row the user edited back to default', () => {
    render(
      definitionOf([
        userTask('manager', [
          { display: 'HIDE', fieldKey: 'amount', fill: 'NONE' },
        ]),
        userTask('finance'),
      ]),
    );

    expect(rowKeys()).toEqual(['amount']);
    expect(container.textContent).toContain('已收起 2 個');

    choose('欄位amount 在關卡 1的設定', 'DEFAULT');
    expect(rowKeys()).toEqual(['amount']);

    toggleFilter();
    expect(rowKeys()).toEqual(['amount', 'note', 'flag']);
  });

  it('opens on every field while nothing is set yet', () => {
    render(definitionOf([userTask('manager'), userTask('finance')]));

    expect(rowKeys()).toEqual(['amount', 'note', 'flag']);
    expect(container.textContent).not.toContain('已收起');

    toggleFilter();
    expect(rowKeys()).toEqual([]);
  });
});

describe('updateFieldAccessDraft', () => {
  const entries: readonly FieldAccessMatrixEntry[] = [
    { display: 'HIDE', fieldKey: 'a', fill: 'NONE', nodeId: 'n1' },
    { display: 'HIDE', fieldKey: 'b', fill: 'NONE', nodeId: 'n1' },
  ];

  it('replaces an entry where it stands', () =>
    expect(updateFieldAccessDraft(entries, 'n1', 'a', 'SHOW')).toEqual([
      { display: 'SHOW', fieldKey: 'a', fill: 'NONE', nodeId: 'n1' },
      entries[1],
    ]));

  it('drops the entry on default and appends a new one', () => {
    expect(updateFieldAccessDraft(entries, 'n1', 'a', 'DEFAULT')).toEqual([
      entries[1],
    ]);
    expect(
      updateFieldAccessDraft(entries, 'n2', 'a', 'FILL_REQUIRED').at(-1),
    ).toEqual({
      display: 'SHOW',
      fieldKey: 'a',
      fill: 'REQUIRED',
      nodeId: 'n2',
    });
  });
});

describe('rebaseFieldAccessDraft', () => {
  const hide = (nodeId: string, fieldKey: string): FieldAccessMatrixEntry => ({
    display: 'HIDE',
    fieldKey,
    fill: 'NONE',
    nodeId,
  });

  it('lays only the edited cells onto the current entries', () => {
    const initial = [hide('n1', 'a'), hide('n1', 'b')];
    const draft = [hide('n1', 'b'), hide('n2', 'c')];
    const current = [hide('n1', 'a'), hide('n1', 'b'), hide('n2', 'z')];

    expect(
      rebaseFieldAccessDraft(current, initial, draft, new Set(['n1', 'n2'])),
    ).toEqual([hide('n1', 'b'), hide('n2', 'z'), hide('n2', 'c')]);
  });

  it('drops entries of a node that is no longer a user task', () => {
    expect(
      rebaseFieldAccessDraft([], [], [hide('n2', 'c')], new Set(['n1'])),
    ).toEqual([]);
  });
});

describe('FieldAccessNodeSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  function render(node: UserTaskNode, onRemoveLegacy = jest.fn()): void {
    act((): void => {
      root.render(
        <FieldAccessNodeSection
          definition={definitionOf([node])}
          language="zh-TW"
          node={node}
          onOpenMatrix={jest.fn()}
          onRemoveLegacy={onRemoveLegacy}
          openDisabledReason={null}
        />,
      );
    });
  }

  it('summarises the node and warns about a fill conflict in designer copy', () => {
    render(
      userTask(
        'manager',
        [
          { display: 'SHOW', fieldKey: 'a', fill: 'REQUIRED' },
          { display: 'SHOW', fieldKey: 'b', fill: 'OPTIONAL' },
          { display: 'HIDE', fieldKey: 'c', fill: 'NONE' },
        ],
        { sla: { duration: 'P1D', onTimeout: 'AUTO_APPROVE' } },
      ),
    );

    expect(container.textContent).toContain('本關補填 2 個（必填 1）');
    expect(container.textContent).toContain('本關隱藏 1 個');

    const warning = container.querySelector('[data-variant="dot-warning"]');

    expect(warning?.textContent).not.toContain('workflow.nodes.');
    expect(warning?.textContent).toContain('主管');
  });

  it('offers to remove the legacy key', () => {
    const onRemoveLegacy = jest.fn();

    render(userTask('manager', [], { fieldPermissions: [] }), onRemoveLegacy);

    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === '移除舊設定',
    );

    act((): void => button?.click());

    expect(onRemoveLegacy).toHaveBeenCalledTimes(1);
  });
});
