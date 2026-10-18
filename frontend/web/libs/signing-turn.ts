import type { SignatureRequest, Signer } from "./types";

/**
 * En un flujo SECUENCIAL, el firmante ANTERIOR que sigue pendiente y bloquea el
 * turno de `signerId`. Devuelve `null` si es orden paralelo, si a `signerId` ya
 * le toca, o si no está en la solicitud.
 *
 * Los `signers` llegan del BFF en orden de firma (`sortOrder`), así que "antes"
 * = índice menor en el arreglo.
 */
export function signerBlockedBy(
  request: Pick<SignatureRequest, "order" | "signers">,
  signerId: string,
): Signer | null {
  if (request.order !== "SECUENCIAL") return null;
  const idx = request.signers.findIndex(
    (s) => s.signerId === signerId || s.delegatedTo === signerId,
  );
  if (idx <= 0) return null;
  return request.signers.slice(0, idx).find((s) => s.status === "PENDIENTE") ?? null;
}
