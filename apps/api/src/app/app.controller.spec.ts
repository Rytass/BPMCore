import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();
  });

  describe('getData', () => {
    it('should return BPM API status', () => {
      const appController = app.get<AppController>(AppController);
      expect(appController.getData()).toEqual({
        message: 'BPM API is running',
      });
    });
  });

  describe('getHealth', () => {
    it('should return health status for probes', () => {
      const appController = app.get<AppController>(AppController);
      expect(appController.getHealth()).toEqual({
        service: 'api',
        status: 'ok',
      });
    });
  });
});
