import { expect, test } from "@playwright/test";

/** Real Keycloak/BFF/Redis/MinIO. Synthetic data only; never calls the AI provider.
 * PRESTIGE_E2E_USERNAME/PRESTIGE_E2E_PASSWORD are required at runtime and never saved.
 * Run with e2e/live.config.ts after the local stack is healthy.
 */
test("review a chat draft, save an unpublished digital form and upload/remove its attachment", async ({ page }) => {
  test.setTimeout(180_000);
  const username = process.env.PRESTIGE_E2E_USERNAME;
  const password = process.env.PRESTIGE_E2E_PASSWORD;
  if (!username || !password) throw new Error("Set PRESTIGE_E2E_USERNAME and PRESTIGE_E2E_PASSWORD in the process environment.");
  // The first-run tour intentionally blocks the page until a user dismisses it.
  // Keep this focused test on the draft/form flow and make the synthetic user opt out.
  await page.addInitScript(() => localStorage.setItem("prestige.tour.v1.draygoza", "1"));
  const name = `QA digital ${Date.now()}`;
  let templateId: string | undefined;
  let stagedId: string | undefined;

  await page.goto("/formatos");
  await page.getByRole("link", { name: "Entrar", exact: true }).click();
  // Keycloak standard login form. Credentials remain in memory; trace/video are disabled.
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="login"], button[type="submit"]').click();
  await page.waitForURL(/\/formatos$/, { timeout: 60_000 });

  try {
    const seed = await page.request.post("/api/bff/chat/drafts", { data: {
      kind: "template", name, description: "Datos sintéticos de QA; no enviar a terceros.",
      flow: { variables: [{ key: "motivo", label: "Motivo QA", type: "text", required: true }],
        steps: [{ id: "solicita", label: "Solicitante", role: "FIRMANTE", who: { type: "initiator" } }],
        order: "SECUENCIAL", slaHours: 48 },
    } });
    expect(seed.status(), "Creating the synthetic draft must use the real API").toBe(201);
    const draft = await seed.json();
    await page.reload();
    const drafts = page.getByRole("region", { name: "Borradores de formato del asistente" });
    await drafts.getByRole("listitem").filter({ hasText: name }).getByRole("link", { name: "Revisar formato" }).click();
    await page.waitForURL(new RegExp(`/formatos/borradores/${draft.id}$`));
    await expect(page.getByLabel("Nombre del formato", { exact: true })).toHaveValue(name);
    const reviewedName = `${name} revisado`;
    await page.getByLabel("Nombre del formato", { exact: true }).fill(reviewedName);

    const savedResponse = page.waitForResponse(r => r.url().endsWith("/api/bff/document-templates/form") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Crear formato digital", exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status(), "Saving a reviewed draft must not fail DTO validation").toBe(201);
    const form = await saved.json();
    templateId = form.id;
    expect(form.kind).toBe("FORM");
    expect(form.published).toBe(false);
    expect(form.name).toBe(reviewedName);
    await page.waitForURL(new RegExp(`/formatos/${templateId}/editar$`));
    const persisted = await page.request.get(`/api/bff/document-templates/${templateId}`);
    expect(persisted.ok()).toBe(true);
    expect((await persisted.json()).published).toBe(false);

    // Setup a published test-only format with one required PDF. No signature request is sent.
    const configured = await page.request.post("/api/bff/document-templates/form", { data: {
      id: templateId,
      attachmentSpecs: [{ key: "soporte", label: "Soporte QA", required: true, min: 1, max: 1, accept: ["pdf"], maxSizeMB: 1 }],
    } });
    expect(configured.status()).toBe(201);
    expect((await page.request.post(`/api/bff/document-templates/${templateId}/publish`)).status()).toBe(201);
    const pdf = await page.request.get(`/api/bff/document-templates/${templateId}/pdf`);
    expect(pdf.ok()).toBe(true);
    const bytes = await pdf.body();
    await page.goto(`/formatos/${templateId}`);
    const attachments = page.getByRole("region", { name: "Anexos", exact: true });
    await expect(attachments.getByRole("status")).toContainText("faltan 1");
    const chooser = page.waitForEvent("filechooser");
    await attachments.getByRole("button", { name: "Elegir archivo", exact: true }).click();
    const uploadResponse = page.waitForResponse(r => r.url().includes(`/document-templates/${templateId}/attachments?`) && r.request().method() === "POST");
    await (await chooser).setFiles({ name: "soporte-qa.pdf", mimeType: "application/pdf", buffer: bytes });
    const uploaded = await uploadResponse;
    expect(uploaded.status()).toBe(201);
    const staged = await uploaded.json();
    stagedId = staged.stagedId;
    expect(staged.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(staged.size).toBe(bytes.length);
    await expect(attachments.getByText("Listo", { exact: true })).toBeVisible();
    await expect(attachments.getByRole("status")).toContainText("completo");
    await expect(attachments.getByRole("button", { name: "Elegir archivo", exact: true })).toBeDisabled();
    const removedResponse = page.waitForResponse(r => r.url().endsWith(`/attachments/staged/${stagedId}`) && r.request().method() === "DELETE");
    await attachments.getByRole("button", { name: "Quitar soporte-qa.pdf" }).click();
    expect((await removedResponse).status()).toBe(204);
    stagedId = undefined;
    await expect(attachments.getByRole("status")).toContainText("faltan 1");
    await expect(attachments.getByRole("button", { name: "Elegir archivo", exact: true })).toBeEnabled();
  } finally {
    // Only remove data created by this test. The Redis chat draft expires normally.
    if (stagedId) await page.request.delete(`/api/bff/document-templates/attachments/staged/${stagedId}`);
    if (templateId) {
      await page.request.post(`/api/bff/document-templates/${templateId}/unpublish`);
      await page.request.delete(`/api/bff/document-templates/${templateId}`);
    }
  }
});
