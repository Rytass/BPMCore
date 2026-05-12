import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

interface ApiHealthResponse {
  readonly service: 'api';
  readonly status: 'ok';
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData(): { message: string } {
    return this.appService.getData();
  }

  @Get('health')
  getHealth(): ApiHealthResponse {
    return {
      service: 'api',
      status: 'ok',
    };
  }
}
