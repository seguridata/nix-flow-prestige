import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  app.use(
    compression({
      // No comprimir binarios ya comprimidos (ZIP del expediente, PDFs).
      filter: (req, res) => {
        const type = String(res.getHeader('Content-Type') ?? '');
        if (/application\/(zip|pdf|octet-stream)/.test(type)) return false;
        return compression.filter(req, res);
      },
    }),
  );

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

  // OpenAPI (M14). UI en /docs, JSON en /docs-json. En dev se vuelca el spec a
  // backend/contracts/openapi.generated.json para diff contra el contrato a mano.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Prestige BFF')
    .setDescription(
      'API del BFF de Prestige (firma electrónica, evidencia verificable, onboarding). ' +
        'El navegador nunca habla directo con Postgres, Temporal, MinIO o el HSM.',
    )
    .setVersion(process.env.npm_package_version ?? '0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'keycloak')
    .addApiKey({ type: 'apiKey', name: 'X-Prestige-Worker-Token', in: 'header' }, 'worker-token')
    .build();
  const openapi = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, openapi, {
    swaggerOptions: { persistAuthorization: true },
    jsonDocumentUrl: 'docs-json',
  });
  if (process.env.NODE_ENV !== 'production') {
    try {
      writeFileSync(
        join(__dirname, '..', '..', '..', 'contracts', 'openapi.generated.json'),
        JSON.stringify(openapi, null, 2),
      );
    } catch {
      /* el volcado del contrato es best-effort */
    }
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  app.get(Logger).log(`Prestige BFF escuchando en http://localhost:${port}`);
}

void bootstrap();
