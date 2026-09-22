/**
 * M15 — OpenTelemetry. Se importa PRIMERO en `main.ts` (antes de Nest/Prisma)
 * para que las instrumentaciones parcheen `http`, `express` y `@prisma/client`.
 *
 * Sin `OTEL_EXPORTER_OTLP_ENDPOINT` (ni `_TRACES_ENDPOINT`) el SDK no arranca:
 * cero overhead y cero ruido en local. En prod: apuntar al colector OTLP/HTTP
 * (ver `otel-collector` en docker-compose y D8).
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk: NodeSDK | null = null;

function startTracing(): void {
  if (!endpoint) return;
  if (process.env.OTEL_LOG_LEVEL === 'debug') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'prestige-bff',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0',
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // El logging de fs es puro ruido; el resto (http, express, pg, dns…) sí.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
  // eslint-disable-next-line no-console
  console.log(`[otel] tracing activo → ${endpoint}`);

  const stop = () => {
    sdk
      ?.shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

// Efecto de carga: al ser el PRIMER import de main.ts, corre antes que Nest/Prisma.
startTracing();
