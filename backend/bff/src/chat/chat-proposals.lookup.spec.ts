import { describe, expect, it } from 'vitest';
import { bpmnToFlow } from '../flow/bpmn-to-flow';
import { flowToBpmn } from '../flow/flow';
import type { Flow } from '../flow/flow.types';
import { sanitizeFlow } from './chat-proposals';

const query = {
  table: 'responsables-gasto',
  match: [
    { column: 'etapa', op: 'eq', source: { value: 'area' }, emptyMatchesAny: false },
    { column: 'area', op: 'eq', source: { var: 'area' } },
  ],
};

const base = (who: unknown, extra: Record<string, unknown> = {}): unknown => ({
  order: 'SECUENCIAL',
  slaHours: 48,
  variables: [{ key: 'area', label: 'Área', type: 'text', required: true }],
  steps: [
    { id: 'a', label: 'Solicitante', role: 'FIRMANTE', who: { type: 'initiator' } },
    { id: 'b', label: 'Autorización', role: 'FIRMANTE', who },
  ],
  ...extra,
});

const lookup = (over: Record<string, unknown> = {}) => ({
  type: 'lookup',
  query,
  person: { signerId: 'signerId', name: 'nombre', email: 'correo' },
  prompt: '¿Quién autoriza?',
  ...over,
});

describe('chat: Who lookup solo si pasa validateFlow', () => {
  it('acepta una consulta válida y la reconstruye con lista blanca', () => {
    const r = sanitizeFlow(base(lookup({ signerId: 'intruso', email: 'x@y.mx', person: { signerId: 'signerId', extra: 'x' }, query: { ...query, extra: 1 } })));
    expect(r.errors).toEqual([]);
    expect(r.flow?.steps[1]!.who).toEqual({ type: 'lookup', query, person: { signerId: 'signerId' }, prompt: '¿Quién autoriza?' });
  });

  it('conserva las variables derivadas (con lista blanca) para que un `when` no quede huérfano', () => {
    const derived = [{ key: 'nivel', label: 'Nivel', type: 'number', column: 'nivel', onMiss: 'fail', query: { table: 'niveles', match: [{ column: 'area', op: 'eq', source: { var: 'area' } }] }, intruso: true }];
    const raw = base({ type: 'initiator' }, { derived }) as { steps: { when?: unknown }[] };
    raw.steps[1]!.when = [{ variable: 'nivel', op: '>=', value: 2 }];
    const r = sanitizeFlow(raw);
    expect(r.errors).toEqual([]);
    expect(r.flow?.derived).toEqual([{ key: 'nivel', label: 'Nivel', type: 'number', column: 'nivel', onMiss: 'fail', query: derived[0]!.query }]);
  });

  it.each([
    [lookup({ query: { ...query, table: 'Otra Tabla' } })],
    [lookup({ query: { ...query, match: [] } })],
    [lookup({ person: {} })],
    [lookup({ prompt: undefined })],
    [lookup({ prompt: ' ' })],
    [{ type: 'matrix', stage: 'area', prompt: 'x' }],
  ])('rechaza %j (no se degrada en silencio a otro tipo)', (who) => {
    const r = sanitizeFlow(base(who));
    expect(r.flow).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('sigue rechazando una persona fija', () => {
    expect(sanitizeFlow(base({ type: 'fixed', signerId: 'u1' })).flow).toBeUndefined();
  });
});

describe('lookup en BPMN: ida y vuelta', () => {
  it('flowToBpmn → bpmnToFlow conserva consulta, persona y pregunta', () => {
    const flow = base(lookup()) as Flow;
    const r = bpmnToFlow(flowToBpmn(flow, { key: 'k', name: 'K' }));
    expect(r.errors).toEqual([]);
    expect(r.flow?.steps[1]!.who).toEqual(lookup());
  });
});
