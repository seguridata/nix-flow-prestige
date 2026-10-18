/** Archivos mínimos pero REALES (firmas mágicas válidas) para probar la detección por contenido. Solo para specs. */
import { createHash } from 'node:crypto';

export const pdfBytes = (extra = ''): Buffer => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
export const pngBytes = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDR-fake-body')]);
export const jpegBytes = (): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-fake-body')]);
export const exeBytes = (): Buffer => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 1)]);
export const elfBytes = (): Buffer => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, 1)]);
export const htmlBytes = (): Buffer => Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>');
export const svgBytes = (): Buffer => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const scriptBytes = (): Buffer => Buffer.from('#!/bin/sh\nrm -rf /\n');
export const textBytes = (): Buffer => Buffer.from('Cotización: 1,200.00 MXN\nProveedor: Ñandú S.A.\n', 'utf8');

/** ZIP con las entradas (vacías) indicadas: lo justo para que el directorio central las liste. */
export function zipOf(names: string[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const n of names) {
    const name = Buffer.from(n, 'utf8');
    const lh = Buffer.alloc(30 + name.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(name.length, 26);
    name.copy(lh, 30);
    const ch = Buffer.alloc(46 + name.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    name.copy(ch, 46);
    locals.push(lh);
    centrals.push(ch);
    offset += lh.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export const xlsxBytes = (): Buffer => zipOf(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
export const docxBytes = (): Buffer => zipOf(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
export const xlsmBytes = (): Buffer => zipOf(['[Content_Types].xml', 'xl/workbook.xml', 'xl/vbaProject.bin']);
export const zipWithExe = (): Buffer => zipOf(['[Content_Types].xml', 'word/document.xml', 'word/embeddings/payload.exe']);
export const genericZip = (): Buffer => zipOf(['readme.txt', 'virus.bin']);

export const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Redis en memoria con los comandos que usa el servicio (SET NX/EX, conjuntos, ZSET). */
export class FakeRedis {
  kv = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  z = new Map<string, Map<string, number>>();
  async get(k: string) { return this.kv.get(k) ?? null; }
  async mget(...ks: string[]) { return ks.map((k) => this.kv.get(k) ?? null); }
  async set(k: string, v: string, ...args: unknown[]) {
    if (args.includes('NX') && this.kv.has(k)) return null;
    this.kv.set(k, v);
    return 'OK';
  }
  async del(...ks: string[]) { let n = 0; for (const k of ks) { if (this.kv.delete(k)) n++; if (this.sets.delete(k)) n++; } return n; }
  async exists(k: string) { return this.kv.has(k) ? 1 : 0; }
  async sadd(k: string, m: string) { const s = this.sets.get(k) ?? new Set(); s.add(m); this.sets.set(k, s); return 1; }
  async srem(k: string, m: string) { return this.sets.get(k)?.delete(m) ? 1 : 0; }
  async scard(k: string) { return this.sets.get(k)?.size ?? 0; }
  async expire() { return 1; }
  async zadd(k: string, score: number, m: string) { const z = this.z.get(k) ?? new Map(); z.set(m, score); this.z.set(k, z); return 1; }
  async zrem(k: string, m: string) { return this.z.get(k)?.delete(m) ? 1 : 0; }
  async zrangebyscore(k: string, _min: string, max: number, _l: string, off: number, count: number) {
    return [...(this.z.get(k) ?? new Map()).entries()].filter(([, s]) => s <= max).sort((a, b) => a[1] - b[1]).map(([m]) => m).slice(off, off + count);
  }
}
