import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import type { ContratoWorkflowInput, ContratoWorkflowState } from './shared';
import type * as activities from './activities';

const { seedHumanTasks, markExpired, sealEvidence } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5 },
});

export const signSignal = defineSignal<[{ signerId: string }]>('signCompleted');
export const rejectSignal = defineSignal<[{ signerId: string }]>('rejected');
export const cancelSignal = defineSignal('cancelled');
export const stateQuery = defineQuery<ContratoWorkflowState>('getState');

export async function contratoDosPartes(input: ContratoWorkflowInput): Promise<ContratoWorkflowState> {
  const signed = new Set<string>();
  let rejectedBy: string | undefined;
  let cancelled = false;

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

  if (input.order === 'SECUENCIAL') {
    for (const signer of input.signers) {
      const reached = await condition(() => signed.has(signer.signerId) || stopped(), timeoutMs);
      if (!reached || stopped()) break;
    }
  } else {
    const reached = await condition(() => allSigned() || stopped(), timeoutMs);
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
