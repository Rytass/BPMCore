import {
  readFormDataSourceErrorCode,
  readFormDataSourceErrorMessage,
  readFormSchemaLintMessage,
} from './form-data-source-errors';

describe('form data source errors', (): void => {
  it('reads a bare code, a wrapped code, and a GraphQL sentence', (): void => {
    expect(
      readFormDataSourceErrorCode('FORM_DATA_SOURCE_WAITING_FOR_DEPENDENCIES'),
    ).toBe('FORM_DATA_SOURCE_WAITING_FOR_DEPENDENCIES');
    expect(
      readFormDataSourceErrorCode(
        new Error('FORM_DATA_SOURCE_VALUE_NOT_RESOLVED'),
      ),
    ).toBe('FORM_DATA_SOURCE_VALUE_NOT_RESOLVED');
    expect(
      readFormDataSourceErrorCode(
        new Error('GraphQL error: FORM_DATA_SOURCE_TIMEOUT'),
      ),
    ).toBe('FORM_DATA_SOURCE_TIMEOUT');
  });

  it('keeps the longer version code distinct from the source code', (): void => {
    expect(readFormDataSourceErrorCode('FORM_DATA_SOURCE_MISSING')).toBe(
      'FORM_DATA_SOURCE_MISSING',
    );
    expect(
      readFormDataSourceErrorCode('FORM_DATA_SOURCE_VERSION_MISSING'),
    ).toBe('FORM_DATA_SOURCE_VERSION_MISSING');
  });

  it('ignores unrelated failures so callers can fall back', (): void => {
    expect(readFormDataSourceErrorCode(new Error('Network request failed'))).toBe(
      null,
    );
    expect(readFormDataSourceErrorCode('FORM_DATA_SOURCE_NOT_A_REAL_CODE')).toBe(
      null,
    );
    expect(readFormDataSourceErrorCode(null)).toBe(null);
    expect(readFormDataSourceErrorMessage(new Error('boom'))).toBe(null);
    expect(readFormSchemaLintMessage('schema.fields[0] is invalid')).toBe(
      'schema.fields[0] is invalid',
    );
  });

  it('ignores a token that merely contains a code', (): void => {
    expect(readFormDataSourceErrorCode('XFORM_DATA_SOURCE_TIMEOUT')).toBe(null);
    expect(readFormDataSourceErrorCode('xFORM_DATA_SOURCE_TIMEOUT')).toBe(null);
    expect(readFormDataSourceErrorCode('FORM_DATA_SOURCE_TIMEOUTx')).toBe(null);
    expect(readFormDataSourceErrorMessage('XFORM_DATA_SOURCE_TIMEOUT')).toBe(
      null,
    );
    expect(readFormSchemaLintMessage('XFORM_DATA_SOURCE_TIMEOUT')).toBe(
      'XFORM_DATA_SOURCE_TIMEOUT',
    );
  });

  it('leaves host-chosen names alone in every prose lint shape', (): void => {
    // Each trailing token below is a host- or designer-chosen name, not an error
    // code: rewriting it would tell the designer the source timed out.
    const proseLines = [
      'schema.fields[1].dataSource.bindings unknown parameter: FORM_DATA_SOURCE_TIMEOUT',
      'schema.fields[1].dataSource.bindings.parameter is duplicated: FORM_DATA_SOURCE_TIMEOUT',
      'schema.fields[1].dataSource.bindings[0].parameter is required: FORM_DATA_SOURCE_TIMEOUT',
      'descriptor.parameters.key is duplicated: FORM_DATA_SOURCE_TIMEOUT',
      // Real structural-lint shapes: no field index.
      'schema.fields fieldKey is duplicated: FORM_DATA_SOURCE_TIMEOUT',
      'schema.fields dependency cycle: FORM_DATA_SOURCE_TIMEOUT',
      // A parameter name may itself contain the code-bearing path shape.
      'schema.fields[1].dataSource.bindings unknown parameter: foo.dataSource FORM_DATA_SOURCE_TIMEOUT',
      // Even a name spelling out the exact emitted shape stays verbatim,
      // because a code is only read at the start of a lint segment.
      'schema.fields fieldKey is duplicated: schema.fields[1].dataSource FORM_DATA_SOURCE_TIMEOUT',
    ];

    proseLines.forEach((line): void => {
      expect(readFormSchemaLintMessage(line)).toBe(line);
    });
  });

  it('keeps a name containing the line separator intact', (): void => {
    const line =
      'schema.fields[1].dataSource.bindings unknown parameter: a; FORM_DATA_SOURCE_TIMEOUT';

    expect(readFormSchemaLintMessage(line)).toBe(line);
  });

  it('still maps a real code when a prose line sits beside it', (): void => {
    expect(
      readFormSchemaLintMessage(
        'schema.fields[1].dataSource.bindings unknown parameter: plant; schema.fields[2].dataSource FORM_DATA_SOURCE_MISSING',
      ),
    ).toBe(
      'schema.fields[1].dataSource.bindings unknown parameter: plant; schema.fields[2].dataSource 選項來源已不存在，請聯絡系統管理員。',
    );
  });

  it('maps every code in a joined publish failure', (): void => {
    expect(
      readFormSchemaLintMessage(
        'schema.fields[1].dataSource FORM_DATA_SOURCE_MISSING; schema.fields[2].dataSource FORM_DATA_SOURCE_VERSION_MISSING',
      ),
    ).toBe(
      'schema.fields[1].dataSource 選項來源已不存在，請聯絡系統管理員。; schema.fields[2].dataSource 選項來源版本已不存在，請聯絡系統管理員。',
    );
  });

  it('never leaks a code the client does not map yet', (): void => {
    const unknown = new Error('FORM_DATA_SOURCE_SOMETHING_NEW');

    expect(readFormDataSourceErrorMessage(unknown)).toBe(
      '選項來源發生問題，請稍後再試或聯絡系統管理員。',
    );
    expect(readFormDataSourceErrorMessage(unknown)).not.toContain(
      'FORM_DATA_SOURCE',
    );
    expect(
      readFormSchemaLintMessage(
        'schema.fields[1].dataSource FORM_DATA_SOURCE_SOMETHING_NEW',
      ),
    ).not.toContain('FORM_DATA_SOURCE');
  });

  it('keeps the field path but replaces the code in a lint line', (): void => {
    expect(
      readFormSchemaLintMessage(
        'schema.fields[1].dataSource FORM_DATA_SOURCE_MISSING',
      ),
    ).toBe('schema.fields[1].dataSource 選項來源已不存在，請聯絡系統管理員。');
    expect(
      readFormSchemaLintMessage('schema.fields[0] has a duplicated field key'),
    ).toBe('schema.fields[0] has a duplicated field key');
  });

  it('maps a rejected value to reselect copy instead of a provider fault', (): void => {
    expect(
      readFormDataSourceErrorMessage(
        new Error('FORM_DATA_SOURCE_VALUE_NOT_RESOLVED'),
      ),
    ).toBe('已選取的選項已失效，請重新選擇。');
    expect(
      readFormDataSourceErrorMessage(
        new Error('FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT'),
      ),
    ).toBe('選項來源回傳的資料不正確，請聯絡系統管理員。');
  });
});
