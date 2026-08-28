import type { SignatureFieldType } from "@/libs/types";

/** Campo colocado en el editor, antes de guardarse (o recién cargado). */
export interface DraftField {
  /** Clave estable para React; no es el id real hasta que se guarda. */
  key: string;
  signerId: string;
  type: SignatureFieldType;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
}

export interface SignerColor {
  border: string;
  bg: string;
  text: string;
}
