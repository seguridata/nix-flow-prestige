import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { bpmnToFlow } from './bpmn-to-flow';
import { DerivedMissError, castCell, deriveValues, flowToBpmn, missingForConditions, publicFlow, publicWho, resolveFlow, validateFlow } from './flow';
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

const consulta = {
  table: 'responsables',
  match: [
    { column: 'area', op: 'eq', source: { var: 'tipo' }, emptyMatchesAny: true },
    { column: 'montoMin', op: 'gte', source: { var: 'dias' } },
    { column: 'activo', op: 'isNotEmpty' },
  ],
};
const lookupWho = (over: Record<string, unknown> = {}) => ({
  type: 'lookup',
  query: consulta,
  person: { signerId: 'signerId', name: 'nombre', email: 'correo' },
  prompt: '¿Quién autoriza?',
  ...over,
});

describe('Who lookup', () => {
  const withWho = (who: unknown): Flow => {
    const f = clone();
    f.steps[1] = { id: 'aut', label: 'Autorización', role: 'FIRMANTE', who } as never;
    return f;
  };

  it('acepta una consulta bien formada (con isNotEmpty sin fuente)', () => {
    expect(validateFlow(withWho(lookupWho()))).toEqual([]);
  });

  it('el tipo matrix ya no existe', () => {
    expect(validateFlow(withWho({ type: 'matrix', stage: 'area', prompt: 'x' })).join()).toContain('tipo de participante inválido');
  });

  it('la pregunta de respaldo es obligatoria', () => {
    expect(validateFlow(withWho(lookupWho({ prompt: undefined }))).join()).toContain('pregunta de respaldo');
    expect(validateFlow(withWho(lookupWho({ prompt: '  ' }))).join()).toContain('pregunta de respaldo');
  });

  it('exige la columna del responsable y valida las de nombre y correo', () => {
    expect(validateFlow(withWho(lookupWho({ person: {} }))).join()).toContain('person.signerId');
    expect(validateFlow(withWho(lookupWho({ person: { signerId: 'x y' } }))).join()).toContain('person.signerId');
    expect(validateFlow(withWho(lookupWho({ person: { signerId: 's', email: 3 } }))).join()).toContain('person.email');
  });

  it.each([
    ['tabla ausente', { ...consulta, table: undefined }, 'tabla'],
    ['tabla con clave inválida', { ...consulta, table: 'Mi Tabla' }, 'tabla'],
    ['sin condiciones', { ...consulta, match: [] }, 'al menos una condición'],
    ['más de 10 condiciones', { ...consulta, match: Array.from({ length: 11 }, () => consulta.match[0]) }, 'máximo 10'],
    ['columna inválida', { ...consulta, match: [{ column: '1x', op: 'isEmpty' }] }, 'no es una clave válida'],
    ['operador inválido', { ...consulta, match: [{ column: 'a', op: '>=', source: { value: 1 } }] }, 'operador'],
    ['sin fuente', { ...consulta, match: [{ column: 'a', op: 'eq' }] }, 'falta la fuente'],
    ['fuente con variable inexistente', { ...consulta, match: [{ column: 'a', op: 'eq', source: { var: 'nope' } }] }, '«nope», que no existe'],
    ['fuente con dos claves', { ...consulta, match: [{ column: 'a', op: 'eq', source: { var: 'tipo', value: 1 } }] }, '{ var } o { value }'],
    ['valor fijo que no es texto ni número', { ...consulta, match: [{ column: 'a', op: 'eq', source: { value: true } }] }, 'valor fijo'],
    ['isEmpty con fuente', { ...consulta, match: [{ column: 'a', op: 'isEmpty', source: { value: 'x' } }] }, 'no lleva fuente'],
    ['emptyMatchesAny que no es booleano', { ...consulta, match: [{ column: 'a', op: 'eq', source: { value: 'x' }, emptyMatchesAny: 'si' }] }, 'emptyMatchesAny'],
  ])('rechaza %s', (_n, query, msg) => {
    expect(validateFlow(withWho(lookupWho({ query }))).join()).toContain(msg);
  });

  it('flowToBpmn → bpmnToFlow conserva consulta, persona y pregunta', () => {
    const f = withWho(lookupWho());
    const xml = flowToBpmn(f, { key: 'x', name: 'X' });
    expect(xml).toContain('prestige:who="lookup"');
    expect(xml).toContain('prestige:prompt="¿Quién autoriza?"');
    expect(() => new XMLParser().parse(xml)).not.toThrow();
    const back = bpmnToFlow(xml);
    expect(back.errors).toEqual([]);
    expect(back.flow?.steps[1]!.who).toEqual(f.steps[1]!.who);
  });
});

describe('Flow.derived', () => {
  const withDerived = (over: Record<string, unknown> = {}): Flow => {
    const f = clone();
    f.derived = [
      { key: 'nivel', label: 'Nivel de aprobación', type: 'number', query: { table: 'niveles', match: [{ column: 'tipo', op: 'eq', source: { var: 'tipo' } }] }, column: 'nivel', ...over },
    ] as never;
    f.steps[2]!.when = [{ variable: 'nivel', op: '>=', value: 2 }];
    return f;
  };

  it('una derivada válida se puede usar en `when`', () => {
    expect(validateFlow(withDerived())).toEqual([]);
  });

  it('valida clave, tipo, columna, onMiss y que la clave no choque con una variable', () => {
    expect(validateFlow(withDerived({ key: '1x' })).join()).toContain('la clave debe empezar con letra');
    expect(validateFlow(withDerived({ key: 'dias' })).join()).toContain('ya existe una variable con esa clave');
    expect(validateFlow(withDerived({ type: 'otro' })).join()).toContain('tipo inválido');
    expect(validateFlow(withDerived({ column: '' })).join()).toContain('falta la columna');
    expect(validateFlow(withDerived({ onMiss: 'explota' })).join()).toContain('onMiss');
    expect(validateFlow(withDerived({ label: ' ' })).join()).toContain('falta la etiqueta');
  });

  it('una derivada solo consulta con variables capturadas, no con otras derivadas', () => {
    const f = withDerived();
    f.derived!.push({ key: 'otra', label: 'Otra', type: 'text', column: 'x', query: { table: 'niveles', match: [{ column: 'a', op: 'eq', source: { var: 'nivel' } }] } });
    expect(validateFlow(f).join()).toContain('«nivel», que no existe');
  });

  it('claves repetidas y lista mal formada', () => {
    const f = withDerived();
    f.derived!.push({ ...f.derived![0]! });
    expect(validateFlow(f).join()).toContain('repetida');
    const g = clone();
    (g as unknown as Record<string, unknown>).derived = 'x';
    expect(validateFlow(g).join()).toContain('variables derivadas deben ser una lista');
  });

  it('un participante lookup puede citar una variable derivada', () => {
    const f = withDerived();
    f.steps[1] = { id: 'aut', label: 'A', role: 'FIRMANTE', who: lookupWho({ query: { table: 'responsables', match: [{ column: 'nivel', op: 'eq', source: { var: 'nivel' } }] } }) } as never;
    expect(validateFlow(f)).toEqual([]);
  });

  it('resolveFlow usa las derivadas en `when` (sin valor → el paso no aplica)', () => {
    const f = withDerived();
    const activo = (values: Record<string, string | number | undefined>) => resolveFlow(f, values).find((r) => r.step.id === 'director')!.active;
    expect(activo({ nivel: 3 })).toBe(true);
    expect(activo({ nivel: 1 })).toBe(false);
    expect(activo({})).toBe(false);
  });

  it('missingForConditions no pide al usuario lo que el sistema calcula', () => {
    const f = withDerived();
    expect(missingForConditions(f, {})).not.toContain('nivel');
  });

  it('deriveValues: calcula con el resolvedor inyectable, convierte al tipo y descarta lo que el usuario mande con esa clave', async () => {
    const f = withDerived();
    const calls: unknown[] = [];
    const run = async (q: unknown, inputs: unknown) => {
      calls.push([q, inputs]);
      return { tableKey: 'niveles', revision: 4, rowId: 'r1', values: { nivel: '3' } };
    };
    const out = await deriveValues(f, { tipo: 'Permiso', nivel: 99 }, run);
    expect(out.values.nivel).toBe(3);
    expect(out.derived).toEqual([{ key: 'nivel', table: 'niveles', revision: 4, rowId: 'r1' }]);
    expect((calls[0] as unknown[])[1]).toEqual({ tipo: 'Permiso' }); // sin el `nivel` falso del usuario
    expect(resolveFlow(f, out.values).find((r) => r.step.id === 'director')!.active).toBe(true);
  });

  it('deriveValues: sin coincidencia la variable queda vacía (onMiss empty por defecto) y el valor del usuario no sirve', async () => {
    const f = withDerived();
    const out = await deriveValues(f, { tipo: 'X', nivel: 5 }, async () => null);
    expect(out.values.nivel).toBeUndefined();
    expect(out.derived).toEqual([{ key: 'nivel', table: 'niveles', revision: null, rowId: null }]);
    expect(resolveFlow(f, out.values).find((r) => r.step.id === 'director')!.active).toBe(false);
  });

  it('deriveValues: celda vacía cuenta como sin coincidencia', async () => {
    const out = await deriveValues(withDerived(), { tipo: 'X' }, async () => ({ tableKey: 'niveles', revision: 1, rowId: 'r', values: { nivel: '' } }));
    expect(out.values.nivel).toBeUndefined();
    expect(out.derived[0]!.rowId).toBeNull();
  });

  it("onMiss 'fail': con strict lanza DerivedMissError; sin strict (vista previa) solo queda vacía", async () => {
    const f = withDerived({ onMiss: 'fail' });
    await expect(deriveValues(f, { tipo: 'X' }, async () => null, { strict: true })).rejects.toBeInstanceOf(DerivedMissError);
    const soft = await deriveValues(f, { tipo: 'X' }, async () => null);
    expect(soft.values.nivel).toBeUndefined();
  });

  it('castCell convierte por tipo y devuelve null para lo vacío o inválido', () => {
    expect(castCell('12.5', 'number')).toBe(12.5);
    expect(castCell('abc', 'number')).toBeNull();
    expect(castCell('2026-03-04T10:00:00Z', 'date')).toBe('2026-03-04');
    expect(castCell('  hola ', 'text')).toBe('hola');
    expect(castCell(null, 'text')).toBeNull();
    expect(castCell('  ', 'select')).toBeNull();
  });

  it('flowToBpmn → bpmnToFlow conserva las derivadas y no las infiere como variables capturadas', () => {
    const f = withDerived();
    const xml = flowToBpmn(f, { key: 'x', name: 'X' });
    expect(xml).toContain('prestige:derived=');
    const back = bpmnToFlow(xml);
    expect(back.errors).toEqual([]);
    expect(back.flow?.derived).toEqual(f.derived);
    expect(back.flow?.variables.map((v) => v.key)).not.toContain('nivel');
  });
});

describe('publicFlow: lo que ve quien llena el formato', () => {
  it('oculta tabla, columnas y condiciones de las consultas pero conserva la pregunta, las variables y los `when`', () => {
    const f = clone();
    f.steps[1] = { id: 'aut', label: 'A', role: 'FIRMANTE', who: lookupWho() } as never;
    f.derived = [{ key: 'nivel', label: 'Nivel', type: 'number', column: 'secreta', query: { table: 'niveles-internos', match: [{ column: 'x', op: 'isNotEmpty' }] } }];
    f.steps[2]!.when = [{ variable: 'nivel', op: '>=', value: 2 }];
    const pub = publicFlow(f);
    expect(pub.steps[1]!.who).toEqual({ type: 'lookup', prompt: '¿Quién autoriza?' });
    expect(pub.derived).toEqual([{ key: 'nivel', label: 'Nivel', type: 'number' }]);
    expect(pub.steps[2]!.when).toEqual(f.steps[2]!.when);
    expect(pub.variables).toEqual(f.variables);
    const json = JSON.stringify(pub);
    for (const secret of ['responsables', 'niveles-internos', 'secreta', 'montoMin', 'correo']) expect(json).not.toContain(secret);
    // no muta el original
    expect((f.steps[1]!.who as { query?: unknown }).query).toBeTruthy();
  });

  it('deja intacto lo que no es una consulta y tolera formas rotas', () => {
    expect(publicFlow(clone())).toEqual(clone());
    expect(publicFlow(null)).toBeNull();
    expect(publicFlow({ steps: 'x' })).toEqual({ steps: 'x' });
    expect(publicWho({ type: 'ask', prompt: 'p' })).toEqual({ type: 'ask', prompt: 'p' });
    expect(publicWho(lookupWho() as never)).toEqual({ type: 'lookup', prompt: '¿Quién autoriza?' });
  });
});
