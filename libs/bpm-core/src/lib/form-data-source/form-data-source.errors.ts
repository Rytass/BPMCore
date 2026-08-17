import { BadRequestException, ForbiddenException } from '@nestjs/common';

export const BPM_FORM_DATA_SOURCE_ERROR_CODES = {
  DATA_SOURCE_MISSING: 'FORM_DATA_SOURCE_MISSING',
  DATA_SOURCE_VERSION_MISSING: 'FORM_DATA_SOURCE_VERSION_MISSING',
  FIELD_NOT_DYNAMIC: 'FORM_DATA_SOURCE_FIELD_NOT_DYNAMIC',
  INVALID_BINDING: 'FORM_DATA_SOURCE_INVALID_BINDING',
  INVALID_DESCRIPTOR: 'FORM_DATA_SOURCE_INVALID_DESCRIPTOR',
  INVALID_PROVIDER_RESULT: 'FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT',
  PARAMETER_LIMIT_EXCEEDED: 'FORM_DATA_SOURCE_PARAMETER_LIMIT_EXCEEDED',
  PROVIDER_FAILURE: 'FORM_DATA_SOURCE_PROVIDER_FAILURE',
  RESULT_LIMIT_EXCEEDED: 'FORM_DATA_SOURCE_RESULT_LIMIT_EXCEEDED',
  SEARCH_NOT_SUPPORTED: 'FORM_DATA_SOURCE_SEARCH_NOT_SUPPORTED',
  SEARCH_TOO_SHORT: 'FORM_DATA_SOURCE_SEARCH_TOO_SHORT',
  TIMEOUT: 'FORM_DATA_SOURCE_TIMEOUT',
  UNSUPPORTED_CONTROL: 'FORM_DATA_SOURCE_UNSUPPORTED_CONTROL',
  /**
   * The submitted value is no longer selectable under the current bindings and
   * authorization context. This is a user-facing validation failure, not a host
   * provider contract breach: keep it distinct from `INVALID_PROVIDER_RESULT`
   * so the renderer can show `INVALID` instead of `UNAVAILABLE`.
   */
  VALUE_NOT_RESOLVED: 'FORM_DATA_SOURCE_VALUE_NOT_RESOLVED',
  WAITING_FOR_DEPENDENCIES: 'FORM_DATA_SOURCE_WAITING_FOR_DEPENDENCIES',
  RUNTIME_CONTEXT_FORBIDDEN: 'FORM_DATA_SOURCE_RUNTIME_CONTEXT_FORBIDDEN',
} as const;

export type BPMFormDataSourceErrorCode =
  (typeof BPM_FORM_DATA_SOURCE_ERROR_CODES)[keyof typeof BPM_FORM_DATA_SOURCE_ERROR_CODES];

export class BPMFormDataSourceException extends BadRequestException {
  readonly code: BPMFormDataSourceErrorCode;

  constructor(code: BPMFormDataSourceErrorCode) {
    super({ code, message: code });
    this.code = code;
  }
}

export class BPMFormDataSourceForbiddenException extends ForbiddenException {
  readonly code: BPMFormDataSourceErrorCode;

  constructor(
    code: typeof BPM_FORM_DATA_SOURCE_ERROR_CODES.RUNTIME_CONTEXT_FORBIDDEN,
  ) {
    super({ code, message: code });
    this.code = code;
  }
}
