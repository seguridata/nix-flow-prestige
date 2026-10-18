import { describe, expect, it } from 'vitest';
import { flowToBpmn, validateFlow } from './flow';
import { bpmnToFlow } from './bpmn-to-flow';
import type { Flow } from './flow.types';
import { CONTRATO_BPMN } from '../process/defaults';

const vacaciones: Flow = {
  order: 'SECUENCIAL',
  slaHours: 72,
  variables: [
    { key: 'nombre', label: 'Nombre', type: 'text', required: true },
    { key: 'dias', label: 'Días', type: 'number', required: true },
    { key: 'inicio', label: 'Inicio', type: 'date', required: false },
    { key: 'tipo', label: 'Tipo', type: 'select', required: true, options: ['Vacaciones', 'Permiso'] },
  ],
  steps: [
    { id: 'solicitante', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
    { id: 'jefe', label: 'Jefe directo', who: { type: 'ask', prompt: '¿Quién es tu jefe?' }, role: 'FIRMANTE' },
    {
      id: 'director',
      label: 'Dirección',
      who: { type: 'fixed', signerId: 'roberto', name: 'Roberto', email: 'roberto@acme.mx' },
      role: 'FIRMANTE',
      when: [
        { variable: 'dias', op: '>', value: 5 },
        { variable: 'tipo', op: '==', value: "O'Brien \\ & <b>" },
      ],
    },
    { id: 'rh', label: 'RH', who: { type: 'fixed', signerId: 'rh1' }, role: 'REVISOR' },
  ],
};

const clone = (): Flow => JSON.parse(JSON.stringify(vacaciones));
const xmlOf = (f: Flow) => flowToBpmn(f, { key: 'v', name: 'V' });

describe('bpmnToFlow · ida y vuelta con flowToBpmn', () => {
  it('recupera exactamente el mismo flujo', () => {
    const r = bpmnToFlow(xmlOf(vacaciones));
    expect(r.errors).toEqual([]);
    expect(r.flow).toEqual(vacaciones);
    expect(r.warnings).toEqual([]);
  });

  it('funciona con un flujo lineal sin condiciones y en orden paralelo', () => {
    const f = clone();
    f.order = 'PARALELO';
    f.slaHours = 24;
    f.steps = f.steps.filter((s) => !s.when);
    const r = bpmnToFlow(xmlOf(f));
    expect(r.errors).toEqual([]);
    expect(r.flow).toEqual(f);
  });

  it('con varios pasos condicionales seguidos', () => {
    const f = clone();
    f.steps.push({ id: 'gerente', label: 'Gerencia', who: { type: 'ask', prompt: '¿Quién?' }, role: 'REVISOR', when: [{ variable: 'dias', op: '>=', value: 10 }] });
    const r = bpmnToFlow(xmlOf(f));
    expect(r.errors).toEqual([]);
    expect(r.flow).toEqual(f);
  });
});

describe('bpmnToFlow · diagramas dibujados a mano', () => {
  const head = '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="D" targetNamespace="x">';
  const lineal = (nodes: string, flows: string) =>
    `${head}<bpmn:process id="P">${nodes}${flows}</bpmn:process></bpmn:definitions>`;

  it('sin atributos de Prestige usa valores por defecto y avisa', () => {
    const xml = lineal(
      '<bpmn:startEvent id="S"/><bpmn:userTask id="Task_1" name="Revisar"/><bpmn:endEvent id="E"/>',
      '<bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="Task_1"/><bpmn:sequenceFlow id="f2" sourceRef="Task_1" targetRef="E"/>',
    );
    const r = bpmnToFlow(xml);
    expect(r.errors).toEqual([]);
    expect(r.flow?.steps).toEqual([
      { id: 'Task_1', label: 'Revisar', role: 'FIRMANTE', who: { type: 'ask', prompt: '¿Quién participa en «Revisar»?' } },
    ]);
    expect(r.flow?.slaHours).toBe(72);
    expect(r.flow?.order).toBe('SECUENCIAL');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('infiere las variables de las condiciones si no vienen definidas', () => {
    const f = clone();
    const xml = xmlOf(f).replace(/ prestige:variables="[^"]*"/, '');
    const r = bpmnToFlow(xml);
    expect(r.errors).toEqual([]);
    expect(r.flow?.variables.map((v) => [v.key, v.type])).toEqual([['dias', 'number'], ['tipo', 'text']]);
    expect(r.warnings.join(' ')).toContain('«dias»');
  });

  it('usa las variables conocidas que se le pasen', () => {
    const xml = xmlOf(vacaciones).replace(/ prestige:variables="[^"]*"/, '');
    const r = bpmnToFlow(xml, { variables: vacaciones.variables });
    expect(r.errors).toEqual([]);
    expect(r.flow?.variables).toEqual(vacaciones.variables);
  });

  it('rechaza lo que Prestige no sabe ejecutar, con un mensaje claro', () => {
    const xml = lineal(
      '<bpmn:startEvent id="S"/><bpmn:serviceTask id="T" name="Validar"/><bpmn:endEvent id="E"/>',
      '<bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="f2" sourceRef="T" targetRef="E"/>',
    );
    const r = bpmnToFlow(xml);
    expect(r.flow).toBeUndefined();
    expect(r.errors.join(' ')).toContain('serviceTask');
  });

  it('rechaza compuertas paralelas, subprocesos y colaboraciones', () => {
    const par = lineal('<bpmn:startEvent id="S"/><bpmn:parallelGateway id="G"/><bpmn:endEvent id="E"/>', '<bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="G"/><bpmn:sequenceFlow id="f2" sourceRef="G" targetRef="E"/>');
    expect(bpmnToFlow(par).errors.join(' ')).toContain('parallelGateway');
    const collab = `${head}<bpmn:collaboration id="C"/><bpmn:process id="P"><bpmn:startEvent id="S"/></bpmn:process></bpmn:definitions>`;
    expect(bpmnToFlow(collab).errors.join(' ')).toContain('colaboración');
  });

  it('rechaza más de un evento de fin (rechazos, como el contrato de dos partes)', () => {
    const r = bpmnToFlow(CONTRATO_BPMN);
    expect(r.flow).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('detecta bucles', () => {
    const xml = lineal(
      '<bpmn:startEvent id="S"/><bpmn:userTask id="A" name="A"/><bpmn:userTask id="B" name="B"/><bpmn:endEvent id="E"/>',
      '<bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="A"/><bpmn:sequenceFlow id="f2" sourceRef="A" targetRef="B"/><bpmn:sequenceFlow id="f3" sourceRef="B" targetRef="A"/>',
    );
    expect(bpmnToFlow(xml).errors.join(' ')).toContain('bucle');
  });

  it('detecta tareas sin conectar al camino principal', () => {
    const xml = lineal(
      '<bpmn:startEvent id="S"/><bpmn:userTask id="A" name="A"/><bpmn:userTask id="Suelta" name="Suelta"/><bpmn:endEvent id="E"/>',
      '<bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="A"/><bpmn:sequenceFlow id="f2" sourceRef="A" targetRef="E"/>',
    );
    expect(bpmnToFlow(xml).errors.join(' ')).toContain('Suelta');
  });

  it('exige que el camino llegue al fin', () => {
    const xml = lineal(
      '<bpmn:startEvent id="S"/><bpmn:userTask id="A" name="A"/><bpmn:endEvent id="E"/>',
      '<bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="A"/>',
    );
    expect(bpmnToFlow(xml).errors.length).toBeGreaterThan(0);
  });

  it('una compuerta debe tener la forma decisión → tarea → unión', () => {
    const xml = lineal(
      '<bpmn:startEvent id="S"/><bpmn:exclusiveGateway id="G" name="¿?"/><bpmn:userTask id="A" name="A"/><bpmn:userTask id="B" name="B"/><bpmn:endEvent id="E"/>',
      '<bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="G"/>' +
        '<bpmn:sequenceFlow id="f2" sourceRef="G" targetRef="A"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${x &gt; 1}</bpmn:conditionExpression></bpmn:sequenceFlow>' +
        '<bpmn:sequenceFlow id="f3" sourceRef="G" targetRef="B"/>' +
        '<bpmn:sequenceFlow id="f4" sourceRef="A" targetRef="E"/><bpmn:sequenceFlow id="f5" sourceRef="B" targetRef="E"/>',
    );
    const r = bpmnToFlow(xml);
    expect(r.flow).toBeUndefined();
    expect(r.errors.join(' ')).toContain('unión');
  });

  it('avisa de condiciones que no entiende', () => {
    const f = clone();
    const xml = xmlOf(f).replace('${dias &gt; 5', '${dias &gt; 5 || dias &lt; 1');
    const r = bpmnToFlow(xml);
    expect(r.flow).toBeUndefined();
    expect(r.errors.join(' ')).toContain('condición');
  });

  it('no es XML', () => {
    expect(bpmnToFlow('esto no es xml').errors.length).toBeGreaterThan(0);
    expect(bpmnToFlow('<a><b></a>').errors.length).toBeGreaterThan(0);
    expect(bpmnToFlow('').errors.length).toBeGreaterThan(0);
  });

  it('el flujo resultante siempre pasa validateFlow', () => {
    const r = bpmnToFlow(xmlOf(vacaciones));
    expect(validateFlow(r.flow)).toEqual([]);
  });
});

describe('businessRuleTask como consulta previa explícita', () => {
  const definition = { key: 'nivel', label: 'Nivel de aprobación', type: 'number', query: { table: 'niveles', match: [{ column: 'usuario', op: 'eq', source: { var: 'solicitante' } }] }, column: 'nivel', onMiss: 'fail' };
  const escaped = (value: unknown) => JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const diagram = (rule = `<bpmn:businessRuleTask id="R" name="Determinar nivel" prestige:lookup="${escaped(definition)}"/>`, after = false) => `
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:prestige="urn:prestige">
    <bpmn:process id="P" prestige:order="SECUENCIAL" prestige:slaHours="72">
      <bpmn:startEvent id="S"/>${rule}<bpmn:userTask id="U" name="Firmar" prestige:who="initiator" prestige:role="FIRMANTE"/><bpmn:endEvent id="E"/>
      <bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="${after ? 'U' : 'R'}"/>
      <bpmn:sequenceFlow id="f2" sourceRef="${after ? 'U' : 'R'}" targetRef="${after ? 'R' : 'U'}"/>
      <bpmn:sequenceFlow id="f3" sourceRef="${after ? 'R' : 'U'}" targetRef="E"/>
    </bpmn:process></bpmn:definitions>`;
  it('convierte a variable derivada validada; no agrega una firma ficticia', () => {
    const result = bpmnToFlow(diagram());
    expect(result.errors).toEqual([]);
    expect(result.flow?.derived).toEqual([definition]);
    expect(result.flow?.steps.map(s => s.id)).toEqual(['U']);
    expect(validateFlow(result.flow)).toEqual([]);
    // Al exportar se normaliza a prestige:derived del proceso, sin perder semántica.
    expect(bpmnToFlow(flowToBpmn(result.flow!, { key: 'regla', name: 'Regla' })).flow).toEqual(result.flow);
  });
  it('rechaza regla sin extensión, JSON inválido o definición no tipada', () => {
    for (const attribute of ['', 'prestige:lookup="no-json"', `prestige:lookup="${escaped({ query: definition.query })}"`]) {
      const result = bpmnToFlow(diagram(`<bpmn:businessRuleTask id="R" ${attribute}/>`));
      expect(result.flow).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
  it('valida variables fuente, operadores y reserva solicitante', () => {
    for (const value of [
      { ...definition, key: 'solicitante' },
      { ...definition, query: { ...definition.query, match: [{ column: 'usuario', op: 'unknown', source: { var: 'solicitante' } }] } },
      { ...definition, query: { ...definition.query, match: [{ column: 'usuario', op: 'eq', source: { var: 'desconocida' } }] } },
    ]) expect(bpmnToFlow(diagram(`<bpmn:businessRuleTask id="R" prestige:lookup="${escaped(value)}"/>`)).flow).toBeUndefined();
  });
  it('no adelanta silenciosamente una consulta posterior a una firma', () => {
    const result = bpmnToFlow(diagram(undefined, true));
    expect(result.flow).toBeUndefined();
    expect(result.errors.join()).toContain('antes de todas');
  });
  it('rechaza identificadores duplicados y consultas con salidas condicionales', () => {
    expect(bpmnToFlow(diagram().replace('<bpmn:endEvent id="E"/>', '<bpmn:endEvent id="E"/><bpmn:userTask id="R"/>')).errors.join()).toContain('repetido');
    const xml = diagram().replace('<bpmn:sequenceFlow id="f2" sourceRef="R" targetRef="U"/>', '<bpmn:sequenceFlow id="f2" sourceRef="R" targetRef="U"><bpmn:conditionExpression>${x == 1}</bpmn:conditionExpression></bpmn:sequenceFlow>');
    expect(bpmnToFlow(xml).errors.join()).toContain('salida condicional');
  });
});
