import { describe, expect, it, vi } from "vitest";
import { fetchFormats, fetchFormatsPage, saveFormDocument, type FormatDraft } from "@/services/formats-service";

const { post, get } = vi.hoisted(() => ({ post: vi.fn(async () => ({ id: "form-1" })), get: vi.fn() }));
vi.mock("@/services/api-client", () => ({ apiClient: { post, get } }));

describe("Format list pagination contract", () => {
  it("preserves legacy calls and encodes bounded pages/cursors", async () => {
    await fetchFormats(true);
    expect(get).toHaveBeenLastCalledWith("/document-templates?all=true");
    await fetchFormatsPage(true, "cursor con/espacio", 5000);
    expect(get).toHaveBeenLastCalledWith("/document-templates?limit=200&all=true&cursor=cursor+con%2Fespacio");
    await fetchFormatsPage(false);
    expect(get).toHaveBeenLastCalledWith("/document-templates?limit=50");
  });
});

describe("Digital form request contract", () => {
  it("omits PDF placement fields rejected by CreateFormDto while preserving reviewed metadata", async () => {
    const draft: FormatDraft = {
      name: "Revisado", fields: [], signatureBoxes: [], attachmentSpecs: [], methods: ["AUTOGRAFA"], kycPolicy: "NONE", requirePasskey: false,
      flow: { variables: [{ key: "motivo", label: "Motivo", type: "text", required: true }], steps: [{ id: "firma", label: "Firma", role: "FIRMANTE", who: { type: "initiator" } }], order: "SECUENCIAL", slaHours: 48 },
    };
    await saveFormDocument(draft);
    const [url, payload] = post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe("/document-templates/form");
    expect(payload).not.toHaveProperty("fields");
    expect(payload).not.toHaveProperty("signatureBoxes");
    expect(payload).not.toHaveProperty("id");
    expect(payload).toMatchObject({ name: "Revisado", flow: draft.flow, methods: draft.methods, attachmentSpecs: [] });
    await saveFormDocument(draft, "form-1");
    expect(post).toHaveBeenLastCalledWith("/document-templates/form", { ...payload, id: "form-1" });
  });
});
