import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 503 con `retryAfterSeconds` (cuerpo) para que el cliente reintente. El filtro
 * global puede reflejarlo en la cabecera `Retry-After` leyendo `retryAfterSeconds`.
 */
export class ServiceBusyException extends HttpException {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(
      { statusCode: HttpStatus.SERVICE_UNAVAILABLE, error: 'Service Unavailable', message, retryAfterSeconds },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function envInt(name: string, fallback: number, min = 0): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Semáforo de concurrencia con cola acotada (puro, sin dependencias). Hasta
 * `maxConcurrency` tareas a la vez; hasta `maxQueue` en espera (FIFO); si la cola
 * está llena rechaza de inmediato con 503 en lugar de acumular memoria/latencia.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly name: string,
    private readonly maxConcurrency: number,
    private readonly maxQueue: number,
    private readonly retryAfterSeconds = 5,
  ) {
    if (maxConcurrency < 1) throw new Error('maxConcurrency debe ser >= 1');
  }

  get running(): number {
    return this.active;
  }
  get queued(): number {
    return this.waiters.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxQueue) {
      throw new ServiceBusyException(
        `${this.name} saturado: demasiadas solicitudes en cola, reintenta en unos segundos`,
        this.retryAfterSeconds,
      );
    }
    // El permiso se transfiere directamente al siguiente (active no cambia).
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}
