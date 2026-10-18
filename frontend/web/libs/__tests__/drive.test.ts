import { describe, expect, it } from "vitest";

import { buildEntries, caseTitleFromFilename, formatBytes, plural } from "@/libs/drive";
import type { DriveCase, DriveFolder } from "@/services/drive-service";

const folder = (id: string, name: string, itemCount = 0): DriveFolder => ({ id, name, parentId: null, itemCount });
const kase = (id: string, title: string, over: Partial<DriveCase> = {}): DriveCase => ({
  id,
  title,
  status: "ABIERTO",
  loose: false,
  createdAt: "2026-10-05T00:00:00Z",
  documentCount: 1,
  firstDocument: null,
  ...over,
});

describe("buildEntries", () => {
  it("ordena como el explorador: carpetas, expedientes y luego documentos", () => {
    const entries = buildEntries(
      [folder("f2", "Zeta"), folder("f1", "Álamo")],
      [
        kase("d", "x", { loose: true, firstDocument: { id: "doc", filename: "Acta.pdf", mimeType: "application/pdf", sizeBytes: 2048 } }),
        kase("c", "Contrato Torre Norte"),
      ],
    );
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "folder:Álamo",
      "folder:Zeta",
      "case:Contrato Torre Norte",
      "document:Acta.pdf",
    ]);
  });

  it("filtra sin distinguir mayúsculas ni acentos", () => {
    const entries = buildEntries([folder("f", "Vacaciones")], [kase("c", "Nómina octubre")], "NOMINA");
    expect(entries.map((e) => e.name)).toEqual(["Nómina octubre"]);
  });

  it("describe el contenido en singular y plural", () => {
    const [empty, one, many] = buildEntries([folder("a", "A"), folder("b", "B", 1), folder("c", "C", 3)], []);
    expect([empty!.detail, one!.detail, many!.detail]).toEqual(["Vacía", "1 elemento", "3 elementos"]);
  });

  it("un documento suelto sin archivo cae al título del expediente", () => {
    const [doc] = buildEntries([], [kase("d", "Suelto", { loose: true })]);
    expect(doc).toMatchObject({ kind: "document", name: "Suelto" });
  });
});

describe("utilidades", () => {
  it("plural y tamaños", () => {
    expect(plural(1, "documento", "documentos")).toBe("1 documento");
    expect(plural(0, "documento", "documentos")).toBe("0 documentos");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("sugiere el título del expediente desde el nombre del archivo", () => {
    expect(caseTitleFromFilename("Contrato_arrendamiento.pdf")).toBe("Contrato arrendamiento");
    expect(caseTitleFromFilename("a.pdf")).toBe("Expediente a");
  });
});
