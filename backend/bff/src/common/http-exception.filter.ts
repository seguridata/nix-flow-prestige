import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  at: string;
  /** Detalle de validación (solo 4xx): cada elemento es una frase legible para el usuario. */
  errors?: string[];
}

/**
 * Filtro global de excepciones: normaliza TODA respuesta de error a una forma
 * estable, mapea los errores conocidos de Prisma a códigos HTTP y **oculta el
 * detalle interno de los 5xx** (sólo se registra con stack en el log).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, error, message } = this.resolve(exception);

    if (status >= 500) {
      this.log.error(
        `${req.method} ${req.originalUrl} → ${status}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      path: req.originalUrl,
      at: new Date().toISOString(),
      ...(status < 500 ? this.validationErrors(exception) : {}),
    };
    // 503 por saturación (p. ej. OCR): el servicio informa en cuánto reintentar y se devuelve como cabecera estándar.
    const retryAfter = this.retryAfterSeconds(exception);
    if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
    res.status(status).json(body);
  }

  private retryAfterSeconds(exception: unknown): number | undefined {
    if (!(exception instanceof HttpException)) return undefined;
    const r = exception.getResponse();
    const n = typeof r === 'object' && r !== null ? (r as { retryAfterSeconds?: unknown }).retryAfterSeconds : undefined;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
  }

  /** Pasa tal cual la lista `errors` (de strings) que algunos servicios adjuntan a un 4xx. */
  private validationErrors(exception: unknown): { errors?: string[] } {
    if (!(exception instanceof HttpException)) return {};
    const payload = exception.getResponse();
    const errors = typeof payload === 'object' && payload !== null ? (payload as { errors?: unknown }).errors : undefined;
    return Array.isArray(errors) && errors.every((e) => typeof e === 'string') && errors.length > 0
      ? { errors: errors as string[] }
      : {};
  }

  private resolve(exception: unknown): {
    status: number;
    error: string;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { status, error: exception.name, message: payload };
      }
      const p = payload as { error?: string; message?: string | string[] };
      return {
        status,
        error: p.error ?? exception.name,
        message: p.message ?? exception.message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'Recurso no encontrado' };
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            error: 'Conflict',
            message: 'Ya existe un registro con esos datos únicos',
          };
        case 'P2003':
          return {
            status: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: 'Referencia inválida (clave foránea)',
          };
        default:
          return {
            status: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: `Error de base de datos (${exception.code})`,
          };
      }
    }

    // Errores del propio cliente que genera body-parser (http-errors): cuerpo demasiado grande, JSON mal formado, etc.
    // Llevan su código 4xx; sin esto terminaban como un 500 «Error interno» y ensuciaban el log.
    const clientError = this.clientHttpError(exception);
    if (clientError) return clientError;
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request', message: 'Consulta inválida' };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Error interno',
    };
  }

  private clientHttpError(exception: unknown): { status: number; error: string; message: string } | undefined {
    if (typeof exception !== 'object' || exception === null) return undefined;
    const e = exception as { status?: unknown; statusCode?: unknown; expose?: unknown; type?: unknown };
    const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined;
    if (!status || status < 400 || status > 499 || e.expose !== true) return undefined;
    const byType: Record<string, string> = {
      'entity.too.large': 'El cuerpo de la petición es demasiado grande',
      'entity.parse.failed': 'El cuerpo de la petición no es un JSON válido',
      'entity.verify.failed': 'El cuerpo de la petición no se pudo verificar',
      'encoding.unsupported': 'La codificación de la petición no es compatible',
      'charset.unsupported': 'El juego de caracteres de la petición no es compatible',
      'request.aborted': 'La petición se cortó antes de terminar',
      'request.size.invalid': 'El tamaño de la petición no coincide con su contenido',
      'stream.encoding.set': 'La petición no se pudo leer',
    };
    const message = byType[typeof e.type === 'string' ? e.type : ''] ?? 'Petición inválida';
    const error = status === 413 ? 'Payload Too Large' : status === 415 ? 'Unsupported Media Type' : 'Bad Request';
    return { status, error, message };
  }
}
