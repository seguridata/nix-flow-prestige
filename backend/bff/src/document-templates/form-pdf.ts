import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { AttachmentSpec } from '../attachments/attachment-specs';
import type { FlowStep, FlowVariable } from '../flow/flow.types';
import { sanitizeWinAnsi } from './pdf-fill';
import type { SignatureBox, TemplateField } from './template.types';

/**
 * ADR-008 §7 — hoja base de un formato DIGITAL (`kind:'FORM'`): el administrador no sube PDF, el sistema lo genera
 * a partir de las variables, las especificaciones de anexos y los pasos del flujo, y calcula a la vez los `fields`
 * y `signatureBoxes` (fracciones 0..1, origen arriba-izquierda) que consumen `fillPdf`, el alta y `instantiate`.
 *
 * Helvetica (WinAnsi) cubre el español completo (á é í ó ú ñ ü ¿ ¡). Lo que no cabe en WinAnsi se cambia por «?»
 * y el texto largo se envuelve o se recorta con «…»: nada se sale de su caja ni de la página.
 */
export interface FormPdfInput {
  name: string;
  description?: string | null;
  variables: FlowVariable[];
  steps: FlowStep[];
  attachmentSpecs: AttachmentSpec[];
}

export interface FormPdfResult {
  pdf: Buffer;
  pageCount: number;
  fields: TemplateField[];
  signatureBoxes: SignatureBox[];
}

// A4 en puntos.
const PW = 595.28;
const PH = 841.89;
const M = 40;
const CW = PW - 2 * M;
const FOOTER = 26;
const BOTTOM = PH - M - FOOTER;
const LABEL_W = 190;
const GAP = 10;
const BOX_X = M + LABEL_W + GAP;
const BOX_W = CW - LABEL_W - GAP;
const FIELD_H = 22;
const SIGN_H = 56;
const SIGN_COL_W = (CW - 20) / 2;

const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.62, 0.62, 0.62);
const ACCENT = rgb(0.52, 0.74, 0);

const ACCEPT_LABEL: Record<string, string> = { pdf: 'PDF', image: 'imagen', excel: 'Excel', word: 'Word', any: 'cualquier tipo permitido' };

/** Parte `text` en líneas de ancho ≤ `maxW`; palabras más largas que la línea se parten por caracteres. */
export function wrapText(font: PDFFont, rawText: string, size: number, maxW: number, maxLines = Infinity): string[] {
  // Tope de entrada: una etiqueta enorme no debe costar O(n²) en medir el ancho; con `maxLines` no se verá más de todos modos.
  const text = sanitizeWinAnsi(font, rawText.slice(0, 1500)).trim();
  const width = (t: string) => font.widthOfTextAtSize(t, size);
  const lines: string[] = [];
  let cur = '';
  const push = (l: string) => lines.push(l);
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (width(w) > maxW) {
      // Parte la palabra en el último carácter que cabe.
      let n = w.length;
      while (n > 1 && width(w.slice(0, n)) > maxW) n -= 1;
      if (cur) {
        push(cur);
        cur = '';
      }
      push(w.slice(0, n));
      w = w.slice(n);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (width(next) <= maxW) cur = next;
    else {
      push(cur);
      cur = w;
    }
  }
  if (cur) push(cur);
  if (lines.length === 0) return [''];
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && width(`${last}…`) > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = sanitizeWinAnsi(font, `${last}…`);
    return kept;
  }
  return lines;
}

export async function buildFormPdf(input: FormPdfInput): Promise<FormPdfResult> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(sanitizeWinAnsi(font, input.name));
  pdf.setProducer('Prestige');

  const pages: PDFPage[] = [];
  const fields: TemplateField[] = [];
  const boxes: SignatureBox[] = [];
  let page!: PDFPage;
  let y = M; // desde arriba
  const title = sanitizeWinAnsi(bold, input.name);

  const text = (t: string, x: number, top: number, size: number, f: PDFFont = font, color = INK) => {
    // `top` es la parte alta de la línea; pdf-lib dibuja desde la línea base.
    page.drawText(sanitizeWinAnsi(f, t), { x, y: PH - top - size * 0.8, size, font: f, color });
  };
  const rect = (x: number, top: number, w: number, h: number) => {
    page.drawRectangle({ x, y: PH - top - h, width: w, height: h, borderColor: LINE, borderWidth: 0.7 });
  };
  const rule = (top: number) => {
    page.drawLine({ start: { x: M, y: PH - top }, end: { x: PW - M, y: PH - top }, thickness: 1.2, color: ACCENT });
  };
  const newPage = (continued: boolean) => {
    page = pdf.addPage([PW, PH]);
    pages.push(page);
    y = M;
    if (continued) {
      const t = wrapText(bold, `${input.name} (continúa)`, 11, CW, 1)[0];
      text(t, M, y, 11, bold, MUTED);
      y += 16;
      rule(y);
      y += 14;
    }
  };
  /** Reserva `h` puntos; si no caben en la página, abre otra. */
  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage(true);
  };
  const heading = (label: string, keepWith: number) => {
    ensure(22 + keepWith);
    text(label, M, y, 11.5, bold);
    y += 18;
  };

  // ── Encabezado.
  newPage(false);
  const titleLines = wrapText(bold, title, 18, CW, 3);
  for (const l of titleLines) {
    text(l, M, y, 18, bold);
    y += 23;
  }
  y += 2;
  if (input.description?.trim()) {
    for (const l of wrapText(font, input.description, 9.5, CW, 4)) {
      text(l, M, y, 9.5, font, MUTED);
      y += 12.5;
    }
    y += 2;
  }
  rule(y);
  y += 16;

  // ── Variables: una fila por variable (etiqueta a la izquierda, caja de valor a la derecha).
  if (input.variables.length) {
    heading('Datos del formato', 40);
    for (const v of input.variables) {
      const label = wrapText(font, `${v.label}${v.required ? ' *' : ''}`, 9.5, LABEL_W, 3);
      const opts =
        v.type === 'select' && v.options?.length ? wrapText(font, `Opciones: ${v.options.join(' / ')}`, 7.5, LABEL_W, 2) : [];
      const hint = v.type === 'date' ? ['Formato AAAA-MM-DD'] : v.type === 'number' ? ['Solo número'] : [];
      const sub = [...opts, ...hint];
      const textH = label.length * 12 + sub.length * 9.5;
      const rowH = Math.max(FIELD_H, textH);
      ensure(rowH + 8);
      label.forEach((l, i) => text(l, M, y + i * 12 + 4, 9.5));
      sub.forEach((l, i) => text(l, M, y + label.length * 12 + i * 9.5 + 4, 7.5, font, MUTED));
      rect(BOX_X, y, BOX_W, FIELD_H);
      fields.push({
        key: v.key,
        label: v.label,
        type: v.type,
        required: v.required,
        ...(v.type === 'select' && v.options ? { options: v.options } : {}),
        page: pages.length,
        x: BOX_X / PW,
        y: y / PH,
        w: BOX_W / PW,
        h: FIELD_H / PH,
        fontSize: 10,
      });
      y += rowH + 8;
    }
    y += 6;
  }

  // ── Anexos: la lista de lo que se pide y cuántos.
  if (input.attachmentSpecs.length) {
    heading('Anexos', 36);
    for (const s of input.attachmentSpecs) {
      const count = s.min === s.max ? `${s.max}` : s.min > 0 ? `de ${s.min} a ${s.max}` : `hasta ${s.max}`;
      const kinds = s.accept.map((a) => ACCEPT_LABEL[a] ?? a).join(', ');
      const head = wrapText(bold, `${s.label} — ${s.required ? 'obligatorio' : 'opcional'}`, 9.5, CW - 12, 2);
      const detail = wrapText(
        font,
        `Se piden ${count} archivo(s) · ${kinds} · máx. ${s.maxSizeMB} MB cada uno`,
        8.5,
        CW - 12,
        2,
      );
      const help = s.help ? wrapText(font, s.help, 8.5, CW - 12, 3) : [];
      const h = head.length * 12 + detail.length * 11 + help.length * 11 + 6;
      ensure(h + 6);
      page.drawCircle({ x: M + 3, y: PH - y - 7, size: 1.8, color: ACCENT });
      head.forEach((l, i) => text(l, M + 12, y + 2 + i * 12, 9.5, bold));
      detail.forEach((l, i) => text(l, M + 12, y + 2 + head.length * 12 + i * 11, 8.5, font, MUTED));
      help.forEach((l, i) => text(l, M + 12, y + 2 + head.length * 12 + detail.length * 11 + i * 11, 8.5, font, MUTED));
      y += h + 6;
    }
    y += 6;
  }

  // ── Firmas: una caja por paso del flujo, en dos columnas.
  heading('Firmas', SIGN_H + 40);
  for (let i = 0; i < input.steps.length; i += 2) {
    const pair = input.steps.slice(i, i + 2);
    const caps = pair.map((st) => {
      const cap = wrapText(bold, st.label, 9, SIGN_COL_W, 2);
      const sub = `${st.role === 'REVISOR' ? 'Revisor' : 'Firmante'}${(st.when?.length ?? 0) > 0 ? ' · solo si aplica' : ''}`;
      return { cap, sub };
    });
    const capH = Math.max(...caps.map((c) => c.cap.length * 10.5 + 10));
    const rowH = SIGN_H + 5 + capH + 14;
    ensure(rowH);
    pair.forEach((st, j) => {
      const x = M + j * (SIGN_COL_W + 20);
      rect(x, y, SIGN_COL_W, SIGN_H);
      caps[j].cap.forEach((l, k) => text(l, x, y + SIGN_H + 5 + k * 10.5, 9, bold));
      text(caps[j].sub, x, y + SIGN_H + 5 + caps[j].cap.length * 10.5, 7.5, font, MUTED);
      boxes.push({ stepId: st.id, page: pages.length, x: x / PW, y: y / PH, w: SIGN_COL_W / PW, h: SIGN_H / PH });
    });
    y += rowH;
  }

  // ── Pie de página.
  pages.forEach((p, i) => {
    const label = `Página ${i + 1} de ${pages.length}`;
    const w = font.widthOfTextAtSize(label, 8);
    p.drawText(label, { x: (PW - w) / 2, y: M - 4, size: 8, font, color: MUTED });
  });

  // Sin object streams: PDF clásico, más simple de firmar de forma incremental (PAdES) después.
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  return { pdf: bytes, pageCount: pages.length, fields, signatureBoxes: boxes };
}
