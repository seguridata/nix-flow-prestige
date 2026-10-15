/**
 * Contrato mínimo con un modelo de lenguaje. El resto del módulo de IA solo conoce esta interfaz,
 * así que cambiar de proveedor (Grok, Claude, uno local) es cambiar la implementación inyectada.
 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  /** Pide al proveedor que responda un objeto JSON. */
  json?: boolean;
}

export interface LlmResponse {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** El proveedor respondió con error o no respondió. El mensaje no incluye secretos. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}
