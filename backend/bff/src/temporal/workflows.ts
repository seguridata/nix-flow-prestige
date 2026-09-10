import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import type { ContratoWorkflowInput, ContratoWorkflowState } from './shared';
import { NUDGE_MARKS, nudgeKindFor } from './shared';
import type * as activities from './activities';

const { seedHumanTasks, markExpired, sealEvidence } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5 },
});

// Un recordatorio perdido no debe tumbar la ceremonia: menos reintentos y timeout corto.
const { sendNudge } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});

export const signSignal = defineSignal<[{ signerId: string }]>('signCompleted');
export const rejectSignal = defineSignal<[{ signerId: string }]>('rejected');
export const cancelSignal = defineSignal('cancelled');
export const stateQuery = defineQuery<ContratoWorkflowState>('getState');

/**
 * Espera hasta `windowMs` a que `satisfied()` se cumpla, disparando un aviso
 * (`onNudge`) en cada fracción de `NUDGE_MARKS` del SLA. Devuelve `true` sólo si
 * la condición se satisfizo dentro de la ventana (no por corte ni por timeout).
 */
async function waitWithNudges(opts: {
  windowMs: number;
  satisfied: () => boolean;
  stopped: () => boolean;
  onNudge: (mark: number) => Promise<void>;
}): Promise<boolean> {
  let elapsed = 0;
  for (const mark of NUDGE_MARKS) {
    const at = Math.floor(opts.windowMs * mark);
    const delta = at - elapsed;
    if (delta <= 0) continue;
    const reached = await condition(() => opts.satisfied() || opts.stopped(), delta);
    if (reached) return opts.satisfied();
    elapsed = at;
    if (!opts.stopped()) await opts.onNudge(mark);
  }
  const rest = opts.windowMs - elapsed;
  if (rest > 0) {
    const reached = await condition(() => opts.satisfied() || opts.stopped(), rest);
    if (reached) return opts.satisfied();
  }
  return opts.satisfied();
}

export async function contratoDosPartes(input: ContratoWorkflowInput): Promise<ContratoWorkflowState> {
  const signed = new Set<string>();
  let rejectedBy: string | undefined;
  let cancelled = false;
  let nudges = 0;

  const state = (): ContratoWorkflowState => ({
    signatureRequestId: input.signatureRequestId,
    phase: cancelled
      ? 'CANCELADO'
      : rejectedBy
        ? 'CANCELADO'
        : signed.size >= input.signers.length
          ? 'CERRADO'
          : 'FIRMA',
    signed: [...signed],
    rejectedBy,
    currentSignerId:
      input.order === 'SECUENCIAL'
        ? input.signers.find((s) => !signed.has(s.signerId))?.signerId
        : undefined,
    nudges,
  });

  setHandler(signSignal, ({ signerId }) => {
    signed.add(signerId);
  });
  setHandler(rejectSignal, ({ signerId }) => {
    rejectedBy = signerId;
  });
  setHandler(cancelSignal, () => {
    cancelled = true;
  });
  setHandler(stateQuery, () => state());

  await seedHumanTasks(input);

  const timeoutMs = Math.max(input.slaHours, 1) * 60 * 60 * 1000;
  const allSigned = () => signed.size >= input.signers.length;
  const stopped = () => cancelled || Boolean(rejectedBy);

  const nudge = (signerId?: string) => async (mark: number) => {
    nudges += 1;
    try {
      await sendNudge({
        signatureRequestId: input.signatureRequestId,
        kind: nudgeKindFor(mark),
        ratio: mark,
        signerId,
      });
    } catch {
      // Un aviso perdido no interrumpe el SLA.
    }
  };

  if (input.order === 'SECUENCIAL') {
    for (const signer of input.signers) {
      if (signed.has(signer.signerId)) continue;
      const reached = await waitWithNudges({
        windowMs: timeoutMs,
        satisfied: () => signed.has(signer.signerId),
        stopped,
        onNudge: nudge(signer.signerId),
      });
      if (!reached || stopped()) break;
    }
  } else {
    const reached = await waitWithNudges({
      windowMs: timeoutMs,
      satisfied: allSigned,
      stopped,
      onNudge: nudge(),
    });
    if (!reached && !stopped()) {
      await markExpired(input.signatureRequestId);
      return { ...state(), phase: 'EXPIRADO' };
    }
  }

  if (stopped()) {
    return state();
  }

  if (!allSigned()) {
    await markExpired(input.signatureRequestId);
    return { ...state(), phase: 'EXPIRADO' };
  }

  await sealEvidence(input.signatureRequestId);
  return { ...state(), phase: 'CERRADO' };
}
