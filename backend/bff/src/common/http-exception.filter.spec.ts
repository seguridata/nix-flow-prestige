import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from './http-exception.filter';

function host(method = 'GET', url = '/x') {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status };
  const req = { method, originalUrl: url };
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    _status: status,
    _json: json,
  } as never;
}

describe('HttpExceptionFilter', () => {
  const f = new HttpExceptionFilter();

  it('normaliza una HttpException conservando código y mensaje', () => {
    const h = host();
    f.catch(new NotFoundException('no está'), h);
    expect((h as never as { _status: ReturnType<typeof vi.fn> })._status).toHaveBeenCalledWith(404);
    const body = (h as never as { _json: ReturnType<typeof vi.fn> })._json.mock.calls[0][0];
    expect(body).toMatchObject({ statusCode: 404, message: 'no está', path: '/x' });
    expect(body.at).toBeTypeOf('string');
  });

  it('mapea P2002 de Prisma a 409', () => {
    const h = host();
    const err = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' });
    f.catch(err, h);
    expect((h as never as { _status: ReturnType<typeof vi.fn> })._status).toHaveBeenCalledWith(409);
  });

  it('oculta el detalle de un error desconocido (500 genérico)', () => {
    const h = host('POST', '/boom');
    f.catch(new Error('secreto interno con stack'), h);
    expect((h as never as { _status: ReturnType<typeof vi.fn> })._status).toHaveBeenCalledWith(500);
    const body = (h as never as { _json: ReturnType<typeof vi.fn> })._json.mock.calls[0][0];
    expect(body.message).toBe('Error interno');
    expect(JSON.stringify(body)).not.toContain('secreto interno');
  });

  it('preserva el array de mensajes del ValidationPipe', () => {
    const h = host();
    f.catch(new BadRequestException({ error: 'Bad Request', message: ['a inválido', 'b requerido'] }), h);
    const body = (h as never as { _json: ReturnType<typeof vi.fn> })._json.mock.calls[0][0];
    expect(body.message).toEqual(['a inválido', 'b requerido']);
  });
});
