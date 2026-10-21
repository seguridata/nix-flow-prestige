import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TemplateDrafts } from "@/components/chat/template-drafts";
import { FormatEditor } from "@/components/formats/format-editor";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), publish: vi.fn(), replace: vi.fn() }));
vi.mock("@/services/api-client", () => ({ apiClient: { get: mocks.get } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/components/ai/format-ai-assistant", () => ({ FormatAiAssistant: () => null }));
vi.mock("@/components/formats/pdf-surface", () => ({ PdfSurface: () => null, useContainerWidth: () => ({ ref: { current: null }, width: 560 }) }));
vi.mock("@/components/formats/flow-editor", () => ({ FlowEditor: () => null }));
vi.mock("@/services/lookup-tables-service", () => ({ fetchLookupTables: async () => [] }));
vi.mock("@/services/formats-service", () => ({
  fetchSignaturePolicy: async () => ({ allowedMethods: ["AUTOGRAFA"] }),
  fetchFlowDefinitions: async () => [], saveFormDocument: mocks.save,
  setFormatPublished: mocks.publish, formatPdfUrl: () => "/test.pdf",
}));

const proposal = {
  id: "draft-1", name: "Vacaciones", description: "Revisión humana", createdAt: "2026-10-16T00:00:00Z",
  flow: { order: "SECUENCIAL" as const, slaHours: 48, variables: [{ key: "fecha", label: "Fecha", type: "date" as const, required: true }], steps: [{ id: "solicitante", label: "Solicitante", role: "FIRMANTE" as const, who: { type: "initiator" as const } }] },
};
const mount = (child: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{child}</QueryClientProvider>);

describe("Template drafts review", () => {
  beforeEach(() => vi.clearAllMocks());
  it("loads the authenticated drafts endpoint and links to review without creating anything", async () => {
    mocks.get.mockResolvedValue([proposal]);
    mount(<TemplateDrafts />);
    expect(await screen.findByRole("link", { name: "Revisar formato" })).toHaveAttribute("href", "/formatos/borradores/draft-1");
    expect(mocks.get).toHaveBeenCalledWith("/chat/drafts/templates");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("shows empty and recoverable error states", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    mount(<TemplateDrafts />);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Todavía no has guardado borradores de formato.")).toBeInTheDocument();
  });
  it("prefills a digital format and only saves the reviewed values after a human click", async () => {
    mocks.save.mockResolvedValue({ id: "format-1", fields: [], signatureBoxes: [], pageCount: 1, published: false });
    mount(<FormatEditor mode="FORM" proposal={proposal} />);
    const name = screen.getByDisplayValue("Vacaciones");
    fireEvent.change(name, { target: { value: "Vacaciones revisadas" } });
    expect(mocks.save).not.toHaveBeenCalled();
    // El asistente por pasos deja «Crear formato digital» en el último paso (Revisar y guardar).
    for (let i = 0; i < 4; i++) {
      fireEvent.click(await screen.findByRole("button", { name: /^siguiente/i }));
      expect(mocks.save).not.toHaveBeenCalled();
    }
    const button = await screen.findByRole("button", { name: /crear formato digital/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: "Vacaciones revisadas", flow: proposal.flow, methods: ["AUTOGRAFA"] }), undefined));
    expect(mocks.publish).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/formatos/format-1/editar"));
  });
});
