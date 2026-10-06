import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { flowToBpmn, missingForConditions, resolveFlow, validateFlow } from './flow';
import type { Flow } from './flow.types';

/** Formato de vacaciones: el director solo participa si piden más de 5 días. */
const vacaciones: Flow = {
  order: 'SECUENCIAL',
  slaHours: 72,
  variables: [
    { key: 'nombre', label: 'Nombre', type: 'text', required: true },
    { key: 'dias', label: 'Días', type: 'number', required: true },
    { key: 'inicio', label: 'Inicio', type: 'date', required: true },
    { key: 'tipo', label: 'Tipo', type: 'select', required: true, options: ['Vacaciones', 'Permiso'] },
  ],
  steps: [
    { id: 'solicitante', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
    { id: 'jefe', label: 'Jefe directo', who: { type: 'ask', prompt: '¿Quién es tu jefe?' }, role: 'FIRMANTE' },
    {
      id: 'director',
      label: 'Dirección',
      who: { type: 'fixed', signerId: 'roberto', name: 'Roberto' },
      role: 'FIRMANTE',
      when: [{ variable: 'dias', op: '>', value: 5 }],
    },
    { id: 'rh', label: 'RH', who: { type: 'fixed', signerId: 'rh1' }, role: 'REVISOR' },
  ],
};

const clone = (): Flow => JSON.parse(JSON.stringify(vacaciones));

describe('validateFlow', () => {
  it('acepta un flujo correcto', () => {
    expect(validateFlow(vacaciones)).toEqual([]);
  });

  it('rechaza lo que no es un objeto', () => {
    expect(validateFlow(null)).toHaveLength(1);
    expect(validateFlow([])).toHaveLength(1);
  });

  it('exige al menos un paso y máximo 20', () => {
    const none = { ...clone(), steps: [] };
    expect(validateFlow(none).join()).toMatch(/al menos un paso/);
    const many = clone();
    many.steps = Array.from({ length: 21 }, (_, i) => ({
      id: `p${i}`,
      label: `Paso ${i}`,
      who: { type: 'initiator' as const },
      role: 'FIRMANTE' as const,
    }));
    expect(validateFlow(many).join()).toMatch(/máximo 20/);
  });

  it('detecta ids de paso repetidos', () => {
    const f = clone();
    f.steps[1]!.id = 'solicitante';
    expect(validateFlow(f).join()).toMatch(/repetido/);
  });

  it('una condición debe usar una variable que existe', () => {
    const f = clone();
    f.steps[2]!.when = [{ variable: 'fantasma', op: '>', value: 1 }];
    expect(validateFlow(f).join()).toMatch(/fantasma/);
  });

  it('operadores de orden solo con número o fecha', () => {
    const f = clone();
    f.steps[2]!.when = [{ variable: 'tipo', op: '>', value: 'Permiso' }];
    expect(validateFlow(f).join()).toMatch(/solo admite/);
    f.steps[2]!.when = [{ variable: 'tipo', op: '==', value: 'Permiso' }];
    expect(validateFlow(f)).toEqual([]);
  });

  it('el valor de la condición coincide con el tipo de la variable', () => {
    const f = clone();
    f.steps[2]!.when = [{ variable: 'dias', op: '>', value: 'cinco' }];
    expect(validateFlow(f).join()).toMatch(/número/);
    f.steps[2]!.when = [{ variable: 'inicio', op: '>', value: '5 de octubre' }];
    expect(validateFlow(f).join()).toMatch(/AAAA-MM-DD/);
  });

  it('who fijo necesita signerId y preguntar necesita texto', () => {
    const f = clone();
    f.steps[3]!.who = { type: 'fixed', signerId: ' ' };
    f.steps[1]!.who = { type: 'ask', prompt: '' };
    const errs = validateFlow(f).join();
    expect(errs).toMatch(/signerId/);
    expect(errs).toMatch(/pregunta/);
  });

  it('valida claves de variable, selects sin opciones y plazo', () => {
    const f = clone();
    f.variables.push({ key: '1mala', label: 'x', type: 'text', required: false });
    f.variables.push({ key: 'lista', label: 'Lista', type: 'select', required: false });
    f.slaHours = 0;
    const errs = validateFlow(f).join();
    expect(errs).toMatch(/1mala/);
    expect(errs).toMatch(/necesita opciones/);
    expect(errs).toMatch(/plazo/);
  });
});

describe('resolveFlow', () => {
  const active = (values: Record<string, string | number>) =>
    resolveFlow(vacaciones, values).map((r) => `${r.step.id}:${r.active ? 'si' : 'no'}`);

  it('el paso condicional solo aplica por encima del umbral numérico', () => {
    expect(active({ dias: 3 })).toEqual(['solicitante:si', 'jefe:si', 'director:no', 'rh:si']);
    expect(active({ dias: 5 })[2]).toBe('director:no');
    expect(active({ dias: 6 })[2]).toBe('director:si');
    expect(active({ dias: '10' })[2]).toBe('director:si');
  });

  it('sin valor o con valor inválido la condición no se cumple', () => {
    expect(active({})[2]).toBe('director:no');
    expect(active({ dias: 'muchos' })[2]).toBe('director:no');
  });

  it('compara fechas ISO y textos', () => {
    const f = clone();
    f.steps[2]!.when = [
      { variable: 'inicio', op: '>=', value: '2026-12-01' },
      { variable: 'tipo', op: '!=', value: 'Permiso' },
    ];
    const run = (v: Record<string, string>) => resolveFlow(f, v)[2]!.active;
    expect(run({ inicio: '2026-12-01', tipo: 'Vacaciones' })).toBe(true);
    expect(run({ inicio: '2026-11-30', tipo: 'Vacaciones' })).toBe(false);
    expect(run({ inicio: '2027-01-10', tipo: 'Permiso' })).toBe(false); // AND
  });

  it('missingForConditions lista lo que falta para decidir', () => {
    expect(missingForConditions(vacaciones, {})).toEqual(['dias']);
    expect(missingForConditions(vacaciones, { dias: 2 })).toEqual([]);
  });
});

describe('flowToBpmn', () => {
  const parse = (xml: string) =>
    new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: (n) => ['bpmn:userTask', 'bpmn:sequenceFlow', 'bpmn:exclusiveGateway'].includes(n) }).parse(xml);

  it('genera XML que parsea y trae un userTask por paso', () => {
    const doc = parse(flowToBpmn(vacaciones, { key: 'vacaciones', name: 'Vacaciones' }));
    const proc = doc['bpmn:definitions']['bpmn:process'];
    expect(proc['bpmn:userTask']).toHaveLength(vacaciones.steps.length);
    expect(proc['bpmn:startEvent']).toBeDefined();
    expect(proc['bpmn:endEvent']).toBeDefined();
  });

  it('los pasos condicionales llevan gateway de decisión, unión, condición y flujo por defecto', () => {
    const xml = flowToBpmn(vacaciones, { key: 'vacaciones', name: 'Vacaciones' });
    const proc = parse(xml)['bpmn:definitions']['bpmn:process'];
    const gateways = proc['bpmn:exclusiveGateway'];
    expect(gateways).toHaveLength(2); // decisión + unión del paso condicional
    expect(gateways.some((g: Record<string, string>) => g['@_default'])).toBe(true);
    expect(xml).toContain('${dias &gt; 5}');
  });

  it('cada elemento tiene su forma en el diagrama y cada flujo su arista', () => {
    const doc = parse(flowToBpmn(vacaciones, { key: 'vacaciones', name: 'Vacaciones' }));
    const plane = doc['bpmn:definitions']['bpmndi:BPMNDiagram']['bpmndi:BPMNPlane'];
    const shapes = [plane['bpmndi:BPMNShape']].flat();
    const edges = [plane['bpmndi:BPMNEdge']].flat();
    // inicio + fin + 4 tareas + 2 gateways
    expect(shapes).toHaveLength(8);
    expect(edges).toHaveLength(doc['bpmn:definitions']['bpmn:process']['bpmn:sequenceFlow'].length);
  });

  it('escapa nombres con caracteres especiales y comillas en condiciones de texto', () => {
    const f = clone();
    f.steps[0]!.label = 'Jefe <"A&B">';
    f.steps[2]!.when = [{ variable: 'tipo', op: '==', value: "O'Brien" }];
    const xml = flowToBpmn(f, { key: 'x', name: 'X' });
    expect(() => parse(xml)).not.toThrow();
    expect(xml).toContain('Jefe &lt;&quot;A&amp;B&quot;&gt;');
  });
});
