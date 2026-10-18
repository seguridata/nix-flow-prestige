import type { LlmMessage, LlmProvider } from './llm.types';

/** Saca el primer objeto JSON de una respuesta, aunque venga entre cercas de código o con texto alrededor. */
export function extractJson(text: string): unknown | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fenced ? fenced[1]! : text;
  const start = src.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(src.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export interface JsonAsk<T> {
  value?: T;
  errors: string[];
  attempts: number;
  model?: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Pide JSON al modelo, lo valida con `validate` y, si falla, le devuelve los errores para que corrija.
 * Máximo `maxAttempts` llamadas. Un error del proveedor se propaga tal cual.
 */
export async function askForJson<T>(
  provider: LlmProvider,
  system: string,
  firstUser: string,
  validate: (raw: unknown) => { value?: T; errors: string[] },
  opts: { maxTokens?: number; maxAttempts?: number } = {},
): Promise<JsonAsk<T>> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const messages: LlmMessage[] = [{ role: 'user', content: firstUser }];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let errors: string[] = [];
  let model: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await provider.complete({ system, messages, maxTokens: opts.maxTokens ?? 2000, json: true });
    model = res.model;
    usage.inputTokens += res.usage?.inputTokens ?? 0;
    usage.outputTokens += res.usage?.outputTokens ?? 0;

    const raw = extractJson(res.text);
    const checked = raw === undefined ? { errors: ['La respuesta de la IA no contiene un JSON.'] } : validate(raw);
    errors = checked.errors;
    if (errors.length === 0 && 'value' in checked && checked.value !== undefined) {
      return { value: checked.value, errors: [], attempts: attempt, model, usage };
    }
    messages.push(
      { role: 'assistant', content: res.text },
      { role: 'user', content: `Tu respuesta tiene estos errores:\n${errors.map((e) => `- ${e}`).join('\n')}\nCorrígelos y responde solo con el JSON completo.` },
    );
  }
  return { errors, attempts: maxAttempts, model, usage };
}
