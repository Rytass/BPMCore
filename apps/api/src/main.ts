import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from '@rytass/bpm-core-nestjs-module';
import { AppModule } from './app/app.module';

const DEFAULT_API_PORT = 17603;

/**
 * `uploadAttachment` accepts files up to 10 MB, and base64 inflates them by
 * about 4/3. Express defaults to 100 KB, so the published limit was
 * unreachable — a 100 KB PDF came back as an unexplained 413. Sized to clear a
 * full 10 MB upload plus the surrounding JSON.
 */
const REQUEST_BODY_LIMIT = '16mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useBodyParser('json', { limit: REQUEST_BODY_LIMIT });
  app.useBodyParser('urlencoded', {
    extended: true,
    limit: REQUEST_BODY_LIMIT,
  });
  app.enableCors({
    credentials: true,
    origin: true,
  });
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
  Logger.log(`BPM API is running on http://localhost:${port}`);
}

void bootstrap();
