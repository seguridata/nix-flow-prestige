/**
 * Lee un entero positivo de una variable de entorno; si falta o no es válido
 * (NaN, <= 0) devuelve `fallback`.
 */
export function envPositiveInt(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
