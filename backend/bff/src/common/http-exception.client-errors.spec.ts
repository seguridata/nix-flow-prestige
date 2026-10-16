import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter';

function host(method = 'POST', url = '/x') {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, setHeader: vi.fn() };
  const req = { method, originalUrl: url };
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    _status: status,
    _json: json,
  } as never;
}
const out = (h: unknown) => h as { _status: ReturnType<typeof vi.fn>; _json: ReturnType<typeof vi.fn> };

/** Lo que construye `http-errors` dentro de body-parser. */
const clientError = (status: number, type: string, expose = true) => Object.assign(new Error(type), { status, statusCode: status, type, expose });

describe('HttpExceptionFilter — errores del cliente que genera body-parser', () => {
  const f = new HttpExceptionFilter();

  it('un cuerpo demasiado grande responde 413 con mensaje claro (antes salía como 500)', () => {
    const h = host();
    f.catch(clientError(413, 'entity.too.large'), h);
    expect(out(h)._status).toHaveBeenCalledWith(413);
    expect(out(h)._json.mock.calls[0][0]).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'El cuerpo de la petición es demasiado grande',
    });
  });

  it('un JSON mal formado responde 400', () => {
    const h = host();
    f.catch(clientError(400, 'entity.parse.failed'), h);
    expect(out(h)._status).toHaveBeenCalledWith(400);
    expect(out(h)._json.mock.calls[0][0].message).toBe('El cuerpo de la petición no es un JSON válido');
  });

  it('un tipo desconocido con 4xx expuesto responde con mensaje genérico, sin filtrar el detalle', () => {
    const h = host();
    f.catch(clientError(422, 'algo.raro'), h);
    expect(out(h)._status).toHaveBeenCalledWith(422);
    expect(out(h)._json.mock.calls[0][0].message).toBe('Petición inválida');
  });

  it('un error con status 4xx pero sin `expose` NO se trata como del cliente (sigue siendo 500 genérico)', () => {
    const h = host();
    f.catch(clientError(400, 'entity.parse.failed', false), h);
    expect(out(h)._status).toHaveBeenCalledWith(500);
    expect(out(h)._json.mock.calls[0][0].message).toBe('Error interno');
  });

  it('un 5xx con `expose` tampoco se reinterpreta', () => {
    const h = host();
    f.catch(clientError(503, 'x'), h);
    expect(out(h)._status).toHaveBeenCalledWith(500);
  });
});
