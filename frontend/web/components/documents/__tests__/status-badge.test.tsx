import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusBadge } from "@/components/documents/status-badge";
import type { SignatureRequestStatus, SignerStatus } from "@/libs/types";

describe("StatusBadge", () => {
  it.each([
    ["PENDIENTE", "Pendiente de tu firma"],
    ["EN_FIRMA", "En progreso"],
    ["COMPLETADA", "Completado"],
    ["FIRMADO", "Firmado"],
    ["RECHAZADA", "Rechazado"],
    ["RECHAZADO", "Rechazado"],
    ["EXPIRADA", "Expirado"],
  ] as [SignatureRequestStatus | SignerStatus, string][])(
    "muestra la etiqueta correcta para el estado %s",
    (status, expectedLabel) => {
      render(<StatusBadge status={status} />);
      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    },
  );

  it("usa la etiqueta success para COMPLETADA", () => {
    render(<StatusBadge status="COMPLETADA" />);
    const badge = screen.getByText("Completado");
    expect(badge.className).toContain("bg-[#eaf3d6]");
  });

  it("cae de vuelta al propio valor cuando el estado es desconocido", () => {
    render(<StatusBadge status="ALGO_INESPERADO" />);
    expect(screen.getByText("ALGO_INESPERADO")).toBeInTheDocument();
  });
});
