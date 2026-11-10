import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  describeFilterableFieldIssue,
  FilterableFieldIssue,
  readFilterableFieldIssues,
  readFilterableFieldPaths,
} from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { EntityManager } from 'typeorm';

/**
 * The enable check of ADR 25 §5.4, run against the database: which filterable
 * fields of a schema may not take effect for a template (or for every template
 * that shares a form definition), given the instances already stored.
 *
 * Every function takes the `EntityManager` it should read through, so a publish
 * inside a transaction sees the same snapshot as the rest of that transaction.
 * Only the filterable paths are read from `form_data`: nothing else is loaded.
 */

export interface FilterableFieldIssueReport {
  readonly templateId: string;
  readonly templateName: string;
  readonly issue: FilterableFieldIssue;
}

interface HistoryFormVersionRow {
  readonly versionNumber: number | string;
  readonly schema: FormDefinitionSchema | null;
}

interface InstanceFormDataRow {
  readonly id: string;
  readonly form_data: Readonly<Record<string, unknown>> | null;
}

interface TemplateNameRow {
  readonly name: string;
}

interface FormDefinitionTemplateRow {
  readonly templateId: string;
}

/**
 * Issues that block a template from using `schema`. Empty when the schema has
 * no filterable field, which skips every query.
 */
export async function readTemplateFilterableFieldIssues(
  manager: EntityManager,
  templateId: string,
  schema: FormDefinitionSchema | null | undefined,
): Promise<readonly FilterableFieldIssueReport[]> {
  const paths = readFilterableFieldPaths(schema);

  if (paths.length === 0) {
    return [];
  }

  const history = await readHistoryFormVersions(manager, templateId);
  const instances = await readInstanceFilterableValues(
    manager,
    templateId,
    paths.map((item) => item.tableKey ?? item.key),
  );
  const issues = readFilterableFieldIssues({
    history: history.map((row) => ({
      schema: row.schema,
      versionNumber: Number(row.versionNumber),
    })),
    instances,
    schema,
  });

  if (issues.length === 0) {
    return [];
  }

  const templateName = await readTemplateName(manager, templateId);

  return issues.map((issue) => ({ issue, templateId, templateName }));
}

/** Throws a conflict that lists every blocking issue, one per line. */
export async function assertTemplateFilterableFieldsEnabled(
  manager: EntityManager,
  templateId: string,
  schema: FormDefinitionSchema | null | undefined,
): Promise<void> {
  const reports = await readTemplateFilterableFieldIssues(
    manager,
    templateId,
    schema,
  );

  if (reports.length > 0) {
    throw new ConflictException(
      reports.map((report) => describeFilterableFieldIssue(report.issue)).join('\n'),
    );
  }
}

/**
 * The designer's view: every template that has instances on a version bound
 * to `formDefinitionId`, checked against `schema`. A form definition can be
 * shared by several templates, so one edit may touch more than one.
 */
export async function readFormDefinitionFilterableFieldIssues(
  manager: EntityManager,
  formDefinitionId: string,
  schema: FormDefinitionSchema | null | undefined,
): Promise<readonly FilterableFieldIssueReport[]> {
  if (readFilterableFieldPaths(schema).length === 0) {
    return [];
  }

  const rows: readonly FormDefinitionTemplateRow[] = await manager.query(
    `SELECT DISTINCT tv.template_id AS "templateId"
       FROM approval_template_versions tv
       JOIN form_definition_versions fv ON fv.id = tv.form_definition_version_id
       JOIN approval_templates t ON t.id = tv.template_id AND t.deleted_at IS NULL
      WHERE fv.form_definition_id = $1
        AND EXISTS (
          SELECT 1 FROM approval_instances i WHERE i.template_version_id = tv.id
        )`,
    [formDefinitionId],
  );
  const reports = await Promise.all(
    rows.map((row) =>
      readTemplateFilterableFieldIssues(manager, row.templateId, schema),
    ),
  );

  return reports.flat();
}

/**
 * Parses the `schemaJson` argument of the designer query. A value that is not
 * a JSON object is a bad request, not an empty schema.
 */
export function readFilterableFieldSchemaFromJson(
  schemaJson: string,
): FormDefinitionSchema {
  let parsed: unknown;

  try {
    parsed = JSON.parse(schemaJson) as unknown;
  } catch (error: unknown) {
    throw new BadRequestException(
      `schemaJson is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException('schemaJson must be an object');
  }

  return parsed as FormDefinitionSchema;
}

/**
 * The form versions that the template's instances were created under, each
 * once. A type conflict is judged against these, not against every version
 * that was ever drafted.
 */
async function readHistoryFormVersions(
  manager: EntityManager,
  templateId: string,
): Promise<readonly HistoryFormVersionRow[]> {
  const rows: readonly HistoryFormVersionRow[] = await manager.query(
    `SELECT DISTINCT fv.id, fv.version AS "versionNumber", fv.schema
       FROM approval_template_versions tv
       JOIN form_definition_versions fv ON fv.id = tv.form_definition_version_id
      WHERE tv.template_id = $1
        AND EXISTS (
          SELECT 1 FROM approval_instances i WHERE i.template_version_id = tv.id
        )`,
    [templateId],
  );

  return rows;
}

/**
 * The stored value of each filterable key, for every instance of the template.
 * The key list is a bound parameter, and a key the instance does not have is
 * left out of its object, which the checks read as "no value".
 */
async function readInstanceFilterableValues(
  manager: EntityManager,
  templateId: string,
  keys: readonly string[],
): Promise<readonly { readonly id: string; readonly formData: Readonly<Record<string, unknown>> | null }[]> {
  const uniqueKeys = [...new Set(keys)];
  const rows: readonly InstanceFormDataRow[] = await manager.query(
    `SELECT i.id,
            (SELECT jsonb_object_agg(k, i.form_data -> k)
               FROM unnest($2::text[]) AS k
              WHERE i.form_data ? k) AS form_data
       FROM approval_instances i
      WHERE i.template_id = $1`,
    [templateId, uniqueKeys],
  );

  return rows.map((row) => ({ formData: row.form_data, id: row.id }));
}

async function readTemplateName(
  manager: EntityManager,
  templateId: string,
): Promise<string> {
  const rows: readonly TemplateNameRow[] = await manager.query(
    `SELECT name FROM approval_templates WHERE id = $1`,
    [templateId],
  );

  return rows[0]?.name ?? '';
}
