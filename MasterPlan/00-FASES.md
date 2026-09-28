# Fases — Prestige / NIX Flow

## Fase actual (verificado 2026-09-26 contra código, no solo contra el commit auditado): entre P0 y P1

El repo `seguridata/nix-flow-prestige` ya tiene UI, BPM (Temporal), modelos de caso/firma/evidencia y adapters. El merge de `feat/fase-a-b-produccion` (posterior al commit `d80a296` que auditó este paquete) ya cerró varias de las señales de P0 de abajo. Antes de "agregar" algo de la lista de sprints, comprobar si ya existe.

Señales que **ya no aplican** (verificado en código):

- ~~PDF en Postgres (`contentBase64`)~~ → `Document.objectKey` + `enc` (AES-256-GCM), sin `contentBase64`.
- ~~`DIGITAL` = HMAC de servidor~~ → PAdES real: X.509 + PKCS#7 CAdES-detached (`digital.adapter.ts`), custodio conmutable a HSM.
- ~~sin token de un uso~~ → `OneTimeLink` (hash del token, TTL, consumo atómico).
- Auditoría sin cadena → ya tiene `prevHash`/`eventHash` (`ProcessAuditEvent`, migración `m11_chained_audit`).
- `tenantId` ausente de Document/Request → ya está, más `TenantMembership` y `TenantContextGuard`.

Señales que siguen vigentes:

- Login demo (`maria`) sigue siendo el camino principal en el front (falta terminar OIDC real y ocultar el demo tras `NEXT_PUBLIC_DEMO_SESSION`).
- Autógrafa: verificar que ya no muta el objeto canónico (el freeze de Sprint 1 lo corrigió; confirmar en el resto de los flujos).
- INE/selfie: el bloqueo por consentimiento LFPDPPP ya existe; falta confirmar que ningún path viejo siga escribiendo base64.
- Sin passkeys, sin `EnvelopeTemplate`/`kycPolicy` por plantilla, sin puerto `IdvProvider` genérico (el IdV de M16 vive dentro de onboarding, no como puerto reusable por envelope).

## Fase puente (esta homologación): P1 — Cimiento

Objetivo: el sistema **congela bytes, identifica tenant, autentica, registra y no miente** sobre lo que es una firma.

Al cerrar P1:

- Auth real + tenants en todas las tablas calientes.
- Upload → SHA-256 → freeze. El objeto congelado no se reescribe.
- Envelope + magic link de un uso + “acepto” + log encadenado.
- Passkeys como factor de presencia.
- Adapter IdV (puerto + contrato), aunque el vendor sea sandbox.
- Políticas por plantilla (`kycPolicy`, orden).
- Evidence zip descargable.
- `DIGITAL` marcado `DEV_ONLY` hasta KMS.

## Fase destino inmediata: P2 — Firma digital real

Solo después de P1:

- Clave de firma en KMS/HSM.
- CMS/PAdES sobre el hash congelado.
- IdV de proveedor de pago en el camino de alto riesgo.
- Puerto TSA / NOM-151 (enchufe, no núcleo).

## Fase posterior: P3 — Plataforma

Object Lock, RLS Postgres, Merkle diario, white-label, TLA. Fuera de este paquete.

## Regla de oro (reformulada 2026-09-26)

La versión original decía: "no se abre P2 mientras el PDF original se muta o
`DIGITAL` es HMAC sin flag `DEV_ONLY`". Esa premisa ya no aplica: `DIGITAL`
no es HMAC, es PAdES real, y el freeze de Sprint 1 ya impide mutar el
canónico. Reformulada a lo que sí sigue siendo la condición real:

**No se abre P2 (mover el custodio de llave a HSM/KMS, TSA/NOM-151) mientras
falten passkeys, `EnvelopeTemplate`/`kycPolicy` por plantilla, o el puerto
`IdvProvider` genérico — es decir, mientras la ceremonia de firma externa
(Sprints 2-5) no esté completa.**
