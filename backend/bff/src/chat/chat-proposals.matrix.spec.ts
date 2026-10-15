import { describe, expect, it } from 'vitest';
import { bpmnToFlow } from '../flow/bpmn-to-flow';
import { flowToBpmn } from '../flow/flow';
import type { Flow } from '../flow/flow.types';
import { sanitizeFlow } from './chat-proposals';

const base = (who: unknown): unknown => ({
  order: 'SECUENCIAL',
  slaHours: 48,
  variables: [{ key: 'area', label: 'Área', type: 'text', required: true }],
  steps: [
    { id: 'a', label: 'Solicitante', role: 'FIRMANTE', who: { type: 'initiator' } },
    { id: 'b', label: 'Autorización', role: 'FIRMANTE', who },
  ],
});

describe('chat: Who matrix solo si pasa validateFlow', () => {
  it('acepta una matriz válida y la reconstruye con lista blanca', () => {
    const r = sanitizeFlow(base({ type: 'matrix', stage: 'area', prompt: '¿Quién autoriza?', signerId: 'intruso', email: 'x@y.mx' }));
    expect(r.errors).toEqual([]);
    expect(r.flow?.steps[1]!.who).toEqual({ type: 'matrix', stage: 'area', prompt: '¿Quién autoriza?' });
  });

  it.each([
    [{ type: 'matrix', stage: 'otra', prompt: 'x' }],
    [{ type: 'matrix', stage: 'area' }],
    [{ type: 'matrix', stage: 'area', prompt: ' ' }],
  ])('rechaza %j (no se degrada en silencio a otro tipo)', (who) => {
    const r = sanitizeFlow(base(who));
    expect(r.flow).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('sigue rechazando una persona fija', () => {
    expect(sanitizeFlow(base({ type: 'fixed', signerId: 'u1' })).flow).toBeUndefined();
  });
});

describe('matrix en BPMN: ida y vuelta', () => {
  it('flowToBpmn → bpmnToFlow conserva etapa y pregunta', () => {
    const flow = base({ type: 'matrix', stage: 'tipoGasto', prompt: '¿Quién autoriza el gasto?' }) as Flow;
    const r = bpmnToFlow(flowToBpmn(flow, { key: 'k', name: 'K' }));
    expect(r.errors).toEqual([]);
    expect(r.flow?.steps[1]!.who).toEqual({ type: 'matrix', stage: 'tipoGasto', prompt: '¿Quién autoriza el gasto?' });
  });
});
