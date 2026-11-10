import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';
import { describeFilterableFieldIssue } from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { EntityManager, Repository } from 'typeorm';
import { BPMDesignerOnly } from '../bpm-auth';
import { ApprovalTemplateEntity } from './approval-template.entity';
import {
  FilterableFieldIssueKind,
  FilterableFieldIssueObject,
} from './filterable-field-issue.object';
import {
  FilterableFieldIssueReport,
  readFilterableFieldSchemaFromJson,
  readFormDefinitionFilterableFieldIssues,
  readTemplateFilterableFieldIssues,
} from './filterable-field-guard';

/**
 * Read-only check for the designer: does the schema in the editor conflict
 * with what a template already stored? It blocks nothing. The publish itself
 * is refused by `TemplateService` (ADR 25 §5.4).
 *
 * Designer-only, not merely authenticated: the answer names templates and
 * instance ids, which a plain member has no business reading.
 */
@Resolver()
@BPMDesignerOnly()
export class FilterableFieldQueries {
  constructor(
    @InjectRepository(ApprovalTemplateEntity)
    private readonly templateRepository: Repository<ApprovalTemplateEntity>,
  ) {}

  /**
   * Both ids given: only that template. Only `formDefinitionId`: every
   * template on that form definition. Neither: nothing to check.
   */
  @Query(() => [FilterableFieldIssueObject])
  async filterableFieldIssues(
    @Args('templateId', { nullable: true, type: () => ID })
    templateId: string | null | undefined,
    @Args('formDefinitionId', { nullable: true, type: () => ID })
    formDefinitionId: string | null | undefined,
    @Args('schemaJson', { type: () => String }) schemaJson: string,
  ): Promise<readonly FilterableFieldIssueObject[]> {
    const schema = readFilterableFieldSchemaFromJson(schemaJson);
    const manager = this.templateRepository.manager;

    const reports = await readIssueReports(
      manager,
      templateId ?? null,
      formDefinitionId ?? null,
      schema,
    );

    return reports.map(toFilterableFieldIssueObject);
  }
}

async function readIssueReports(
  manager: EntityManager,
  templateId: string | null,
  formDefinitionId: string | null,
  schema: FormDefinitionSchema,
): Promise<readonly FilterableFieldIssueReport[]> {
  if (templateId) {
    return readTemplateFilterableFieldIssues(manager, templateId, schema);
  }

  if (formDefinitionId) {
    return readFormDefinitionFilterableFieldIssues(
      manager,
      formDefinitionId,
      schema,
    );
  }

  return [];
}

function toFilterableFieldIssueObject(
  report: FilterableFieldIssueReport,
): FilterableFieldIssueObject {
  const { issue } = report;

  return Object.assign(new FilterableFieldIssueObject(), {
    conflictVersionNumbers:
      issue.kind === 'TYPE_CHANGED'
        ? issue.conflicts.map((conflict) => conflict.versionNumber)
        : [],
    fieldType: issue.type,
    invalidInstanceCount:
      issue.kind === 'INVALID_VALUES' ? issue.invalidInstanceCount : 0,
    kind: FilterableFieldIssueKind[issue.kind],
    label: issue.label,
    message: describeFilterableFieldIssue(issue),
    path: issue.path,
    sampleInstanceIds:
      issue.kind === 'INVALID_VALUES'
        ? [...new Set(issue.samples.map((sample) => sample.instanceId))]
        : [],
    templateId: report.templateId,
    templateName: report.templateName,
  });
}
