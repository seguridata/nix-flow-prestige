import { describe, expect, it, vi } from "vitest";
import { saveFormDocument, type FormatDraft } from "@/services/formats-service";

const { post } = vi.hoisted(() => ({ post: vi.fn(async () => ({ id: "form-1" })) }));
vi.mock("@/services/api-client", () => ({ apiClient: { post } }));

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
