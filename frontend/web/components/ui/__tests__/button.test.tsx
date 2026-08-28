import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renderiza el texto que recibe como children", () => {
    render(<Button>Firmar documento</Button>);
    expect(screen.getByRole("button", { name: "Firmar documento" })).toBeInTheDocument();
  });

  it("invoca onClick al hacer click", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Continuar</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("no invoca onClick cuando está disabled y refleja el atributo", () => {
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        Enviando…
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Enviando…" });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("aplica la variante destructive con sus clases correspondientes", () => {
    render(<Button variant="destructive">Rechazar</Button>);
    const button = screen.getByRole("button", { name: "Rechazar" });
    expect(button.className).toContain("bg-destructive");
  });
});
