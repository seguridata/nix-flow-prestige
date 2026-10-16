/** Real OTLP export smoke test. Run against an isolated collector:
 * OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14318 npx tsx scripts/verify-tenant-otlp.ts
 * Uses a synthetic authenticated context; does not authenticate against the full BFF.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { trace } from '@opentelemetry/api';
import { lastValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { TenantObservabilityInterceptor } from '../src/common/tenant-observability.interceptor';

async function main() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) throw new Error('Set OTEL_EXPORTER_OTLP_ENDPOINT to an isolated collector');
  const reader = new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 60000 });
  const sdk = new NodeSDK({
    autoDetectResources: false,
    resource: new Resource({ 'service.name': 'prestige-tenant-otlp-smoke' }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: reader,
  });
  sdk.start();
  try {
    const interceptor = new TenantObservabilityInterceptor();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { tenantId: 'otel-smoke-tenant' }, method: 'GET', route: { path: '/smoke/:id' } }),
        getResponse: () => ({ statusCode: 200 }),
      }),
      getHandler: () => function smoke() {},
    } as unknown as ExecutionContext;
    await trace.getTracer('prestige-tenant-otlp-smoke').startActiveSpan('tenant-observability-smoke', async span => {
      try {
        await lastValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }));
      } finally { span.end(); }
    });
    const collected = await reader.collect();
    const names = collected.resourceMetrics.scopeMetrics.flatMap(scope => scope.metrics.map(metric => metric.descriptor.name));
    if (!names.includes("prestige.http.requests") || !names.includes("prestige.http.duration")) throw new Error("Tenant metrics were not collected");
    await reader.forceFlush();
  } finally {
    await sdk.shutdown();
  }
  console.log('OTLP export completed. Verify collector contains span + prestige.http.requests + prestige.http.duration with tenant.id=otel-smoke-tenant.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
