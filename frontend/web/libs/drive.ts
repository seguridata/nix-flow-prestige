import type { DriveCase, DriveFolder } from "@/services/drive-service";

export type DriveEntry =
  | { kind: "folder"; id: string; name: string; detail: string; folder: DriveFolder }
  | { kind: "case"; id: string; name: string; detail: string; item: DriveCase }
  | { kind: "document"; id: string; name: string; detail: string; item: DriveCase };

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const collator = new Intl.Collator("es-MX", { sensitivity: "base", numeric: true });

/**
 * Une carpetas, expedientes y documentos sueltos en una sola lista, como el explorador de Windows:
 * primero las carpetas, luego los expedientes y al final los documentos, cada grupo por nombre.
 * `query` filtra por nombre sin distinguir mayúsculas ni acentos.
 */
export function buildEntries(folders: DriveFolder[], cases: DriveCase[], query = ""): DriveEntry[] {
  const needle = query.trim();
  const matches = (name: string) =>
    !needle || name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().includes(
      needle.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
    );

  const folderEntries: DriveEntry[] = folders
    .filter((f) => matches(f.name))
    .map((f) => ({
      kind: "folder",
      id: f.id,
      name: f.name,
      detail: f.itemCount === 0 ? "Vacía" : plural(f.itemCount, "elemento", "elementos"),
      folder: f,
    }));

  const caseEntries: DriveEntry[] = [];
  const documentEntries: DriveEntry[] = [];
  for (const c of cases) {
    if (c.loose) {
      const name = c.firstDocument?.filename ?? c.title;
      if (!matches(name)) continue;
      documentEntries.push({
        kind: "document",
        id: c.id,
        name,
        detail: c.firstDocument ? formatBytes(c.firstDocument.sizeBytes) : "",
        item: c,
      });
    } else if (matches(c.title)) {
      caseEntries.push({
        kind: "case",
        id: c.id,
        name: c.title,
        detail: plural(c.documentCount, "documento", "documentos"),
        item: c,
      });
    }
  }

  const byName = (a: DriveEntry, b: DriveEntry) => collator.compare(a.name, b.name);
  return [...folderEntries.sort(byName), ...caseEntries.sort(byName), ...documentEntries.sort(byName)];
}

/** Nombre sugerido para un expediente nuevo a partir del archivo subido. */
export function caseTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return base.length >= 3 ? base : `Expediente ${base}`.trim();
}
