import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AI_NOTICE, AiDraftLabel, ChatPanel } from "@/components/chat/chat-panel";

describe("ChatPanel", () => {
  it("la etiqueta de IA dice que requiere revisión humana (texto, no solo color)", () => {
    render(<AiDraftLabel />);
    expect(screen.getByText(AI_NOTICE)).toBeInTheDocument();
    expect(AI_NOTICE).toMatch(/requiere revisión humana/);
  });

  it("muestra el botón accesible para abrir el asistente", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatPanel />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /abrir el asistente de ia/i })).toBeInTheDocument();
  });
});
