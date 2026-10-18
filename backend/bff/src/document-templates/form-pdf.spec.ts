import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, StandardFonts } from 'pdf-lib';
import { buildFormPdf, wrapText } from './form-pdf';
import { fillPdf } from './pdf-fill';
import { parseTemplateMeta } from './template-meta';
import type { Flow, FlowStep, FlowVariable } from '../flow/flow.types';
import type { AttachmentSpec } from '../attachments/attachment-specs';

function textOf(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.lookup(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  const raw = streams.map((st) => (st instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(st).decode()).toString('latin1') : '')).join('\n');
  // pdf-lib escribe el texto como cadenas hexadecimales: <48656C6C6F> Tj
  return [...raw.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => Buffer.from(m[1]!, 'hex').toString('latin1')).join('\n');
}

const vars = (n: number): FlowVariable[] =>
  Array.from({ length: n }, (_, i) => ({ key: `campo${i + 1}`, label: `Campo número ${i + 1}`, type: 'text' as const, required: i % 2 === 0 }));

const steps: FlowStep[] = [
  { id: 'solicitante', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
  { id: 'jefe', label: 'Jefe directo', who: { type: 'ask', prompt: '¿Quién?' }, role: 'FIRMANTE' },
  { id: 'direccion', label: 'Dirección General', who: { type: 'fixed', signerId: 'roberto' }, role: 'FIRMANTE', when: [{ variable: 'campo1', op: '==', value: 'x' }] },
];

const specs: AttachmentSpec[] = [
  { key: 'cotizaciones', label: 'Cotizaciones', help: 'Adjunta tres cotizaciones de proveedores distintos', required: true, min: 3, max: 5, accept: ['pdf', 'image'], maxSizeMB: 10 },
  { key: 'soporte', label: 'Soporte técnico', required: false, min: 0, max: 2, accept: ['any'], maxSizeMB: 5 },
];

const flowOf = (variables: FlowVariable[]): Flow => ({ variables, steps, order: 'SECUENCIAL', slaHours: 48 });

describe('buildFormPdf', () => {
  it('genera un PDF válido de una página con un campo por variable y una caja de firma por paso', async () => {
    const r = await buildFormPdf({ name: 'Solicitud de compra', description: 'Hoja generada', variables: vars(5), steps, attachmentSpecs: specs });
    expect(r.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(r.pdf);
    expect(doc.getPageCount()).toBe(r.pageCount);
    expect(r.pageCount).toBe(1);
    expect(r.fields.map((f) => f.key)).toEqual(['campo1', 'campo2', 'campo3', 'campo4', 'campo5']);
    expect(r.fields.every((f) => f.page === 1 && f.w > 0 && f.h > 0)).toBe(true);
    expect(r.signatureBoxes.map((b) => b.stepId)).toEqual(['solicitante', 'jefe', 'direccion']);
  });

  it('copia tipo, obligatoriedad y opciones de la variable al campo', async () => {
    const variables: FlowVariable[] = [
      { key: 'area', label: 'Área', type: 'select', required: true, options: ['Marketing', 'Ventas'] },
      { key: 'monto', label: 'Monto', type: 'number', required: false },
      { key: 'fecha', label: 'Fecha', type: 'date', required: true },
    ];
    const r = await buildFormPdf({ name: 'Formato', variables, steps, attachmentSpecs: [] });
    expect(r.fields[0]).toMatchObject({ key: 'area', type: 'select', required: true, options: ['Marketing', 'Ventas'] });
    expect(r.fields[1]).toMatchObject({ key: 'monto', type: 'number', required: false });
    expect(r.fields[2]).toMatchObject({ key: 'fecha', type: 'date' });
  });

  it('con muchas variables usa varias páginas y ninguna caja se sale de su página ni se encima', async () => {
    const r = await buildFormPdf({ name: 'Formato largo', variables: vars(60), steps, attachmentSpecs: specs });
    expect(r.pageCount).toBeGreaterThan(1);
    const doc = await PDFDocument.load(r.pdf);
    expect(doc.getPageCount()).toBe(r.pageCount);
    expect(Math.max(...r.fields.map((f) => f.page))).toBeGreaterThan(1);

    const all = [...r.fields.map((f) => ({ ...f, id: f.key })), ...r.signatureBoxes.map((b) => ({ ...b, id: b.stepId }))];
    for (const b of all) {
      expect(b.page).toBeGreaterThanOrEqual(1);
      expect(b.page).toBeLessThanOrEqual(r.pageCount);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1);
      expect(b.y + b.h).toBeLessThanOrEqual(1 - 0.03); // deja libre el pie de página
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        if (a.page !== b.page) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} se encima con ${b.id}`).toBe(false);
      }
    }
  });

  it('fields y signatureBoxes pasan parseTemplateMeta (el resto del pipeline no cambia)', async () => {
    const variables = vars(60);
    const r = await buildFormPdf({ name: 'Formato largo', variables, steps, attachmentSpecs: specs });
    const out = parseTemplateMeta(
      { name: 'Formato largo', flow: flowOf(variables), fields: r.fields, signatureBoxes: r.signatureBoxes, methods: ['ACCEPT'], kycPolicy: 'NONE', requirePasskey: false, attachmentSpecs: specs },
      r.pageCount,
    );
    expect(out.errors).toEqual([]);
    expect(out.meta!.attachmentSpecs).toHaveLength(2);
  });

  it('fillPdf imprime los valores en las cajas calculadas (también en la 2.ª página)', async () => {
    const r = await buildFormPdf({ name: 'Formato largo', variables: vars(60), steps, attachmentSpecs: specs });
    const last = r.fields[r.fields.length - 1]!;
    expect(last.page).toBeGreaterThan(1);
    const filled = await fillPdf(r.pdf, r.fields, { campo1: 'Valor uno', campo60: 'Valor sesenta' });
    const doc = await PDFDocument.load(filled);
    expect(textOf(doc, 0)).toContain('Valor uno');
    expect(textOf(doc, last.page - 1)).toContain('Valor sesenta');
  });

  it('acentos y eñes del español salen tal cual, y lo que Helvetica no codifica no rompe el PDF', async () => {
    const variables: FlowVariable[] = [
      { key: 'ano', label: 'Año de ejecución · ¿Cuántos días?', type: 'text', required: true },
      { key: 'raro', label: 'Símbolo 😀 raro', type: 'text', required: false },
    ];
    const r = await buildFormPdf({
      name: 'Solicitud de adquisición — Dirección',
      description: 'Pingüino, canción, él, ¡Atención!',
      variables,
      steps: [{ id: 'dir', label: 'Dirección General', who: { type: 'initiator' }, role: 'FIRMANTE' }],
      attachmentSpecs: [{ key: 'a', label: 'Cotización técnica', required: true, min: 1, max: 1, accept: ['pdf'], maxSizeMB: 5 }],
    });
    const text = textOf(await PDFDocument.load(r.pdf), 0);
    expect(text).toContain('Solicitud de adquisición');
    expect(text).toContain('Año de ejecución');
    expect(text).toContain('¿Cuántos días?');
    expect(text).toContain('Pingüino, canción');
    expect(text).toContain('Dirección General');
    expect(text).toContain('Cotización técnica');
    expect(text).toContain('Símbolo ? raro'); // el emoji no existe en WinAnsi: «?» y sigue
  });

  it('la sección Anexos lista las especificaciones y cuántos se piden', async () => {
    const text = textOf(await PDFDocument.load((await buildFormPdf({ name: 'F', variables: vars(1), steps, attachmentSpecs: specs })).pdf), 0);
    expect(text).toContain('Anexos');
    expect(text).toContain('Cotizaciones');
    expect(text).toMatch(/obligatorio/);
    expect(text).toContain('de 3 a 5 archivo(s)');
    expect(text).toContain('hasta 2 archivo(s)');
    expect(text).toContain('cualquier tipo permitido');
    expect(text).toContain('tres cotizaciones');
  });

  it('sin anexos no hay sección Anexos', async () => {
    const text = textOf(await PDFDocument.load((await buildFormPdf({ name: 'F', variables: vars(1), steps, attachmentSpecs: [] })).pdf), 0);
    expect(text).not.toContain('Anexos');
  });

  it('títulos y etiquetas larguísimos se envuelven o recortan sin desbordar', async () => {
    const long = 'Palabra'.repeat(80);
    const variables: FlowVariable[] = [{ key: 'v', label: `${long} ${long}`, type: 'select', required: true, options: Array.from({ length: 40 }, (_, i) => `Opción ${i}`) }];
    const r = await buildFormPdf({ name: `${long} ${long}`, description: long.repeat(5), variables, steps, attachmentSpecs: [] });
    expect(r.pageCount).toBe(1);
    expect(r.fields[0]!.x + r.fields[0]!.w).toBeLessThanOrEqual(1);
    await expect(PDFDocument.load(r.pdf)).resolves.toBeDefined();
  });

  it('wrapText: no excede el ancho, parte palabras largas y recorta con «…»', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrapText(font, 'a'.repeat(300), 10, 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(100.01);
    const cut = wrapText(font, 'palabra '.repeat(100), 10, 100, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1]!.endsWith('…')).toBe(true);
    expect(font.widthOfTextAtSize(cut[1]!, 10)).toBeLessThanOrEqual(100.01);
  });

  it('tantos pasos como el flujo permite (20) caben y cada uno tiene su caja', async () => {
    const many: FlowStep[] = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, label: `Paso ${i + 1} con un nombre bastante largo para envolver`, who: { type: 'initiator' }, role: 'FIRMANTE' }));
    const r = await buildFormPdf({ name: 'F', variables: vars(3), steps: many, attachmentSpecs: specs });
    expect(r.signatureBoxes).toHaveLength(20);
    expect(r.signatureBoxes.every((b) => b.page <= r.pageCount)).toBe(true);
  });
});
