import type {
  FieldAccessEntry,
  UserTaskNode,
  WorkflowDefinition,
} from './workflow';

/** What a viewer may do with one top-level form field (`resolveFieldAccess`). */
export interface ResolvedFieldAccess {
  readonly editable: boolean;
  readonly visible: boolean;
}

const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUserTaskNode = (node: {
  readonly type: string;
}): node is UserTaskNode => node.type === 'userTask';

const findUserTaskNode = (
  definition: WorkflowDefinition,
  nodeId: string,
): UserTaskNode | undefined =>
  definition.nodes.find(
    (node): node is UserTaskNode => isUserTaskNode(node) && node.id === nodeId,
  );

/**
 * Reads `fieldAccess` off a user task without trusting its shape: saved drafts
 * can hold anything, and no caller may throw because of one. A value that is
 * not an array reads as `[]`; an entry that is not an object or has no
 * non-empty `fieldKey` string is skipped; the first entry for a `fieldKey`
 * wins, so every reader agrees on which one counts. An unknown `fill` reads as
 * `NONE`, so a malformed entry never lets anyone write, and an unknown
 * `display` reads as `SHOW`. The deprecated `fieldPermissions` is never read.
 */
export const readNodeFieldAccess = (
  node: UserTaskNode,
): readonly FieldAccessEntry[] => {
  const raw: unknown = node.data.fieldAccess;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<readonly FieldAccessEntry[]>(
    (collected, entry: unknown) => {
      if (
        !isRecord(entry) ||
        typeof entry['fieldKey'] !== 'string' ||
        entry['fieldKey'] === '' ||
        collected.some((existing) => existing.fieldKey === entry['fieldKey'])
      ) {
        return collected;
      }

      const fill = entry['fill'];

      return [
        ...collected,
        {
          display: entry['display'] === 'HIDE' ? 'HIDE' : 'SHOW',
          fieldKey: entry['fieldKey'],
          fill: fill === 'OPTIONAL' || fill === 'REQUIRED' ? fill : 'NONE',
        },
      ];
    },
    [],
  );
};

/**
 * The top-level form field a field path addresses: `items.price` and
 * `items[0]` both address `items`.
 */
export const readTopLevelFieldKey = (fieldPath: string): string =>
  fieldPath.split('.')[0].split('[')[0];

/**
 * The top-level form field a `SET_FORM_FIELD` `fieldPath` writes. The engine
 * accepts an optional leading `form.` or `formData.` segment and trims each
 * segment, so `form.amount` and ` amount ` both write `amount`.
 */
export const readFormFieldPathTopLevelKey = (fieldPath: string): string => {
  const segments = fieldPath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const fieldSegments =
    segments[0] === 'form' || segments[0] === 'formData'
      ? segments.slice(1)
      : segments;

  return readTopLevelFieldKey(fieldSegments.join('.'));
};

export const readNodeFillableFieldKeys = (
  node: UserTaskNode,
): ReadonlySet<string> =>
  new Set(
    readNodeFieldAccess(node)
      .filter((entry) => entry.fill !== 'NONE')
      .map((entry) => entry.fieldKey),
  );

export const readNodeRequiredFieldKeys = (
  node: UserTaskNode,
): ReadonlySet<string> =>
  new Set(
    readNodeFieldAccess(node)
      .filter((entry) => entry.fill === 'REQUIRED')
      .map((entry) => entry.fieldKey),
  );

/** Every field some user task lets its approver fill in. */
export const readApproverFilledFieldKeys = (
  definition: WorkflowDefinition,
): ReadonlySet<string> =>
  new Set(
    definition.nodes
      .filter(isUserTaskNode)
      .flatMap((node) => [...readNodeFillableFieldKeys(node)]),
  );

/**
 * The approver-filled fields that have been revealed to the applicant: those a
 * user task that already produced a non-ad-hoc task lets its approver fill in.
 * Ids that are missing or point to a non-user task are skipped.
 */
export const readRevealedFieldKeys = (
  definition: WorkflowDefinition,
  nodeIdsWithNonAdhocTask: Iterable<string>,
): ReadonlySet<string> =>
  new Set(
    [...new Set(nodeIdsWithNonAdhocTask)].flatMap((nodeId) => {
      const node = findUserTaskNode(definition, nodeId);

      return node === undefined ? [] : [...readNodeFillableFieldKeys(node)];
    }),
  );

/**
 * Resolves what a viewer may see and edit per top-level form field. Rules, the
 * first match wins:
 *
 * 1. a non-ad-hoc task at a user task that lists the field: as configured;
 * 2. an ad-hoc task at a user task that lists the field: the configured
 *    visibility, never editable;
 * 3. a field some user task fills in: read-only once revealed, hidden before;
 * 4. any other field: visible, read-only.
 */
export const resolveFieldAccess = (input: {
  readonly definition: WorkflowDefinition;
  readonly fieldKeys: readonly string[];
  readonly isAdhocTask: boolean;
  readonly nodeId: string | null;
  readonly revealedFieldKeys: ReadonlySet<string>;
}): Readonly<Record<string, ResolvedFieldAccess>> => {
  const node =
    input.nodeId === null
      ? undefined
      : findUserTaskNode(input.definition, input.nodeId);
  const listed = new Map(
    (node === undefined ? [] : readNodeFieldAccess(node)).map(
      (entry) => [entry.fieldKey, entry] as const,
    ),
  );
  const approverFilled = readApproverFilledFieldKeys(input.definition);

  return Object.fromEntries(
    input.fieldKeys.map((fieldKey): readonly [string, ResolvedFieldAccess] => {
      const entry = listed.get(fieldKey);

      if (entry !== undefined) {
        return [
          fieldKey,
          {
            editable: !input.isAdhocTask && entry.fill !== 'NONE',
            visible: entry.display === 'SHOW',
          },
        ];
      }

      if (approverFilled.has(fieldKey)) {
        return [
          fieldKey,
          { editable: false, visible: input.revealedFieldKeys.has(fieldKey) },
        ];
      }

      return [fieldKey, { editable: false, visible: true }];
    }),
  );
};

export const omitFormDataKeys = (
  formData: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(formData).filter(([key]) => !keys.has(key)),
  );

/**
 * For each key: the stored value when `stored` has it as an own property,
 * otherwise the key is left out of the result entirely (a submitted value for
 * it is dropped, never trusted).
 */
export const overlayStoredFormDataKeys = (
  submitted: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> => ({
  ...omitFormDataKeys(submitted, keys),
  ...Object.fromEntries(
    [...keys]
      .filter((key) => hasOwn(stored, key))
      .map((key): readonly [string, unknown] => [key, stored[key]]),
  ),
});

/** `undefined`, `null`, a blank string and an empty array are empty. */
export const isFormDataValueEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);
