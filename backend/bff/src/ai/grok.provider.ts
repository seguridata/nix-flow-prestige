import { ServiceUnavailableException } from '@nestjs/common';
import { LlmProviderError, type LlmProvider, type LlmRequest, type LlmResponse } from './llm.types';

/**
 * Grok (xAI) por su API compatible con OpenAI (`/chat/completions`).
 *   XAI_API_KEY    obligatoria
 *   XAI_BASE_URL   por defecto https://api.x.ai/v1
 *   AI_MODEL       por defecto grok-4 (confírmalo contra los modelos de tu cuenta)
 *   AI_TIMEOUT_MS  por defecto 60000
 */
export class GrokProvider implements LlmProvider {
  readonly name = 'grok';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new ServiceUnavailableException('La IA no está configurada en este entorno.');
    const base = (process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1').replace(/\/+$/, '');
    const model = process.env.AI_MODEL ?? 'grok-4';
    const timeout = Number(process.env.AI_TIMEOUT_MS) > 0 ? Number(process.env.AI_TIMEOUT_MS) : 60_000;

    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: req.maxTokens ?? 2000,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new LlmProviderError(timedOut ? `El proveedor de IA no respondió en ${Math.round(timeout / 1000)} s.` : 'No se pudo contactar al proveedor de IA.');
    }
    if (!res.ok) {
      // El cuerpo puede traer detalles útiles pero nunca la clave; se recorta para no volcar contenido.
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new LlmProviderError(`El proveedor de IA respondió ${res.status}. ${body}`.trim(), res.status);
    }
    const data = (await res.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new LlmProviderError('El proveedor de IA devolvió una respuesta vacía.');
    return {
      text,
      model: data?.model ?? model,
      usage: { inputTokens: data?.usage?.prompt_tokens, outputTokens: data?.usage?.completion_tokens },
    };
  }
}
