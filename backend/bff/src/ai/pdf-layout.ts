import {
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFSignature,
  PDFString,
  PDFTextField,
} from 'pdf-lib';

/** Un hueco del PDF donde puede ir un dato o una firma. Su posición sale del PDF, no del modelo. */
export interface Candidate {
  id: string;
  kind: 'text' | 'dropdown' | 'signature';
  /** Nombre interno del campo en el PDF (a menudo ya es descriptivo). */
  name: string;
  /** Texto de ayuda del campo (`/TU`), si lo trae. */
  tooltip?: string;
  /** Página, desde 1. */
  page: number;
  /** Fracciones 0..1 con origen arriba-izquierda, el mismo sistema que usa `fillPdf`. */
  x: number;
  y: number;
  w: number;
  h: number;
  options?: string[];
}

export interface LayoutResult {
  pageCount: number;
  candidates: Candidate[];
  warnings: string[];
}

export const MAX_CANDIDATES = 100;

/** El archivo no se pudo leer como PDF. Es un error del usuario (400), no del servidor. */
export class PdfLayoutError extends Error {}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number) => Math.round(clamp01(n) * 10_000) / 10_000;

/**
 * Detecta de forma determinista dónde están los campos de formulario (AcroForm) de un PDF.
 * Solo lee estructura: no extrae ni devuelve el contenido del documento.
 */
export async function extractCandidates(bytes: Buffer): Promise<LayoutResult> {
  try {
    return await readLayout(bytes);
  } catch (e) {
    if (e instanceof PdfLayoutError) throw e;
    // pdf-lib lanza errores de todo tipo con archivos dañados; para quien sube el PDF es siempre lo mismo.
    throw new PdfLayoutError('No se pudo leer el PDF: puede estar dañado o tener una estructura que no se admite.');
  }
}

async function readLayout(bytes: Buffer): Promise<LayoutResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch {
    throw new PdfLayoutError('El archivo no es un PDF válido o está protegido con contraseña.');
  }
  const pages = doc.getPages();
  const warnings: string[] = [];

  // Qué página contiene cada anotación (widget), por identidad del diccionario.
  const pageOf = new WeakMap<object, number>();
  pages.forEach((page, i) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const dict = annots.lookupMaybe(k, PDFDict);
      if (dict) pageOf.set(dict, i);
    }
  });

  const found: Omit<Candidate, 'id'>[] = [];
  for (const field of doc.getForm().getFields()) {
    const name = field.getName();
    const kind: Candidate['kind'] | null =
      field instanceof PDFSignature ? 'signature' : field instanceof PDFTextField ? 'text' : field instanceof PDFDropdown ? 'dropdown' : null;
    if (!kind) {
      warnings.push(`«${name}» es de un tipo que todavía no se admite (casilla, opción o botón) y se omitió.`);
      continue;
    }
    const widgets = field.acroField.getWidgets();
    const widget = widgets[0];
    if (!widget) continue;
    if (widgets.length > 1) warnings.push(`«${name}» aparece en ${widgets.length} lugares; solo se usó el primero.`);

    const pageIndex = pageOf.get(widget.dict);
    const page = pageIndex === undefined ? undefined : pages[pageIndex];
    if (pageIndex === undefined || !page) {
      warnings.push(`No se pudo ubicar «${name}» en una página y se omitió.`);
      continue;
    }
    if (page.getRotation().angle % 360 !== 0) warnings.push(`La página ${pageIndex + 1} está rotada; revisa la posición de «${name}».`);

    const mb = page.getMediaBox();
    const r = widget.getRectangle();
    if (r.width <= 0 || r.height <= 0) continue;
    const tu = field.acroField.dict.lookupMaybe(PDFName.of('TU'), PDFString, PDFHexString);

    found.push({
      kind,
      name,
      ...(tu ? { tooltip: tu.decodeText().slice(0, 200) } : {}),
      page: pageIndex + 1,
      x: round((r.x - mb.x) / mb.width),
      y: round((mb.height - (r.y - mb.y) - r.height) / mb.height),
      w: round(r.width / mb.width),
      h: round(r.height / mb.height),
      ...(field instanceof PDFDropdown ? { options: field.getOptions() } : {}),
    });
  }

  if (!found.length) {
    warnings.push('Este PDF no tiene campos de formulario. Por ahora la IA solo detecta posiciones en PDFs con campos; en los demás hay que ubicarlos a mano.');
  }
  found.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  if (found.length > MAX_CANDIDATES) {
    warnings.push(`El PDF tiene ${found.length} campos; solo se consideraron los primeros ${MAX_CANDIDATES}.`);
    found.length = MAX_CANDIDATES;
  }
  return { pageCount: pages.length, candidates: found.map((c, i) => ({ id: `c${i + 1}`, ...c })), warnings };
}
