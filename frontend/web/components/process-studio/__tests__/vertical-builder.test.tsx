import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VerticalBuilder } from "../vertical-builder";
import type { Flow } from "@/libs/flow";

vi.mock("@/components/formats/flow-editor", () => ({
  FlowEditor: () => <div>Editor de reglas</div>,
}));
vi.mock("@/components/formats/person-picker", () => ({
  PersonPicker: () => <div>Directorio</div>,
}));
const flow: Flow = {
  variables: [],
  order: "SECUENCIAL",
  slaHours: 72,
  steps: [
    {
      id: "a",
      label: "Revisión de gasto",
      role: "REVISOR",
      who: { type: "initiator" },
    },
    {
      id: "b",
      label: "Firma final",
      role: "FIRMANTE",
      who: { type: "ask", prompt: "¿Quién firma?" },
    },
  ],
};

describe("vertical builder", () => {
  it("reorders complete steps while preserving their identities and participants", () => {
    const onChange = vi.fn();
    render(<VerticalBuilder value={flow} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Bajar paso 1" }));
    expect(onChange).toHaveBeenCalledWith({
      ...flow,
      steps: [flow.steps[1], flow.steps[0]],
    });
  });
  it("adds a real editable reviewer with a stable id and participant question", () => {
    const onChange = vi.fn();
    render(<VerticalBuilder value={flow} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar paso" }));
    expect(onChange.mock.calls[0]![0].steps[2]).toMatchObject({
      role: "REVISOR",
      who: { type: "ask" },
    });
    expect(onChange.mock.calls[0]![0].steps[2].id).toMatch(/^etapa-/);
  });
  it("does not expose destructive controls to read-only viewers", () => {
    render(<VerticalBuilder value={flow} onChange={vi.fn()} readOnly />);
    expect(
      screen.queryByRole("button", { name: "Agregar paso" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Eliminar paso 1" }),
    ).not.toBeInTheDocument();
  });
});
