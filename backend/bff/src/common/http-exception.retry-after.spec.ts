import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'POST', originalUrl: '/x' }) }) };
  new HttpExceptionFilter().catch(exception, host as never);
  return res;
}

describe('HttpExceptionFilter · Retry-After', () => {
  it('devuelve la cabecera cuando la excepción trae retryAfterSeconds', () => {
    const res = run(new HttpException({ message: 'Ocupado', retryAfterSeconds: 7.2 }, 503));
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '8');
  });
  it('no la envía si no hay retryAfterSeconds válido', () => {
    expect(run(new ServiceUnavailableException('caído')).setHeader).not.toHaveBeenCalled();
    expect(run(new HttpException({ message: 'x', retryAfterSeconds: -1 }, 503)).setHeader).not.toHaveBeenCalled();
    expect(run(new Error('boom')).setHeader).not.toHaveBeenCalled();
  });
});
