import { Logger } from '@nestjs/common';

/** Superficie mínima de ioredis que usa el guard (permite probarlo con un fake). */
export interface GuardableRedis {
  on(event: 'error', listener: (e: Error) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendCommand?: (...args: any[]) => unknown;
}

/**
 * Blinda un cliente ioredis para que un Redis caído NUNCA tumbe el proceso:
 *  - handler 'error' (log WARN, sin throw): evita el `Unhandled error event`;
 *  - toda promesa de comando (get/set/eval/subscribe/publish...) lleva un
 *    `.catch` no-op, de modo que un `MaxRetriesPerRequestError` en una llamada
 *    "fire and forget" (p. ej. el adaptador de Socket.IO) no sea una
 *    `unhandledRejection`. Quien hace `await` del comando sigue viendo el rechazo
 *    y puede degradar.
 */
export function guardRedis<T extends GuardableRedis>(client: T, label: string, log = new Logger('Redis')): T {
  client.on('error', (e) => log.warn(`${label}: ${e.message}`));
  const original = client.sendCommand;
  if (typeof original === 'function') {
    client.sendCommand = (...args) => {
      const result = original.apply(client, args);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(() => undefined);
      }
      return result;
    };
  }
  return client;
}
