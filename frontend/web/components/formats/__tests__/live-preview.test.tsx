import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LivePreview } from "@/components/formats/live-preview";

// El visor de PDF real necesita pdfjs y un worker; aquí solo importa la capa de datos que se dibuja encima.
vi.mock("@/components/formats/pdf-surface", () => ({
  PdfSurface: ({ page, children }: { page: number; children?: React.ReactNode }) => (
    <div data-testid="surface" data-page={page}>
      {children}
    </div>
  ),
  useContainerWidth: () => ({ ref: { current: null }, width: 612 }),
}));

const field = (key: string, page: number, over: Record<string, unknown> = {}) => ({
  key,
  label: `Etiqueta ${key}`,
  type: "text",
  required: true,
  page,
  x: 0.1,
  y: 0.3,
  w: 0.4,
  h: 0.03,
  ...over,
});

const base = (fields: ReturnType<typeof field>[], pageCount = 1) => ({ id: "f1", fields: fields as never, pageCount });

describe("LivePreview", () => {
  it("escribe cada dato en su lugar, con las fechas como DD/MM/AAAA, y cuenta lo que ya está", () => {
    const fmt = base([field("a", 1), field("fecha", 1, { type: "date", y: 0.5 }), field("vacio", 1, { y: 0.7 })]);
    const { container } = render(<LivePreview format={fmt} values={{ a: "Hola", fecha: "2026-10-21" }} activeKey={null} />);
    expect(container.querySelector('[data-field="a"]')?.textContent).toBe("Hola");
    expect(container.querySelector('[data-field="fecha"]')?.textContent).toBe("21/10/2026");
    expect(container.querySelector('[data-field="vacio"]')?.textContent).toBe("");
    expect(screen.getByText(/2 de 3 datos en el documento/)).toBeTruthy();
  });

  it("resalta con su nombre el dato enfocado y no los demás", () => {
    const fmt = base([field("a", 1), field("b", 1, { y: 0.5 })]);
    render(<LivePreview format={fmt} values={{}} activeKey="b" />);
    expect(screen.getByText("Etiqueta b")).toBeTruthy();
    expect(screen.queryByText("Etiqueta a")).toBeNull();
  });

  it("solo dibuja los datos de la página visible y salta a la del dato enfocado", () => {
    const fmt = base([field("a", 1), field("b", 2)], 2);
    const { container, rerender } = render(<LivePreview format={fmt} values={{ a: "x", b: "y" }} activeKey={null} />);
    expect(screen.getByTestId("surface").dataset.page).toBe("1");
    expect(container.querySelector('[data-field="b"]')).toBeNull();
    rerender(<LivePreview format={fmt} values={{ a: "x", b: "y" }} activeKey="b" />);
    expect(screen.getByTestId("surface").dataset.page).toBe("2");
    expect(container.querySelector('[data-field="b"]')?.textContent).toContain("y");
    expect(screen.getByText("Página 2 de 2")).toBeTruthy();
  });

  it("permite pasar de página a mano y no muestra navegación con una sola", () => {
    const fmt = base([field("a", 1), field("b", 2)], 2);
    render(<LivePreview format={fmt} values={{}} activeKey={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(screen.getByTestId("surface").dataset.page).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
    expect(screen.getByTestId("surface").dataset.page).toBe("1");
  });

  it("sin paginación cuando el documento tiene una página", () => {
    render(<LivePreview format={base([field("a", 1)])} values={{}} activeKey={null} />);
    expect(screen.queryByRole("button", { name: "Página siguiente" })).toBeNull();
  });
});
