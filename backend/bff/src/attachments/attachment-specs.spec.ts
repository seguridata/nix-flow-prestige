import { describe, expect, it } from 'vitest';
import { parseAttachmentSpecs } from './attachment-specs';
import { acceptedBy, sniffContent } from './content-sniff';
import { sanitizeFilename } from './filename';
import {
  docxBytes, elfBytes, exeBytes, genericZip, htmlBytes, jpegBytes, pdfBytes, pngBytes, scriptBytes, svgBytes, textBytes, xlsmBytes, xlsxBytes, zipWithExe,
} from './attachments.fixtures';

const ok = { key: 'cotizaciones', label: 'Cotizaciones', required: true, min: 3, max: 5, accept: ['pdf'], maxSizeMB: 10 };

describe('parseAttachmentSpecs', () => {
  it('sin especificaciones (undefined, null o []) es válido y vacío', () => {
    expect(parseAttachmentSpecs(undefined)).toEqual({ specs: [], errors: [] });
    expect(parseAttachmentSpecs(null)).toEqual({ specs: [], errors: [] });
    expect(parseAttachmentSpecs([])).toEqual({ specs: [], errors: [] });
  });

  it('acepta una especificación válida y la normaliza', () => {
    const r = parseAttachmentSpecs([{ ...ok, help: '  tres cotizaciones  ', accept: ['pdf', 'pdf', 'any'], extra: 'x' }]);
    expect(r.errors).toEqual([]);
    expect(r.specs).toEqual([{ key: 'cotizaciones', label: 'Cotizaciones', help: 'tres cotizaciones', required: true, min: 3, max: 5, accept: ['any'], maxSizeMB: 10 }]);
  });

  it('opcional con mínimo 0 es válido', () => {
    expect(parseAttachmentSpecs([{ ...ok, required: false, min: 0 }]).errors).toEqual([]);
  });

  it('máximo 10 especificaciones', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...ok, key: `a${i}` }));
    expect(parseAttachmentSpecs(many).errors.join()).toMatch(/Máximo 10/);
    expect(parseAttachmentSpecs(many.slice(0, 10)).errors).toEqual([]);
  });

  it('claves con la regla de variable y únicas', () => {
    expect(parseAttachmentSpecs([{ ...ok, key: '1abc' }]).errors.join()).toMatch(/clave/);
    expect(parseAttachmentSpecs([{ ...ok, key: 'con espacio' }]).errors.join()).toMatch(/clave/);
    expect(parseAttachmentSpecs([{ ...ok, key: 'a'.repeat(41) }]).errors.join()).toMatch(/clave/);
    expect(parseAttachmentSpecs([{ ...ok }, { ...ok }]).errors.join()).toMatch(/repetida/);
    expect(parseAttachmentSpecs([{ ...ok, key: 'Anexo' }, { ...ok, key: 'anexo' }]).errors.join()).toMatch(/repetida/);
  });

  it('min ≤ max ≤ 20', () => {
    expect(parseAttachmentSpecs([{ ...ok, min: 6, max: 5 }]).errors.join()).toMatch(/mínimo no puede ser mayor/);
    expect(parseAttachmentSpecs([{ ...ok, min: 1, max: 21 }]).errors.join()).toMatch(/1 a 20/);
    expect(parseAttachmentSpecs([{ ...ok, min: 1, max: 20 }]).errors).toEqual([]);
    expect(parseAttachmentSpecs([{ ...ok, min: -1 }]).errors.join()).toMatch(/negativo/);
    expect(parseAttachmentSpecs([{ ...ok, min: 1.5 }]).errors.join()).toMatch(/enteros/);
  });

  it('required coherente con min', () => {
    expect(parseAttachmentSpecs([{ ...ok, required: true, min: 0 }]).errors.join()).toMatch(/obligatorio/);
    expect(parseAttachmentSpecs([{ ...ok, required: false, min: 2 }]).errors.join()).toMatch(/debe ser obligatorio/);
    expect(parseAttachmentSpecs([{ ...ok, required: 'si' }]).errors.join()).toMatch(/required/);
  });

  it('accept ⊂ pdf|image|excel|word|any y no vacío', () => {
    expect(parseAttachmentSpecs([{ ...ok, accept: ['exe'] }]).errors.join()).toMatch(/tipos aceptados/);
    expect(parseAttachmentSpecs([{ ...ok, accept: [] }]).errors.join()).toMatch(/tipos aceptados/);
    expect(parseAttachmentSpecs([{ ...ok, accept: 'pdf' }]).errors.join()).toMatch(/tipos aceptados/);
    expect(parseAttachmentSpecs([{ ...ok, accept: ['pdf', 'image', 'excel', 'word'] }]).errors).toEqual([]);
  });

  it('maxSizeMB > 0 y ≤ 25', () => {
    expect(parseAttachmentSpecs([{ ...ok, maxSizeMB: 26 }]).errors.join()).toMatch(/25 MB/);
    expect(parseAttachmentSpecs([{ ...ok, maxSizeMB: 0 }]).errors.join()).toMatch(/25 MB/);
    expect(parseAttachmentSpecs([{ ...ok, maxSizeMB: '5' }]).errors.join()).toMatch(/25 MB/);
    expect(parseAttachmentSpecs([{ ...ok, maxSizeMB: 25 }]).errors).toEqual([]);
    expect(parseAttachmentSpecs([{ ...ok, maxSizeMB: 0.5 }]).errors).toEqual([]);
  });

  it('rechaza formas inválidas', () => {
    expect(parseAttachmentSpecs({}).errors).toEqual(['Los anexos deben ser una lista']);
    expect(parseAttachmentSpecs(['x']).errors.join()).toMatch(/formato inválido/);
    expect(parseAttachmentSpecs([{ ...ok, label: '' }]).errors.join()).toMatch(/etiqueta/);
    expect(parseAttachmentSpecs([{ ...ok, help: 'x'.repeat(301) }]).errors.join()).toMatch(/ayuda/);
  });
});

describe('sniffContent: tipo real por contenido', () => {
  it('reconoce los tipos permitidos', () => {
    expect(sniffContent(pdfBytes())).toMatchObject({ ok: true, kind: 'pdf', mime: 'application/pdf', ext: 'pdf' });
    expect(sniffContent(pngBytes())).toMatchObject({ ok: true, kind: 'image', mime: 'image/png' });
    expect(sniffContent(jpegBytes())).toMatchObject({ ok: true, kind: 'image', mime: 'image/jpeg', ext: 'jpg' });
    expect(sniffContent(xlsxBytes())).toMatchObject({ ok: true, kind: 'excel', ext: 'xlsx' });
    expect(sniffContent(docxBytes())).toMatchObject({ ok: true, kind: 'word', ext: 'docx' });
    expect(sniffContent(textBytes())).toMatchObject({ ok: true, kind: 'text', mime: 'text/plain' });
  });

  it('rechaza ejecutables, scripts, html y svg aunque el contenido venga con otro nombre', () => {
    for (const b of [exeBytes(), elfBytes(), scriptBytes()]) expect(sniffContent(b)).toMatchObject({ ok: false, reason: 'dangerous' });
    for (const b of [htmlBytes(), svgBytes()]) expect(sniffContent(b)).toMatchObject({ ok: false, reason: 'dangerous' });
    expect(sniffContent(Buffer.from('  \n<?xml version="1.0"?><x/>'))).toMatchObject({ ok: false, reason: 'dangerous' });
  });

  it('rechaza macros, ejecutables dentro de un contenedor y zips genéricos', () => {
    expect(sniffContent(xlsmBytes())).toMatchObject({ ok: false, reason: 'dangerous' });
    expect(sniffContent(zipWithExe())).toMatchObject({ ok: false, reason: 'dangerous' });
    expect(sniffContent(genericZip())).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('un PDF con JavaScript o Launch se rechaza', () => {
    expect(sniffContent(pdfBytes('<< /S /JavaScript /JS (app.alert(1)) >>'))).toMatchObject({ ok: false, reason: 'dangerous' });
    expect(sniffContent(pdfBytes('<< /S /Launch /F (cmd.exe) >>'))).toMatchObject({ ok: false, reason: 'dangerous' });
  });

  it('vacío, binario desconocido y texto con NUL', () => {
    expect(sniffContent(Buffer.alloc(0))).toMatchObject({ ok: false, reason: 'empty' });
    expect(sniffContent(Buffer.from([1, 2, 3, 0, 5, 6]))).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('acceptedBy: el texto solo entra con «any»', () => {
    expect(acceptedBy('pdf', ['pdf'])).toBe(true);
    expect(acceptedBy('image', ['pdf'])).toBe(false);
    expect(acceptedBy('text', ['pdf', 'word'])).toBe(false);
    expect(acceptedBy('text', ['any'])).toBe(true);
    expect(acceptedBy('excel', ['any'])).toBe(true);
  });
});

describe('sanitizeFilename', () => {
  it('quita rutas, controles y bidi, y fuerza la extensión del tipo real', () => {
    expect(sanitizeFilename('..\\..\\etc/passwd.exe', 'pdf')).toBe('passwd.pdf');
    expect(sanitizeFilename('factura‮gpj.exe', 'pdf')).toBe('facturagpj.pdf');
    expect(sanitizeFilename('a\u0000b\nc.pdf', 'pdf')).toBe('abc.pdf');
    expect(sanitizeFilename('factura.exe.pdf', 'pdf')).toBe('factura_exe.pdf');
  });

  it('conserva acentos, repara el mojibake de multer y nunca queda vacío', () => {
    expect(sanitizeFilename('CotizaciÃ³n tecnica.pdf', 'pdf')).toBe('Cotización tecnica.pdf');
    expect(sanitizeFilename('', 'png')).toBe('anexo.png');
    expect(sanitizeFilename(undefined, 'png')).toBe('anexo.png');
    expect(sanitizeFilename('...', 'png')).toBe('anexo.png');
    expect(sanitizeFilename('con.txt', 'txt')).toBe('_con.txt');
  });

  it('acota el largo', () => {
    expect(sanitizeFilename(`${'a'.repeat(300)}.pdf`, 'pdf').length).toBeLessThanOrEqual(104);
  });
});
