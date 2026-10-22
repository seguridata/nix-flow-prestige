import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileText, ListChecks } from "lucide-react";

import { WizardSteps } from "@/components/ui/wizard-steps";

const steps = [
  { id: "a", label: "Documento", icon: FileText, done: true },
  { id: "b", label: "Firmantes", icon: ListChecks, done: true },
  { id: "c", label: "Revisar", icon: FileText, done: false },
];

describe("WizardSteps", () => {
  it("marca el paso actual con aria-current y dice el estado de cada uno en texto", () => {
    render(<WizardSteps steps={steps} current={1} onSelect={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items[1]!.getAttribute("aria-current")).toBe("step");
    expect(items[0]!.textContent).toContain("completo");
    expect(items[1]!.textContent).toContain("paso actual");
    expect(items[2]!.textContent).toContain("pendiente");
  });

  it("un paso completo (que no es el actual) muestra palomita en lugar de su icono; el actual y el pendiente conservan el icono", () => {
    const { container } = render(<WizardSteps steps={steps} current={1} onSelect={() => {}} />);
    const li = container.querySelectorAll("ol > li");
    expect(li[0]!.querySelector("svg.lucide-check")).not.toBeNull();
    expect(li[1]!.querySelector("svg.lucide-check")).toBeNull();
    expect(li[1]!.querySelector("svg.lucide-list-checks")).not.toBeNull();
    expect(li[2]!.querySelector("svg.lucide-file-text")).not.toBeNull();
  });

  it("cambia de paso con el botón, y un paso bloqueado no responde", () => {
    const onSelect = vi.fn();
    render(<WizardSteps steps={[...steps.slice(0, 2), { ...steps[2]!, blocked: "Falta el documento" }]} current={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Firmantes/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
    const blocked = screen.getByRole("button", { name: /Revisar/ }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
  });

  it("un paso con href es un enlace", () => {
    render(<WizardSteps steps={[{ ...steps[0]!, href: "/formatos" }, steps[1]!]} current={1} />);
    expect(screen.getByRole("link", { name: /Documento/ }).getAttribute("href")).toBe("/formatos");
  });
});
