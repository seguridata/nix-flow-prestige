/** CSV / TSV genérico (sin dependencias de UI): lo que se pega desde Excel llega separado por tabuladores. */

export type Delimiter = "," | ";" | "\t";

/** CSV → filas de celdas. Soporta comillas, comillas dobles escapadas, saltos dentro de comillas y BOM. */
export function parseCsv(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cur = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const src = text.replace(/^﻿/, "");
  const endRow = () => {
    cells.push(cur);
    cur = "";
    if (cells.some((c) => c.trim() !== "")) rows.push({ cells, line: startLine });
    cells = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cur += ch;
      }
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === delimiter) {
      cells.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
      startLine = line;
    } else cur += ch;
  }
  if (cur !== "" || cells.length > 0) endRow();
  return rows;
}

/**
 * Separador de la cabecera: el que más aparezca entre tabulador, `;` y `,` (ignorando lo entrecomillado).
 * En empate gana tabulador, luego `;` y luego coma; sin ninguno, coma.
 */
export function detectDelimiter(text: string): Delimiter {
  const head = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const count = { "\t": 0, ";": 0, ",": 0 } satisfies Record<Delimiter, number>;
  let quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in count) count[ch as Delimiter]++;
  }
  let best: Delimiter = ",";
  let bestN = 0;
  for (const d of ["\t", ";", ","] as const) {
    if (count[d] > bestN) {
      best = d;
      bestN = count[d];
    }
  }
  return best;
}

/** Entrecomilla una celda solo si hace falta. */
export function csvEscape(cell: string, delimiter: Delimiter = ","): string {
  return cell.includes(delimiter) || /["\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(rows: readonly (readonly string[])[], delimiter: Delimiter = ","): string {
  return rows.map((r) => r.map((c) => csvEscape(c, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}
