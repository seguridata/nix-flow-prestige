import { envPositiveInt } from '../common/env-number';

/**
 * Límites del worker de Temporal, configurables por entorno para poder correr
 * varias réplicas sin agotar memoria/CPU ni cortar actividades al desplegar.
 *  - TEMPORAL_MAX_CONCURRENT_ACTIVITIES (default 20)
 *  - TEMPORAL_MAX_CACHED_WORKFLOWS (default 250; cada uno retiene un isolate en RAM)
 *  - TEMPORAL_SHUTDOWN_GRACE_SECONDS (default 30; tiempo para terminar actividades al apagar)
 */
export function temporalWorkerLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    maxConcurrentActivityTaskExecutions: envPositiveInt('TEMPORAL_MAX_CONCURRENT_ACTIVITIES', 20, env),
    maxCachedWorkflows: envPositiveInt('TEMPORAL_MAX_CACHED_WORKFLOWS', 250, env),
    shutdownGraceTime: envPositiveInt('TEMPORAL_SHUTDOWN_GRACE_SECONDS', 30, env) * 1000, // ms
  };
}
