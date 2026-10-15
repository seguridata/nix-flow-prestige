import { describe, expect, it } from 'vitest';
import { flowToBpmn } from '../flow/flow';
import type { Flow } from '../flow/flow.types';
import { ProcessController } from './process.controller';

const controller = new ProcessController({} as never, {} as never);

const flow: Flow = {
  order: 'SECUENCIAL',
  slaHours: 48,
  variables: [{ key: 'monto', label: 'Monto', type: 'number', required: true }],
  steps: [
    { id: 'a', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
    { id: 'b', label: 'Finanzas', who: { type: 'ask', prompt: '¿Quién?' }, role: 'REVISOR', when: [{ variable: 'monto', op: '>', value: 50000 }] },
  ],
};

describe('POST /flows/validate', () => {
  it('un flujo válido no devuelve errores', () => {
    expect(controller.validateFlow({ flow: flow as never })).toEqual({ valid: true, errors: [] });
  });

  it('un flujo inválido devuelve los errores en español', () => {
    const r = controller.validateFlow({ flow: { ...flow, steps: [] } as never });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('al menos un paso');
  });
});

describe('POST /flows/from-bpmn', () => {
  it('convierte el BPMN de un flujo en el mismo flujo', () => {
    const r = controller.fromBpmn({ xml: flowToBpmn(flow, { key: 'x', name: 'X' }) });
    expect(r.errors).toEqual([]);
    expect(r.flow).toEqual(flow);
  });

  it('si no se puede convertir, flow es null y explica por qué', () => {
    const xml = '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="P"><bpmn:startEvent id="S"/><bpmn:serviceTask id="T"/></bpmn:process></bpmn:definitions>';
    const r = controller.fromBpmn({ xml });
    expect(r.flow).toBeNull();
    expect(r.errors.join(' ')).toContain('serviceTask');
  });

  it('usa las variables conocidas que reciba', () => {
    const xml = flowToBpmn(flow, { key: 'x', name: 'X' }).replace(/ prestige:variables="[^"]*"/, '');
    const r = controller.fromBpmn({ xml, variables: flow.variables });
    expect(r.flow?.variables).toEqual(flow.variables);
    expect(r.warnings).toEqual([]);
  });
});
