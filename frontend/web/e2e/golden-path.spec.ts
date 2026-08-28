import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Genera un PDF mínimo pero válido (una página en blanco, tamaño carta) como
 * Buffer. No depende de ninguna librería externa: es la secuencia de bytes
 * más pequeña que Chromium (y react-pdf/el visor <object>) reconoce como PDF.
 */
function buildMinimalPdf(): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>\nendobj\n",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += obj;
  }

  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  body += xref;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(body, "latin1");
}

test.describe("Camino dorado: enviar un documento a firmar", () => {
  test("crea un envío desde /new y aterriza en el detalle del documento", async ({ page }) => {
    const pdfPath = path.join(os.tmpdir(), `prestige-e2e-${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, buildMinimalPdf());

    const documentTitle = `Contrato de prueba E2E ${Date.now()}`;
    const signerName = "Ana Torres";
    const signerEmail = `ana.torres.${Date.now()}@ejemplo.com`;

    try {
      await page.goto("/new");

      // --- Paso 1: Documento ---
      await expect(
        page.getByRole("heading", { name: "¿Qué documento vas a enviar a firmar?" }),
      ).toBeVisible();

      await page.locator("#title").fill(documentTitle);
      await page.locator("#pdf-upload").setInputFiles(pdfPath);
      await expect(page.getByText(path.basename(pdfPath))).toBeVisible();

      await page.getByRole("button", { name: "Continuar" }).click();

      // --- Paso 2: Firmantes ---
      await expect(
        page.getByRole("heading", { name: "¿Quién debe firmar o revisar este documento?" }),
      ).toBeVisible();

      await page.getByPlaceholder("María González").fill(signerName);
      await page.getByPlaceholder("maria@empresa.com").fill(signerEmail);

      await page.getByRole("button", { name: "Continuar" }).click();

      // --- Paso 3: Método y envío ---
      await expect(
        page.getByRole("heading", { name: "¿Qué métodos de firma autorizas?" }),
      ).toBeVisible();
      await expect(page.getByText(documentTitle)).toBeVisible();

      await page.getByRole("button", { name: "Enviar a firmar" }).click();

      // Debe navegar a /documents/[id] tras crear el caso, documento y
      // solicitud de firma en el backend real.
      await page.waitForURL(/\/documents\/[^/]+$/, { timeout: 30_000 });

      await expect(page.getByText(signerName)).toBeVisible({ timeout: 15_000 });
    } finally {
      fs.rmSync(pdfPath, { force: true });
    }
  });
});
