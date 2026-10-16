import { describe, expect, it } from "vitest";

import {
  acceptAttribute,
  attachmentErrorsFrom,
  attachmentStatus,
  effectiveMin,
  fileMatches,
  formatBytes,
  specProblems,
  unmetSpecs,
  validateFile,
  type AttachmentSpec,
} from "@/libs/attachments";

const spec = (o: Partial<AttachmentSpec> = {}): AttachmentSpec => ({
  key: "cotizaciones",
  label: "Cotizaciones",
  required: true,
  min: 3,
  max: 5,
  accept: ["pdf", "image"],
  maxSizeMB: 2,
  ...o,
});
const MB = 1024 * 1024;
const file = (name: string, size = 1000, type = "") => ({ name, size, type });

describe("tipos aceptados", () => {
  it("por extensión o por tipo MIME, sin distinguir mayúsculas", () => {
    expect(fileMatches(spec(), file("a.PDF"))).toBe(true);
    expect(fileMatches(spec(), file("foto", 10, "image/png"))).toBe(true);
    expect(fileMatches(spec(), file("a.xlsx"))).toBe(false);
    expect(fileMatches(spec({ accept: ["excel"] }), file("a.xlsx"))).toBe(true);
    expect(fileMatches(spec({ accept: ["word"] }), file("x", 1, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).toBe(true);
    expect(fileMatches(spec({ accept: ["any"] }), file("loquesea.exe"))).toBe(true);
  });
  it("atributo accept del input", () => {
    expect(acceptAttribute(spec({ accept: ["pdf"] }))).toBe(".pdf,application/pdf");
    expect(acceptAttribute(spec({ accept: ["image"] }))).toContain("image/*");
    expect(acceptAttribute(spec({ accept: ["any"] }))).toBe("");
  });
});

describe("validateFile", () => {
  it("acepta un archivo que cumple", () => {
    expect(validateFile(spec(), file("a.pdf", MB), 0)).toBeNull();
  });
  it("rechaza tipo, tamaño, vacío y máximo, en español y con el nombre del archivo", () => {
    expect(validateFile(spec(), file("a.docx"), 0)).toMatch(/«a\.docx» no es un tipo permitido\. Se aceptan: PDF, Imágenes/);
    expect(validateFile(spec(), file("a.pdf", 3 * MB), 0)).toMatch(/pesa 3\.0 MB y el máximo es 2 MB/);
    expect(validateFile(spec(), file("a.pdf", 0), 0)).toMatch(/está vacío/);
    expect(validateFile(spec(), file("a.pdf"), 5)).toMatch(/máximo de 5 archivos/);
    expect(validateFile(spec({ max: 1 }), file("a.pdf"), 1)).toMatch(/máximo de 1 archivo en/);
  });
  it("el tamaño exacto del límite cabe", () => {
    expect(validateFile(spec(), file("a.pdf", 2 * MB), 0)).toBeNull();
  });
});

describe("contador y mínimos", () => {
  it("«2 de 3 cotizaciones requeridas»", () => {
    const s = attachmentStatus(spec(), 2);
    expect(s.text).toBe("2 de 3 cotizaciones requeridas");
    expect(s).toMatchObject({ met: false, missing: 1, atMax: false });
  });
  it("cumple al llegar al mínimo y sigue cumpliendo hasta el máximo", () => {
    expect(attachmentStatus(spec(), 3)).toMatchObject({ met: true, missing: 0, atMax: false });
    expect(attachmentStatus(spec(), 5)).toMatchObject({ met: true, atMax: true });
    expect(attachmentStatus(spec(), 5).text).toBe("3 de 3 cotizaciones requeridas");
  });
  it("obligatorio pide al menos uno aunque min sea 0; opcional con min 0 siempre cumple", () => {
    expect(effectiveMin(spec({ min: 0 }))).toBe(1);
    expect(attachmentStatus(spec({ min: 0 }), 0).met).toBe(false);
    const opt = spec({ required: false, min: 0 });
    expect(attachmentStatus(opt, 0)).toMatchObject({ met: true, text: "Opcional: sin archivos" });
    expect(attachmentStatus(opt, 2).text).toBe("2 archivos cargados (opcional)");
  });
  it("no deja enviar hasta cumplir los mínimos de todas las especificaciones", () => {
    const specs = [spec(), spec({ key: "comprobante", label: "Comprobante", min: 1, max: 1 }), spec({ key: "extra", required: false, min: 0 })];
    expect(unmetSpecs(specs, { cotizaciones: 3, comprobante: 0 }).map((s) => s.key)).toEqual(["comprobante"]);
    expect(unmetSpecs(specs, { cotizaciones: 3, comprobante: 1 })).toEqual([]);
    expect(unmetSpecs(specs, {}).map((s) => s.key)).toEqual(["cotizaciones", "comprobante"]);
  });
});

describe("especificación del administrador", () => {
  it("una especificación correcta no da problemas", () => {
    expect(specProblems([spec()])).toEqual([]);
  });
  it("etiqueta, clave, repetidas, rangos, tipos y tamaño", () => {
    const text = specProblems([
      spec({ label: " ", key: "1mal" }),
      spec({ key: "dup", label: "A", min: 4, max: 2 }),
      spec({ key: "dup", label: "B", accept: [], maxSizeMB: 26, max: 21 }),
    ]).join("|");
    expect(text).toMatch(/El anexo 1 necesita una etiqueta/);
    expect(text).toMatch(/la clave debe empezar con letra/);
    expect(text).toMatch(/«B»: la clave «dup» está repetida/);
    expect(text).toMatch(/el mínimo no puede ser mayor que el máximo/);
    expect(text).toMatch(/elige al menos un tipo de archivo/);
    expect(text).toMatch(/el tamaño máximo va de 1 a 25 MB/);
    expect(text).toMatch(/el máximo es 20 archivos/);
  });
  it("máximo 10 anexos", () => {
    const many = Array.from({ length: 11 }, (_, i) => spec({ key: `a${i}`, label: `A${i}` }));
    expect(specProblems(many)).toContain("Máximo 10 anexos por formato.");
  });
});

describe("errores del servidor por anexo", () => {
  it("lista de objetos, mapa y `attachments`", () => {
    expect(attachmentErrorsFrom({ errors: [{ specKey: "cotizaciones", message: "Faltan 2." }, { key: "x", message: ["a", "b"] }] })).toEqual({
      cotizaciones: "Faltan 2.",
      x: "a b",
    });
    expect(attachmentErrorsFrom({ attachments: { cotizaciones: "Mal tipo." } })).toEqual({ cotizaciones: "Mal tipo." });
    expect(attachmentErrorsFrom({ errors: { comprobante: "Falta." } })).toEqual({ comprobante: "Falta." });
  });
  it("ignora lo que no tiene forma de error por anexo", () => {
    expect(attachmentErrorsFrom(undefined)).toEqual({});
    expect(attachmentErrorsFrom({ message: "x", errors: ["suelto"] })).toEqual({});
  });
});

describe("formatBytes", () => {
  it("unidades legibles", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(150 * 1024)).toBe("150 KB");
    expect(formatBytes(3 * MB)).toBe("3.0 MB");
  });
});
