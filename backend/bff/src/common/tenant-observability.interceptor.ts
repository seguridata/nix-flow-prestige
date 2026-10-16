import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { metrics, trace } from '@opentelemetry/api';
import { finalize, tap } from 'rxjs/operators';

/** Solo usa el tenant validado por los guards; no registra nombres, correos, cuerpos ni URLs con IDs. */
@Injectable()
export class TenantObservabilityInterceptor implements NestInterceptor {
  private readonly meter = metrics.getMeter('prestige-tenant');
  private readonly requests = this.meter.createCounter('prestige.http.requests', { description: 'Peticiones autenticadas por tenant' });
  private readonly duration = this.meter.createHistogram('prestige.http.duration', { unit: 'ms' });

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const tenantId = request.user?.tenantId;
    if (typeof tenantId !== 'string' || !tenantId) return next.handle();
    const attributes = {
      'tenant.id': tenantId,
      'http.request.method': request.method || 'UNKNOWN',
      'http.route': request.route?.path || context.getHandler().name,
    };
    trace.getActiveSpan()?.setAttributes(attributes);
    const start = performance.now();
    let errorStatus: number | undefined;
    return next.handle().pipe(tap({ error: (error: unknown) => {
      errorStatus = typeof (error as { getStatus?: unknown })?.getStatus === 'function'
        ? (error as { getStatus(): number }).getStatus() : 500;
    } }), finalize(() => {
      const labels = { ...attributes, 'http.response.status_code': errorStatus ?? response.statusCode };
      this.requests.add(1, labels);
      this.duration.record(performance.now() - start, labels);
    }));
  }
}
