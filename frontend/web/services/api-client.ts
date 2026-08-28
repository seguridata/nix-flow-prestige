const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

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

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
    throw new ApiError(
      (parsed as { message?: string })?.message ?? `Error ${res.status} en ${path}`,
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
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
