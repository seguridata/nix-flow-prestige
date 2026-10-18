import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessLab } from "../process-tools";
import type { Flow } from "@/libs/flow";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/services/api-client", () => ({ apiClient: { post } }));
const flow: Flow = {
  variables: [{ key: "monto", label: "Monto", type: "number", required: true }],
  order: "SECUENCIAL",
  slaHours: 72,
  steps: [
    {
      id: "revision",
      label: "Revisión",
      role: "REVISOR",
      who: { type: "initiator" },
    },
  ],
};
function setup() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <ProcessLab processKey="gastos" flow={flow} />
    </QueryClientProvider>,
  );
}

describe("real route evaluation client", () => {
  beforeEach(() => { post.mockReset(); });
  it("sends typed user values and current draft to the actual resolver API then shows its result", async () => {
    post.mockResolvedValue({
      order: "SECUENCIAL",
      slaHours: 72,
      lookups: [],
      derived: {},
      steps: [
        {
          id: "revision",
          label: "Revisión",
          role: "REVISOR",
          active: true,
          participant: { signerId: "jalarcon", name: "Javier Alarcón" },
          awaiting: [],
          needsSelection: false,
        },
      ],
    });
    setup();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Monto/ }), {
      target: { value: "2500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Evaluar recorrido" }));
    expect(await screen.findByText("Javier Alarcón")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      "/process-definitions/gastos/preview-flow",
      { values: { monto: 2500 }, flow },
    );
  });
  it("shows resolver failures without inventing a participant or creating a request", async () => {
    post.mockRejectedValue(
      new Error("La tabla de responsables no está activa."),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Evaluar recorrido" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La tabla de responsables no está activa.",
    );
    expect(post).toHaveBeenCalledTimes(1);
  });
});
