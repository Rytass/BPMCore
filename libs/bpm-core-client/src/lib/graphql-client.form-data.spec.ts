import { configureBPMClient } from './client-config';
import {
  BPMGraphQLRequestError,
  readFormDataIssues,
  requestGraphQl,
} from './graphql-client';

const REFUSAL_MESSAGE = '欄位「備註」為必填；「請購明細」第 2 列的「數量」為必填';

function mockGraphQlResponse(payload: unknown): void {
  configureBPMClient({
    fetch: (async (): Promise<Response> =>
      new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })) as typeof fetch,
  });
}

describe('requestGraphQl form data issues', (): void => {
  afterEach((): void => {
    configureBPMClient({});
  });

  it('keeps the host message and attaches the structured issues', async (): Promise<void> => {
    mockGraphQlResponse({
      data: null,
      errors: [
        {
          extensions: {
            originalError: {
              formDataErrors: [
                {
                  message: '欄位「備註」為必填',
                  path: 'note',
                  reason: 'REQUIRED',
                },
                {
                  message: '「請購明細」第 2 列的「數量」為必填',
                  path: 'items[1].qty',
                  reason: 'REQUIRED',
                },
              ],
            },
          },
          message: REFUSAL_MESSAGE,
        },
      ],
    });

    const error: unknown = await requestGraphQl('mutation M { m }').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BPMGraphQLRequestError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(REFUSAL_MESSAGE);
    expect(readFormDataIssues(error).map((issue) => issue.path)).toEqual([
      'note',
      'items[1].qty',
    ]);
  });

  it('drops malformed entries instead of trusting them', async (): Promise<void> => {
    mockGraphQlResponse({
      errors: [
        {
          extensions: {
            originalError: {
              formDataErrors: [
                { path: 'note', reason: 'NOT_A_REASON', message: 'x' },
                { path: 'note', reason: 'REQUIRED', message: '為必填' },
              ],
            },
          },
          message: '為必填',
        },
      ],
    });

    const error: unknown = await requestGraphQl('{ q }').catch(
      (caught: unknown) => caught,
    );

    expect(readFormDataIssues(error)).toEqual([
      { message: '為必填', path: 'note', reason: 'REQUIRED' },
    ]);
  });

  it('answers an empty list for errors that carry no form data', async (): Promise<void> => {
    mockGraphQlResponse({ errors: [{ message: 'Unauthorized' }] });

    const error: unknown = await requestGraphQl('{ q }').catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toBe('Unauthorized');
    expect(readFormDataIssues(error)).toEqual([]);
    expect(readFormDataIssues(new Error('plain'))).toEqual([]);
    expect(readFormDataIssues(null)).toEqual([]);
  });
});
