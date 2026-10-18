import { SetMetadata } from '@nestjs/common';

export const STEP_UP_KEY = 'stepUpMaxAgeSeconds';

/**
 * A-11 — exige autenticación reciente para acciones sensibles. Si el `auth_time`
 * del token es más antiguo que `maxAgeSeconds`, `StepUpGuard` responde 403
 * `{ error: 'step_up_required', ... }` y el frontend fuerza un re-login
 * (`max_age` de OIDC).
 */
export const StepUp = (maxAgeSeconds = 300) => SetMetadata(STEP_UP_KEY, maxAgeSeconds);
