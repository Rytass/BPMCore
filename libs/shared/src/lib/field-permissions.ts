import type {
  FieldPermission,
  UserTaskNode,
  WorkflowDefinition,
} from './workflow';

export interface FieldAccess {
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
 * Reads `fieldPermissions` off a user task without trusting its shape: saved
 * drafts can hold anything, and no caller may throw because of one. A value
 * that is not an array reads as `[]`; an entry that is not an object or has no
 * non-empty `fieldPath` string is skipped; the first entry for a `fieldPath`
 * wins, so every reader agrees on which one counts.
 */
export const readNodeFieldPermissions = (
  node: UserTaskNode,
): readonly FieldPermission[] => {
  const raw: unknown = node.data.fieldPermissions;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<readonly FieldPermission[]>((collected, entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry['fieldPath'] !== 'string' ||
      entry['fieldPath'] === '' ||
      collected.some((existing) => existing.fieldPath === entry['fieldPath'])
    ) {
      return collected;
    }

    return [
      ...collected,
      {
        editable: entry['editable'] === true,
        fieldPath: entry['fieldPath'],
        required: entry['required'] === true,
        visible: entry['visible'] !== false,
      },
    ];
  }, []);
};

/**
 * The top-level form field a field path addresses: `items.price` and
 * `items[0]` both address `items`. Only top-level fields carry permissions.
 */
export const readTopLevelFieldKey = (fieldPath: string): string =>
  fieldPath.split('.')[0].split('[')[0];

export const readNodeEditableFieldKeys = (
  node: UserTaskNode,
): ReadonlySet<string> =>
  new Set(
    readNodeFieldPermissions(node)
      .filter((permission) => permission.editable)
      .map((permission) => permission.fieldPath),
  );

export const readNodeRequiredFieldKeys = (
  node: UserTaskNode,
): ReadonlySet<string> =>
  new Set(
    readNodeFieldPermissions(node)
      .filter((permission) => permission.editable && permission.required)
      .map((permission) => permission.fieldPath),
  );

/** Every field some user task lets its approver fill in. */
export const readApproverFilledFieldKeys = (
  definition: WorkflowDefinition,
): ReadonlySet<string> =>
  new Set(
    definition.nodes
      .filter(isUserTaskNode)
      .flatMap((node) => [...readNodeEditableFieldKeys(node)]),
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

      return node === undefined ? [] : [...readNodeEditableFieldKeys(node)];
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
}): Readonly<Record<string, FieldAccess>> => {
  const node =
    input.nodeId === null
      ? undefined
      : findUserTaskNode(input.definition, input.nodeId);
  const listed = new Map(
    (node === undefined ? [] : readNodeFieldPermissions(node)).map(
      (permission) => [permission.fieldPath, permission] as const,
    ),
  );
  const approverFilled = readApproverFilledFieldKeys(input.definition);

  return Object.fromEntries(
    input.fieldKeys.map((fieldKey): readonly [string, FieldAccess] => {
      const permission = listed.get(fieldKey);

      if (permission !== undefined) {
        return [
          fieldKey,
          {
            editable: input.isAdhocTask ? false : permission.editable,
            visible: permission.visible,
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
