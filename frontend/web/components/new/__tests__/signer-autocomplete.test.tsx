import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { SignerAutocomplete } from "@/components/new/signer-autocomplete";
import type { Colleague } from "@/libs/types";

function fakeRegister(): UseFormRegisterReturn {
  return {
    name: "signers.0.name",
    onChange: vi.fn(async () => {}),
    onBlur: vi.fn(async () => {}),
    ref: vi.fn(),
  } as unknown as UseFormRegisterReturn;
}

const MARIA: Colleague = { userId: "maria", name: "María González", email: "maria@seguridata.mx" };
const CARLOS: Colleague = { userId: "carlos", name: "Carlos Ramírez", email: "carlos@seguridata.mx" };

describe("SignerAutocomplete", () => {
  it("sin coincidencias en el directorio se comporta como un input normal", () => {
    render(
      <SignerAutocomplete register={fakeRegister()} value="zzz" colleagues={[MARIA]} onPick={vi.fn()} />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("al enfocar con texto que coincide (sin acentos) muestra la sugerencia", () => {
    render(
      <SignerAutocomplete register={fakeRegister()} value="mar" colleagues={[MARIA, CARLOS]} onPick={vi.fn()} />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("María González")).toBeInTheDocument();
    expect(screen.queryByText("Carlos Ramírez")).toBeNull();
  });

  it("elegir una fila llama onPick con ese colega", () => {
    const onPick = vi.fn();
    render(
      <SignerAutocomplete register={fakeRegister()} value="maria@" colleagues={[MARIA]} onPick={onPick} />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("María González"));
    expect(onPick).toHaveBeenCalledWith(MARIA);
  });

  it("escribir sigue propagando el onChange de react-hook-form", () => {
    const register = fakeRegister();
    render(
      <SignerAutocomplete register={register} value="" colleagues={[MARIA]} onPick={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "M" } });
    expect(register.onChange).toHaveBeenCalled();
  });
});
