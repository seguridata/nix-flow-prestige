import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * Bootstrap del BFF de Prestige.
 *
 * Endurecimiento de plataforma (Fase A):
 *  - helmet: cabeceras de seguridad.
 *  - CORS por lista explícita de orígenes (CORS_ORIGINS), no `origin: true`.
 *  - Body limit realista (2 MB) — el contenido de documentos ya no viaja en base64.
 *  - ValidationPipe global con whitelist + forbidNonWhitelisted.
 *  - compression y shutdown hooks.
 *  - Logger estructurado (pino) como logger de Nest.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.flushLogs();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(compression());

  const bodyLimit = process.env.BODY_LIMIT ?? '2mb';
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Prestige-Worker-Token'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  app.get(Logger).log(`Prestige BFF escuchando en http://localhost:${port}`);
}

void bootstrap();
