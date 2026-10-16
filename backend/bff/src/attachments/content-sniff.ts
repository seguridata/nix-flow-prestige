import type { AttachmentAccept } from './attachment-specs';

/**
 * ADR-008 §7 — tipo REAL de un anexo por su contenido (firmas mágicas), nunca por extensión ni por el mimetype
 * que declare el cliente. Lo que no se reconoce como una de las clases seguras se rechaza.
 */
export type DetectedKind = 'pdf' | 'image' | 'excel' | 'word' | 'text';

export interface DetectedType {
  kind: DetectedKind;
  mime: string;
  ext: string;
}

export type SniffResult =
  | ({ ok: true } & DetectedType)
  | { ok: false; reason: 'empty' | 'dangerous' | 'unknown'; detail: string };

export const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  txt: 'text/plain',
} as const;

/** Tipos MIME que `DocumentsService.create` acepta para un anexo. */
export const ATTACHMENT_MIMES: ReadonlySet<string> = new Set(Object.values(MIME));

const startsWith = (b: Buffer, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** Extensiones que nunca deben viajar dentro de un contenedor Office/ZIP. */
const EXEC_EXT_RE = /\.(exe|dll|bat|cmd|com|scr|msi|js|jse|vbs|vbe|wsf|ps1|jar|sh|lnk|hta|cpl)$/i;

const DANGEROUS_TEXT = [/<\s*script/i, /<\s*html/i, /<\s*svg/i, /<\?php/i, /<!doctype\s+html/i, /javascript:/i, /<\s*iframe/i, /<\s*object/i];

/** Nombres de las entradas del directorio central de un ZIP (sin descomprimir nada). */
function zipEntryNames(b: Buffer): string[] | null {
  // EOCD: busca la firma 0x06054b50 en los últimos 64 KB + 22 bytes.
  const from = Math.max(0, b.length - 65_557);
  let eocd = -1;
  for (let i = b.length - 22; i >= from; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < Math.min(total, 10_000); n++) {
    if (off + 46 > b.length || b.readUInt32LE(off) !== 0x02014b50) return null;
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    if (off + 46 + nameLen > b.length) return null;
    names.push(b.toString('utf8', off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function sniffText(b: Buffer): SniffResult {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return { ok: false, reason: 'unknown', detail: 'El archivo no es de un tipo permitido' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b.length > 1_000_000 ? b.subarray(0, 1_000_000) : b);
  } catch {
    return { ok: false, reason: 'unknown', detail: 'El archivo no es de un tipo permitido' };
  }
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('<') || DANGEROUS_TEXT.some((re) => re.test(text.slice(0, 65_536)))) {
    return { ok: false, reason: 'dangerous', detail: 'No se permiten archivos HTML, SVG, XML ni scripts' };
  }
  const odd = [...text.slice(0, 8192)].filter((c) => {
    const k = c.charCodeAt(0);
    return k < 9 || (k > 13 && k < 32);
  }).length;
  if (odd > 0) return { ok: false, reason: 'unknown', detail: 'El archivo no es de un tipo permitido' };
  return { ok: true, kind: 'text', mime: MIME.txt, ext: 'txt' };
}

/** Clasifica `b` por contenido. Puro y sin efectos: se puede llamar en el staging y otra vez al crear la solicitud. */
export function sniffContent(b: Buffer): SniffResult {
  if (!b || b.length === 0) return { ok: false, reason: 'empty', detail: 'El archivo está vacío' };

  // Ejecutables y scripts, sea cual sea la extensión con la que lleguen.
  if (
    startsWith(b, [0x4d, 0x5a]) || // MZ (exe, dll)
    startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(b, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O fat / clase Java
    startsWith(b, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(b, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(b, [0x23, 0x21]) // #!
  ) {
    return { ok: false, reason: 'dangerous', detail: 'No se permiten archivos ejecutables ni scripts' };
  }

  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    // %PDF-  — acciones activas dentro del PDF.
    const raw = b.toString('latin1');
    if (/\/Launch\b/.test(raw) || /\/JavaScript\b/.test(raw)) {
      return { ok: false, reason: 'dangerous', detail: 'El PDF contiene acciones activas (JavaScript o ejecución de programas)' };
    }
    return { ok: true, kind: 'pdf', mime: MIME.pdf, ext: 'pdf' };
  }
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, kind: 'image', mime: MIME.png, ext: 'png' };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { ok: true, kind: 'image', mime: MIME.jpeg, ext: 'jpg' };
  if (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') {
    return { ok: true, kind: 'image', mime: MIME.gif, ext: 'gif' };
  }
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ok: true, kind: 'image', mime: MIME.webp, ext: 'webp' };
  }

  // OOXML (ZIP).
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipEntryNames(b);
    if (!names) return { ok: false, reason: 'unknown', detail: 'El archivo comprimido está dañado o no es un documento de Office' };
    if (names.some((n) => /vbaProject\.bin$/i.test(n))) {
      return { ok: false, reason: 'dangerous', detail: 'No se permiten documentos con macros' };
    }
    if (names.some((n) => EXEC_EXT_RE.test(n))) {
      return { ok: false, reason: 'dangerous', detail: 'El documento contiene archivos ejecutables' };
    }
    if (names.includes('[Content_Types].xml')) {
      if (names.includes('word/document.xml')) return { ok: true, kind: 'word', mime: MIME.docx, ext: 'docx' };
      if (names.includes('xl/workbook.xml')) return { ok: true, kind: 'excel', mime: MIME.xlsx, ext: 'xlsx' };
    }
    return { ok: false, reason: 'unknown', detail: 'Solo se permiten documentos de Word y Excel; no otros archivos comprimidos' };
  }

  // Office 97-2003 (OLE2).
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (b.includes(Buffer.from('VBA', 'utf16le'))) {
      return { ok: false, reason: 'dangerous', detail: 'No se permiten documentos con macros' };
    }
    if (b.includes(Buffer.from('WordDocument', 'utf16le'))) return { ok: true, kind: 'word', mime: MIME.doc, ext: 'doc' };
    if (b.includes(Buffer.from('Workbook', 'utf16le')) || b.includes(Buffer.from('Book', 'utf16le'))) {
      return { ok: true, kind: 'excel', mime: MIME.xls, ext: 'xls' };
    }
    return { ok: false, reason: 'unknown', detail: 'El archivo no es de un tipo permitido' };
  }

  return sniffText(b);
}

/** ¿El tipo detectado entra en lo que la especificación acepta? (`any` acepta todo lo reconocido como seguro). */
export function acceptedBy(kind: DetectedKind, accept: readonly AttachmentAccept[]): boolean {
  if (accept.includes('any')) return true;
  return kind !== 'text' && accept.includes(kind);
}
