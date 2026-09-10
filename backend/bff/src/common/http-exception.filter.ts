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
    };
    res.status(status).json(body);
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

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request', message: 'Consulta inválida' };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Error interno',
    };
  }
}
