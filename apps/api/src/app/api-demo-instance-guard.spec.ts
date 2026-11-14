import type { BPMInstanceGuardInput } from '@rytass/bpm-core-nestjs-module';
import {
  API_DEMO_INSTANCE_GUARD_CODE,
  API_DEMO_INSTANCE_GUARD_MARKER,
  apiDemoInstanceGuard,
  readApiDemoInstanceGuard,
} from './api-demo-instance-guard';

const inputWith = (
  formData: Readonly<Record<string, unknown>>,
): BPMInstanceGuardInput =>
  ({ formData, kind: 'SUBMIT' }) as unknown as BPMInstanceGuardInput;

describe('apiDemoInstanceGuard', () => {
  it('lets a form without the marker through', async (): Promise<void> => {
    await expect(
      apiDemoInstanceGuard.check(inputWith({ amount: 10, note: 'ok' })),
    ).resolves.toEqual([]);
  });

  it('refuses each text field that carries the marker', async (): Promise<void> => {
    await expect(
      apiDemoInstanceGuard.check(
        inputWith({
          amount: 10,
          note: `please ${API_DEMO_INSTANCE_GUARD_MARKER}`,
        }),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        code: API_DEMO_INSTANCE_GUARD_CODE,
        path: 'note',
        reason: 'HOST_RULE',
      }),
    ]);
  });

  it('is wired outside production only', (): void => {
    expect(readApiDemoInstanceGuard('production')).toBeUndefined();
    expect(readApiDemoInstanceGuard('development')).toBe(apiDemoInstanceGuard);
    expect(readApiDemoInstanceGuard(undefined)).toBe(apiDemoInstanceGuard);
  });
});
