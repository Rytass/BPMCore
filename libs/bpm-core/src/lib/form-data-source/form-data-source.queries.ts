import { Args, Field, InputType, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { IsOptional, IsString } from 'class-validator';
import {
  BPMAuthContext,
  BPMAuthenticated,
  BPMCurrentAuthContext,
  BPMDesignerOnly,
} from '../bpm-auth';
import { FormFieldOption } from '@rytass/bpm-core-shared/form';
import {
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceOptionResult,
} from './form-data-source.types';
import {
  FormDataSourceService,
} from './form-data-source.service';

@ObjectType('BPMFormDataSourceParameter')
export class FormDataSourceParameterObject {
  @Field()
  key!: string;

  @Field(() => String, { nullable: true })
  label!: string | null;

  @Field()
  required!: boolean;

  @Field()
  type!: string;
}

@ObjectType('BPMFormDataSourceDescriptor')
export class FormDataSourceDescriptorObject {
  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => Int)
  version!: number;

  @Field(() => Int)
  maximumResultCount!: number;

  @Field(() => Int)
  minimumSearchLength!: number;

  @Field(() => Int)
  pageSize!: number;

  @Field()
  paginationMode!: string;

  @Field(() => [FormDataSourceParameterObject])
  parameters!: readonly FormDataSourceParameterObject[];

  @Field()
  revalidationPolicy!: string;

  @Field()
  returnsCompleteList!: boolean;

  @Field(() => [String])
  supportedControls!: readonly string[];

  @Field()
  supportsSearch!: boolean;
}

@ObjectType('BPMFormFieldOption')
export class FormFieldOptionObject implements FormFieldOption {
  @Field()
  label!: string;

  @Field()
  value!: string;
}

@ObjectType('BPMFormDataSourceOptionsResult')
export class FormDataSourceOptionsResultObject {
  @Field()
  dataSourceKey!: string;

  @Field(() => Int)
  dataSourceVersion!: number;

  @Field(() => String, { nullable: true })
  nextCursor!: string | null;

  @Field(() => [FormFieldOptionObject])
  options!: readonly FormFieldOptionObject[];
}

@InputType('BPMPreviewFormFieldOptionsInput')
export class PreviewFormFieldOptionsInput {
  @Field()
  @IsString()
  schemaJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  uiSchemaJson!: string | null;

  @Field()
  @IsString()
  fieldKey!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  formDataJson!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  searchText!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  cursor!: string | null;
}

@InputType('BPMRuntimeFormFieldOptionsInput')
export class RuntimeFormFieldOptionsInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  templateId!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  instanceId!: string | null;

  @Field()
  @IsString()
  fieldKey!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  formDataJson!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  searchText!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  cursor!: string | null;
}

@Resolver()
export class FormDataSourceQueries {
  constructor(private readonly formDataSourceService: FormDataSourceService) {}

  @Query(() => [FormDataSourceDescriptorObject])
  @BPMDesignerOnly()
  formDataSources(): readonly FormDataSourceDescriptorObject[] {
    return this.formDataSourceService
      .listDescriptors()
      .map(toDescriptorObject);
  }

  @Query(() => FormDataSourceOptionsResultObject)
  @BPMDesignerOnly()
  previewFormFieldOptions(
    @Args('input') input: PreviewFormFieldOptionsInput,
    @BPMCurrentAuthContext() authContext: BPMAuthContext,
  ): Promise<FormDataSourceOptionsResultObject> {
    return this.formDataSourceService
      .previewFormFieldOptions(input, authContext)
      .then(toOptionsResultObject);
  }

  @Query(() => FormDataSourceOptionsResultObject)
  @BPMAuthenticated()
  formFieldOptions(
    @Args('input') input: RuntimeFormFieldOptionsInput,
    @BPMCurrentAuthContext() authContext: BPMAuthContext,
  ): Promise<FormDataSourceOptionsResultObject> {
    return this.formDataSourceService
      .formFieldOptions(input, authContext)
      .then(toOptionsResultObject);
  }
}

function toDescriptorObject(
  descriptor: BPMFormDataSourceDescriptor,
): FormDataSourceDescriptorObject {
  const result = new FormDataSourceDescriptorObject();
  result.description = descriptor.description ?? null;
  result.key = descriptor.key;
  result.label = descriptor.label;
  result.maximumResultCount = descriptor.maximumResultCount;
  result.minimumSearchLength = descriptor.minimumSearchLength;
  result.pageSize = descriptor.pageSize;
  result.paginationMode = descriptor.paginationMode;
  result.parameters = descriptor.parameters.map((parameter) => {
    const parameterObject = new FormDataSourceParameterObject();
    parameterObject.key = parameter.key;
    parameterObject.label = parameter.label ?? null;
    parameterObject.required = parameter.required;
    parameterObject.type = parameter.type;
    return parameterObject;
  });
  result.revalidationPolicy = descriptor.revalidationPolicy;
  result.returnsCompleteList = descriptor.returnsCompleteList;
  result.supportedControls = [...descriptor.supportedControls];
  result.supportsSearch = descriptor.supportsSearch;
  result.version = descriptor.version;

  return result;
}

function toOptionsResultObject(
  result: BPMFormDataSourceOptionResult,
): FormDataSourceOptionsResultObject {
  const output = new FormDataSourceOptionsResultObject();
  output.dataSourceKey = result.dataSourceKey;
  output.dataSourceVersion = result.dataSourceVersion;
  output.nextCursor = result.nextCursor;
  output.options = result.options.map((option) => {
    const optionObject = new FormFieldOptionObject();
    optionObject.label = option.label;
    optionObject.value = option.value;
    return optionObject;
  });

  return output;
}
