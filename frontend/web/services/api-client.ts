// Todas las llamadas pasan por el proxy de route handlers (/api/bff/*), que
// adjunta el Bearer token de la sesión server-side. El navegador nunca ve el token.
const BASE_URL = "/api/bff";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  idempotencyKey?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, headers, ...rest } = options;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: {
        // FormData: el navegador pone el content-type con el boundary correcto.
        ...(isForm ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...headers,
      },
      body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const hint =
      error instanceof Error && /fetch|network|failed/i.test(error.message)
        ? `No hay conexión con el BFF en ${BASE_URL}${path}. Arranca el backend (bun run dev en la raíz, o nest start en backend/bff) y Postgres.`
        : error instanceof Error
          ? error.message
          : "Error de red";
    throw new ApiError(hint, 0, error);
  }

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
    }
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
    // A-11 — step-up: reautenticar con `max_age` y volver a la misma pantalla.
    if (
      res.status === 403 &&
      typeof window !== "undefined" &&
      (parsed as { error?: string })?.error === "step_up_required"
    ) {
      const maxAge = (parsed as { maxAgeSeconds?: number }).maxAgeSeconds ?? 300;
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/api/auth/login?maxAge=${maxAge}&returnTo=${encodeURIComponent(returnTo)}`;
    }
    const detail = (parsed as { errors?: unknown })?.errors;
    const detailText = Array.isArray(detail) && detail.every((d) => typeof d === "string") ? ` ${detail.join(" ")}` : "";
    throw new ApiError(
      `${(parsed as { message?: string })?.message ?? `Error ${res.status} en ${path}`}${detailText}`,
      res.status,
      parsed,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
