import type { VarType } from '../flow/flow.types';

/** Campo del formato: dónde se imprime el valor de una variable del flujo (fracciones 0..1, origen arriba-izquierda). */
export interface TemplateField {
  key: string;
  label: string;
  type: VarType;
  required: boolean;
  options?: string[];
  /** Página, desde 1. */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  align?: 'left' | 'center';
  prefill?: 'user.name' | 'user.email' | 'today';
}

/** Caja donde firma el participante de un paso del flujo. */
export interface SignatureBox {
  stepId: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateActor {
  tenantId: string;
  actorId: string;
  name?: string;
  email?: string;
  isAdmin: boolean;
}
