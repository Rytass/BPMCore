import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  readonly ok: true;
  readonly service: 'bpm-api';
  readonly timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      ok: true,
      service: 'bpm-api',
      timestamp: new Date().toISOString(),
    };
  }
}
