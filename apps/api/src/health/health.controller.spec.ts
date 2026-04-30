import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the API health payload', () => {
    const controller = new HealthController();

    expect(controller.getHealth()).toMatchObject({
      ok: true,
      service: 'bpm-api',
    });
  });
});
