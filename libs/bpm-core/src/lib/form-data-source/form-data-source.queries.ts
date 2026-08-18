import { Args, Field, InputType, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  BPMAuthContext,
  BPMAuthenticated,
  BPMCurrentAuthContext,
  BPMDesignerOnly,
} from '../bpm-auth';
import { FormFieldOption } from '@rytass/bpm-core-shared/form';
import { BPM_FORM_DATA_SOURCE_ERROR_CODES } from './form-data-source.errors';
import {
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceOptionResult,
  BPMFormDataSourceResolveResult,
} from './form-data-source.types';
import {
  FormDataSourceService,
} from './form-data-source.service';

/**
 * ADR §3.12 requires a bound on every input the browser controls. The message
 * is the same stable code an oversized binding raises, so an over-long input
 * never reaches the client as a class-validator sentence describing our limits.
 */
const OVERSIZED_INPUT_MESSAGE =
  BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING;

const MAX_CURSOR_LENGTH = 512;
const MAX_FIELD_KEY_LENGTH = 256;
const MAX_FORM_DATA_JSON_LENGTH = 65_536;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_SCHEMA_JSON_LENGTH = 262_144;
const MAX_SEARCH_TEXT_LENGTH = 200;
const MAX_VALUES_JSON_LENGTH = 8_192;

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

  @Field(() => [String])
  waitingForFieldKeys!: readonly string[];
}

@ObjectType('BPMFormDataSourceResolveResult')
export class FormDataSourceResolveResultObject {
  @Field()
  dataSourceKey!: string;

  @Field(() => Int)
  dataSourceVersion!: number;

  @Field(() => [FormFieldOptionObject])
  options!: readonly FormFieldOptionObject[];

  @Field(() => [String])
  unresolvedValues!: readonly string[];

  @Field(() => [String])
  waitingForFieldKeys!: readonly string[];
}

@InputType('BPMPreviewFormFieldOptionsInput')
export class PreviewFormFieldOptionsInput {
  @Field()
  @IsString()
  @MaxLength(MAX_SCHEMA_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  schemaJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SCHEMA_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  uiSchemaJson!: string | null;

  @Field()
  @IsString()
  @MaxLength(MAX_FIELD_KEY_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  fieldKey!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FORM_DATA_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  formDataJson!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_TEXT_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  searchText!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  cursor!: string | null;
}

@InputType('BPMRuntimeFormFieldOptionsInput')
export class RuntimeFormFieldOptionsInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  templateId!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  instanceId!: string | null;

  @Field()
  @IsString()
  @MaxLength(MAX_FIELD_KEY_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  fieldKey!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FORM_DATA_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  formDataJson!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_TEXT_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  searchText!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  cursor!: string | null;
}

@InputType('BPMPreviewResolveFormFieldOptionsInput')
export class PreviewResolveFormFieldOptionsInput {
  @Field()
  @IsString()
  @MaxLength(MAX_SCHEMA_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  schemaJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SCHEMA_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  uiSchemaJson!: string | null;

  @Field()
  @IsString()
  @MaxLength(MAX_FIELD_KEY_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  fieldKey!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FORM_DATA_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  formDataJson!: string | null;

  @Field()
  @IsString()
  @MaxLength(MAX_VALUES_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  valuesJson!: string;
}

@InputType('BPMRuntimeResolveFormFieldOptionsInput')
export class RuntimeResolveFormFieldOptionsInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  templateId!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IDENTIFIER_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  instanceId!: string | null;

  @Field()
  @IsString()
  @MaxLength(MAX_FIELD_KEY_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  fieldKey!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FORM_DATA_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  formDataJson!: string | null;

  @Field()
  @IsString()
  @MaxLength(MAX_VALUES_JSON_LENGTH, { message: OVERSIZED_INPUT_MESSAGE })
  valuesJson!: string;
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

  @Query(() => FormDataSourceResolveResultObject)
  @BPMDesignerOnly()
  previewResolveFormFieldOptions(
    @Args('input') input: PreviewResolveFormFieldOptionsInput,
    @BPMCurrentAuthContext() authContext: BPMAuthContext,
  ): Promise<FormDataSourceResolveResultObject> {
    return this.formDataSourceService
      .previewResolveFormFieldOptionValues(input, authContext)
      .then(toResolveResultObject);
  }

  @Query(() => FormDataSourceResolveResultObject)
  @BPMAuthenticated()
  resolveFormFieldOptions(
    @Args('input') input: RuntimeResolveFormFieldOptionsInput,
    @BPMCurrentAuthContext() authContext: BPMAuthContext,
  ): Promise<FormDataSourceResolveResultObject> {
    return this.formDataSourceService
      .resolveFormFieldOptionValues(input, authContext)
      .then(toResolveResultObject);
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
  output.options = result.options.map(toOptionObject);
  output.waitingForFieldKeys = [...result.waitingForFieldKeys];

  return output;
}

function toResolveResultObject(
  result: BPMFormDataSourceResolveResult,
): FormDataSourceResolveResultObject {
  const output = new FormDataSourceResolveResultObject();
  output.dataSourceKey = result.dataSourceKey;
  output.dataSourceVersion = result.dataSourceVersion;
  output.options = result.options.map(toOptionObject);
  output.unresolvedValues = [...result.unresolvedValues];
  output.waitingForFieldKeys = [...result.waitingForFieldKeys];

  return output;
}

function toOptionObject(option: FormFieldOption): FormFieldOptionObject {
  const optionObject = new FormFieldOptionObject();
  optionObject.label = option.label;
  optionObject.value = option.value;

  return optionObject;
}
