import { Args, Query, Resolver } from '@nestjs/graphql';
import { FormDefinitionEntity } from './form-definition.entity';
import { FormDefinitionVersionEntity } from './form-definition-version.entity';
import { FormService } from './form.service';
import { LintFormSchemaInput } from './dto/form-definition.input';
import { FormSchemaLintResultObject } from './form-schema-lint.object';

@Resolver()
export class FormQueries {
  constructor(private readonly formService: FormService) {}

  @Query(() => [FormDefinitionEntity])
  async formDefinitions(): Promise<readonly FormDefinitionEntity[]> {
    return this.formService.listFormDefinitions();
  }

  @Query(() => FormDefinitionEntity)
  async formDefinition(
    @Args('id', { type: () => String }) id: string,
  ): Promise<FormDefinitionEntity> {
    return this.formService.getFormDefinition(id);
  }

  @Query(() => [FormDefinitionVersionEntity])
  async formDefinitionVersions(
    @Args('formDefinitionId', { type: () => String }) formDefinitionId: string,
  ): Promise<readonly FormDefinitionVersionEntity[]> {
    return this.formService.listFormDefinitionVersions(formDefinitionId);
  }

  @Query(() => FormDefinitionVersionEntity)
  async formDefinitionVersion(
    @Args('id', { type: () => String }) id: string,
  ): Promise<FormDefinitionVersionEntity> {
    return this.formService.getFormDefinitionVersion(id);
  }

  @Query(() => FormSchemaLintResultObject)
  lintFormSchema(
    @Args('input') input: LintFormSchemaInput,
  ): FormSchemaLintResultObject {
    return this.formService.lintFormSchema(input);
  }
}
