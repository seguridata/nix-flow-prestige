import { Injectable, Logger } from '@nestjs/common';
import { createWorker, type Worker } from 'tesseract.js';

export interface IneOcrFields {
  curp?: string;
  claveElector?: string;
  nombre?: string;
  seccion?: string;
  vigencia?: string; // año
  mrz?: string[];
}

export interface IneOcrResult {
  engine: 'tesseract.js';
  lang: string;
  confidence: number;
  rawFront?: string;
  rawBack?: string;
  fields: IneOcrFields;
}

const CURP_IN_TEXT = /\b([A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d)\b/;
const CLAVE_ELECTOR = /\b([A-Z]{6}\d{8}[HM]\d{3})\b/;
const VIGENCIA = /VIGENCIA\D{0,8}(20\d{2})/i;
const SECCION = /SECC?I[ÓO]N\D{0,4}(\d{3,4})/i;

/**
 * M16 — OCR/MRZ real de la INE con `tesseract.js` (WASM, sin binarios nativos).
 * `TESSERACT_LANG_PATH` para servir los `.traineddata` en local/aire-gap;
 * por defecto los baja del CDN de tessdata la primera vez.
 */
@Injectable()
export class OcrService {
  private readonly log = new Logger(OcrService.name);
  private workerPromise: Promise<Worker> | null = null;

  private worker(): Promise<Worker> {
    if (!this.workerPromise) {
      const lang = process.env.TESSERACT_LANG ?? 'spa';
      this.workerPromise = createWorker(lang, 1, {
        langPath: process.env.TESSERACT_LANG_PATH,
        cachePath: process.env.TESSERACT_CACHE_PATH,
        logger: () => undefined,
        errorHandler: (e) => this.log.warn(`tesseract: ${String(e)}`),
      });
    }
    return this.workerPromise;
  }

  private parseMrz(text: string): string[] | undefined {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, '').toUpperCase())
      .filter((l) => /^[A-Z0-9<]{25,}$/.test(l) && l.includes('<'));
    return lines.length >= 2 ? lines.slice(-3) : undefined;
  }

  private extract(front: string, back: string): IneOcrFields {
    const all = `${front}\n${back}`.toUpperCase();
    const compact = all.replace(/\s+/g, '');
    const f: IneOcrFields = {};
    f.curp = compact.match(CURP_IN_TEXT)?.[1] ?? all.match(CURP_IN_TEXT)?.[1];
    f.claveElector = compact.match(CLAVE_ELECTOR)?.[1] ?? all.match(CLAVE_ELECTOR)?.[1];
    f.vigencia = all.match(VIGENCIA)?.[1];
    f.seccion = all.match(SECCION)?.[1];
    const nombreLine = front
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /NOMBRE/i.test(l));
    if (nombreLine) f.nombre = nombreLine.replace(/.*NOMBRE\s*:?/i, '').trim() || undefined;
    const mrz = this.parseMrz(back);
    if (mrz) f.mrz = mrz;
    return f;
  }

  async recognizeIne(input: { front?: Buffer; back?: Buffer }): Promise<IneOcrResult> {
    const worker = await this.worker();
    let rawFront: string | undefined;
    let rawBack: string | undefined;
    let confSum = 0;
    let confN = 0;

    if (input.front?.length) {
      const r = await worker.recognize(input.front);
      rawFront = r.data.text;
      confSum += r.data.confidence;
      confN += 1;
    }
    if (input.back?.length) {
      const r = await worker.recognize(input.back);
      rawBack = r.data.text;
      confSum += r.data.confidence;
      confN += 1;
    }

    return {
      engine: 'tesseract.js',
      lang: process.env.TESSERACT_LANG ?? 'spa',
      confidence: confN ? Number((confSum / confN).toFixed(1)) : 0,
      rawFront,
      rawBack,
      fields: this.extract(rawFront ?? '', rawBack ?? ''),
    };
  }

  async onModuleDestroy() {
    if (this.workerPromise) {
      const w = await this.workerPromise.catch(() => null);
      await w?.terminate().catch(() => undefined);
    }
  }
}
