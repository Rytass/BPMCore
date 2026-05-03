import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const DEFAULT_API_PORT = 17601;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const globalPrefix = 'api';
  app.enableCors({
    origin: true,
  });
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidUnknownValues: true,
      transform: true,
      whitelist: true,
    }),
  );

  const port = Number(process.env.PORT ?? DEFAULT_API_PORT);
  await app.listen(port);
  Logger.log(`API is running on http://localhost:${port}/${globalPrefix}`);
}

void bootstrap();
