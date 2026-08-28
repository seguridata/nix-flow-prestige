import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SignMethodDialog } from "@/components/signature/sign-method-dialog";
import type { SignatureMethod } from "@/libs/types";

function renderDialog(overrides?: {
  allowedMethods?: SignatureMethod[];
  onConfirm?: (payload: { method: SignatureMethod; consentAccepted: boolean }) => void;
  isSubmitting?: boolean;
}) {
  const onOpenChange = vi.fn();
  const onConfirm = overrides?.onConfirm ?? vi.fn();
  render(
    <SignMethodDialog
      open
      onOpenChange={onOpenChange}
      allowedMethods={overrides?.allowedMethods ?? ["DIGITAL"]}
      consentText={{ version: "1.1", text: "Acepto firmar." }}
      biometricReady
      onConfirm={onConfirm}
      isSubmitting={overrides?.isSubmitting}
    />,
  );
  return { onOpenChange, onConfirm };
}

describe("SignMethodDialog", () => {
  it("muestra el título cuando está abierto", () => {
    renderDialog();
    expect(screen.getByText("Ceremonia de firma")).toBeInTheDocument();
  });

  it("muestra el lienzo de trazo al elegir Autógrafa", () => {
    renderDialog({ allowedMethods: ["AUTOGRAFA"] });
    expect(screen.getByLabelText("Lienzo para trazar la firma autógrafa")).toBeInTheDocument();
  });

  it("solo muestra los métodos incluidos en allowedMethods", () => {
    renderDialog({ allowedMethods: ["DIGITAL", "AUTOGRAFA"] });

    expect(screen.getByText("Digital")).toBeInTheDocument();
    expect(screen.getByText("Autógrafa")).toBeInTheDocument();
    expect(screen.queryByText("Biométrica")).not.toBeInTheDocument();
  });

  it("el botón de confirmar empieza deshabilitado hasta método y consentimiento", () => {
    renderDialog({ allowedMethods: ["DIGITAL"] });

    const confirmButton = screen.getByRole("button", { name: "Confirmar y firmar" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByText("Digital"));
    expect(confirmButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirmButton).toBeEnabled();
  });

  it("llama a onConfirm con el método seleccionado", () => {
    const { onConfirm } = renderDialog({ allowedMethods: ["DIGITAL", "BIOMETRICA"] });

    fireEvent.click(screen.getByText("Biométrica"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y firmar" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ method: "BIOMETRICA", consentAccepted: true }),
    );
  });
});
