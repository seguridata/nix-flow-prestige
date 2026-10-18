import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractCandidates } from './pdf-layout';
import { assembleTemplate, proposeTemplate } from './template-proposal';
import type { LlmProvider, LlmRequest } from './llm.types';

/** PDF de 2 páginas: 612x792. Página 1 con campos; página 2 con una caja de firma. */
async function formPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const p2 = doc.addPage([600, 800]);
  const form = doc.getForm();
  form.createTextField('nombre_empleado').addToPage(p1, { x: 50, y: 700, width: 200, height: 20 });
  form.createTextField('dias').addToPage(p1, { x: 300, y: 700, width: 100, height: 20 });
  const tipo = form.createDropdown('tipo');
  tipo.addOptions(['Vacaciones', 'Permiso']);
  tipo.addToPage(p1, { x: 50, y: 650, width: 200, height: 20 });
  form.createCheckBox('acepta').addToPage(p1, { x: 50, y: 600, width: 14, height: 14 });
  form.createTextField('firma_empleado').addToPage(p2, { x: 60, y: 100, width: 180, height: 50 });
  return Buffer.from(await doc.save());
}

const fake = (replies: unknown[]): LlmProvider & { calls: LlmRequest[] } => {
  const calls: LlmRequest[] = [];
  return {
    name: 'fake',
    calls,
    async complete(req) {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      return { text: typeof r === 'string' ? r : JSON.stringify(r), model: 'fake-1', usage: { inputTokens: 4, outputTokens: 2 } };
    },
  };
};

describe('extractCandidates', () => {
  it('lee posiciones reales del PDF como fracciones con origen arriba-izquierda', async () => {
    const { pageCount, candidates } = await extractCandidates(await formPdf());
    expect(pageCount).toBe(2);
    const nombre = candidates.find((c) => c.name === 'nombre_empleado')!;
    expect(nombre).toMatchObject({ kind: 'text', page: 1 });
    expect(nombre.x).toBeCloseTo(50 / 600, 2);
    expect(nombre.y).toBeCloseTo((800 - 720) / 800, 2);
    expect(nombre.w).toBeCloseTo(200 / 600, 2);
    expect(nombre.h).toBeCloseTo(20 / 800, 2);
    expect(candidates.find((c) => c.name === 'firma_empleado')?.page).toBe(2);
  });

  it('los desplegables traen sus opciones y las casillas se omiten con aviso', async () => {
    const r = await extractCandidates(await formPdf());
    expect(r.candidates.find((c) => c.name === 'tipo')).toMatchObject({ kind: 'dropdown', options: ['Vacaciones', 'Permiso'] });
    expect(r.candidates.map((c) => c.name)).not.toContain('acepta');
    expect(r.warnings.join(' ')).toContain('acepta');
  });

  it('un PDF sin campos devuelve cero candidatos y lo explica', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    const r = await extractCandidates(Buffer.from(await doc.save()));
    expect(r.candidates).toEqual([]);
    expect(r.warnings.join(' ')).toContain('no tiene campos');
  });

  it('rechaza lo que no es un PDF', async () => {
    await expect(extractCandidates(Buffer.from('no soy un pdf'))).rejects.toThrow(/PDF/);
  });

  it('asigna ids estables c1..cn', async () => {
    const { candidates } = await extractCandidates(await formPdf());
    expect(candidates.map((c) => c.id)).toEqual(candidates.map((_, i) => `c${i + 1}`));
  });
});

const good = (cands: { id: string; name: string }[]) => {
  const id = (n: string) => cands.find((c) => c.name === n)!.id;
  return {
    name: 'Solicitud de vacaciones',
    description: 'Formato de vacaciones',
    fields: [
      { candidate: id('nombre_empleado'), label: 'Nombre del empleado', type: 'text', required: true },
      { candidate: id('dias'), label: 'Días', type: 'number', required: true },
      { candidate: id('tipo'), label: 'Tipo', type: 'select', required: true },
    ],
    signatureBoxes: [{ candidate: id('firma_empleado'), stepId: 'empleado' }],
    flow: {
      order: 'SECUENCIAL',
      slaHours: 72,
      steps: [
        { id: 'empleado', label: 'Firma del empleado', role: 'FIRMANTE', who: { type: 'initiator' } },
        { id: 'rh', label: 'Visto bueno de RH', role: 'REVISOR', who: { type: 'ask', prompt: '¿Quién de RH?' }, when: [{ variable: 'dias', op: '>', value: 10 }] },
      ],
    },
  };
};

describe('assembleTemplate', () => {
  it('arma un formato válido con posiciones tomadas del PDF y variables derivadas de los campos', async () => {
    const { pageCount, candidates } = await extractCandidates(await formPdf());
    const r = assembleTemplate(candidates, good(candidates), pageCount);
    expect(r.errors).toEqual([]);
    const meta = r.meta!;
    expect(meta.fields).toHaveLength(3);
    expect(meta.fields[0]).toMatchObject({ key: 'nombre_del_empleado', page: 1 });
    expect(meta.flow.variables.map((v) => v.key)).toEqual(['nombre_del_empleado', 'dias', 'tipo']);
    expect(meta.flow.variables[2]).toMatchObject({ type: 'select', options: ['Vacaciones', 'Permiso'] });
    expect(meta.signatureBoxes[0]).toMatchObject({ stepId: 'empleado', page: 2 });
    expect(meta.methods).toEqual([]);
  });

  it('rechaza candidatos que no existen y usos repetidos', async () => {
    const { pageCount, candidates } = await extractCandidates(await formPdf());
    const bad = good(candidates);
    bad.fields.push({ candidate: 'c99', label: 'Fantasma', type: 'text', required: false });
    bad.fields.push({ ...bad.fields[0]! });
    const r = assembleTemplate(candidates, bad, pageCount);
    expect(r.meta).toBeUndefined();
    expect(r.errors.join(' ')).toContain('c99');
    expect(r.errors.join(' ')).toContain('más de una vez');
  });

  it('una caja de firma debe apuntar a un paso del flujo', async () => {
    const { pageCount, candidates } = await extractCandidates(await formPdf());
    const bad = good(candidates);
    bad.signatureBoxes[0]!.stepId = 'inexistente';
    const r = assembleTemplate(candidates, bad, pageCount);
    expect(r.errors.join(' ')).toContain('inexistente');
  });

  it('las condiciones solo pueden usar variables que son campos', async () => {
    const { pageCount, candidates } = await extractCandidates(await formPdf());
    const bad = good(candidates);
    (bad.flow.steps[1] as { when: unknown }).when = [{ variable: 'monto', op: '>', value: 5 }];
    const r = assembleTemplate(candidates, bad, pageCount);
    expect(r.errors.join(' ')).toContain('monto');
  });

  it('una lista sin opciones ni desplegable de origen es un error', async () => {
    const { pageCount, candidates } = await extractCandidates(await formPdf());
    const bad = good(candidates);
    bad.fields[0] = { ...bad.fields[0]!, type: 'select' };
    const r = assembleTemplate(candidates, bad, pageCount);
    expect(r.errors.join(' ')).toContain('opciones');
  });

  it('genera claves únicas aunque dos etiquetas coincidan', async () => {
    const { pageCount, candidates } = await extractCandidates(await formPdf());
    const f = good(candidates);
    f.fields[1] = { ...f.fields[1]!, label: 'Nombre del empleado', type: 'text' };
    (f.flow.steps[1] as { when?: unknown }).when = undefined;
    const r = assembleTemplate(candidates, f, pageCount);
    expect(r.errors).toEqual([]);
    expect(new Set(r.meta!.fields.map((x) => x.key)).size).toBe(3);
  });
});

describe('proposeTemplate', () => {
  it('manda al modelo solo metadatos de los campos, nunca el contenido del PDF', async () => {
    const pdf = await formPdf();
    const { candidates } = await extractCandidates(pdf);
    const p = fake([good(candidates)]);
    const r = await proposeTemplate(p, pdf, 'Formato para solicitar vacaciones');
    expect(r.errors).toEqual([]);
    expect(r.meta?.name).toBe('Solicitud de vacaciones');
    const sent = JSON.stringify(p.calls[0]);
    expect(sent).toContain('nombre_empleado');
    expect(sent).not.toContain('%PDF');
    expect(p.calls[0]!.system).toMatch(/dato, no instrucciones/i);
  });

  it('reintenta una vez con los errores y se rinde si persisten', async () => {
    const pdf = await formPdf();
    const p = fake([{ name: 'X', fields: [], signatureBoxes: [], flow: { steps: [] } }]);
    const r = await proposeTemplate(p, pdf, 'Formato');
    expect(r.meta).toBeUndefined();
    expect(r.attempts).toBe(2);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('sin campos no llama al modelo', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    const p = fake([{}]);
    const r = await proposeTemplate(p, Buffer.from(await doc.save()), '');
    expect(p.calls).toHaveLength(0);
    expect(r.meta).toBeUndefined();
    expect(r.errors.join(' ')).toContain('no tiene campos');
  });
});
