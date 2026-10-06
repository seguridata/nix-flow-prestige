# Fases — Prestige / NIX Flow

## Fase actual (revisado 2026-10-05 contra código): P1 cerrado, hardening integrado

P1 cerró el 2026-09-26 (DoD 11/11, commits `5659271` … `27719e1`). La foto viva está en `PROGRESO.md`.

`fix/p1-hardening` llega a la UI de plantillas en `4981fd2`. El hardening va de `4726f71` a `fe45256` y el seguimiento está en `663d5f5`. `develop` toma esta rama desde `3c98372`.

Lo que ya no es deuda:

- El PDF canónico vive en `Document.objectKey` + `enc` (AES-256-GCM). No hay `contentBase64`.
- `DIGITAL` es PAdES: X.509 + PKCS#7 CAdES-detached (`digital.adapter.ts`). El custodio de software es el que corre. `Pkcs11KeyCustodian` existe y responde que el HSM no está conectado.
- `OneTimeLink`: hash del token, TTL, consumo atómico.
- Auditoría con `prevHash` y trigger de inmutabilidad (`20261005110000_p1_audit_immutability`).
- `tenantId` en documento y solicitud, `TenantMembership`, `TenantContextGuard` fail-closed. El guard deja el tenant de la petición en el **slug**.
- Passkeys (registro interno, ceremonia, `requirePasskey`) y `EnvelopeTemplate` + `kycPolicy` en backend.
- UI de plantillas (`4981fd2`): elegir en el wizard y crear en `/plantillas`. El nombre es único. No hay edición ni borrado. `templateId` no es columna.
- Login OIDC contra el realm `prestige`. La sesión `maria` es el usuario demo de Keycloak, no un bypass del guard.
- Freeze obligatorio al crear la solicitud. `sign()` rehashea el canónico. Una autógrafa sobre un PDF que ya tiene PAdES responde 409.
- INE y selfie son claves de storage cifrado, con consentimiento LFPDPPP antes de capturarlas.
- Puerto `IdvProvider` de redirect: no se construye. No hay contrato. El gate `kycPolicy` no se toca.

Lo que sigue abierto, y no es P1:

- HSM/KMS, OCSP/CRL, constancia NOM-151 de un PSC. Ver `P2-KMS.md`.
- RLS de Postgres. El aislamiento es de aplicación.
- `backfill:tenant-ids` (`663d5f5`) deja en NULL lo que no tiene una pista única. El sandbox local ya lo corrió.

## Fase puente: P1 — Cimiento (cerrada 2026-09-26)

Objetivo que se cumplió: el sistema **congela bytes, identifica tenant, autentica, registra y no miente** sobre lo que es una firma.

- Auth real (OIDC) y tenant en documento y solicitud. El hardening del 2026-10-05 extendió `tenantId` a las tablas hijas. Outbox y notificaciones sin pista única siguen en NULL; el resto lo cubre `backfill:tenant-ids`.
- Upload → SHA-256 (`Document.hash`) → freeze. El canónico no se reescribe.
- Envelope, magic link de un uso, método “acepto” y log encadenado.
- Passkeys como factor de presencia.
- Identidad: el puerto `IdvProvider` no se construyó. Quedó `kycPolicy` sobre el onboarding (OCR, CURP, liveness, face).
- Políticas por plantilla en backend (`kycPolicy`, orden). La pantalla llegó después, en `4981fd2`.
- Evidence zip descargable, con `events.jsonl` y `pack.sha256`.
- `DIGITAL` es PAdES con CA interna, no un HMAC marcado `DEV_ONLY`. El paso a HSM es P2.

## Fase destino inmediata: P2 — custodia y constancia

P1 ya cerró, y PAdES sobre el hash congelado ya existe con CA de software. P2, cuando se abra, es sustituir esa custodia y cerrar la constancia. El detalle está en `P2-KMS.md`:

- Clave de firma dentro del HSM/KMS (`Pkcs11KeyCustodian` deja de ser un stub).
- Certificado que Acrobat reconozca (AATL o la PSC de SeguriData), más OCSP/CRL.
- Constancia NOM-151 de un PSC. El sello RFC 3161 ya está enchufado.
- IdV de proveedor de pago solo con contrato. El gate `kycPolicy` no se toca.

## Fase posterior: P3 — Plataforma

RLS de Postgres, Merkle diario, white-label, TLA. Fuera de este paquete.

Object Lock en modo GOVERNANCE a 30 días ya está en el init de MinIO del sandbox (`prestige-docs`). GOVERNANCE se puede levantar con bypass. No cuenta como el capítulo de plataforma.

## Regla de oro (2026-10-05)

La versión original prohibía abrir P2 mientras el PDF se mutara o `DIGITAL` fuera HMAC. Las dos condiciones dejaron de aplicar en la Fase B y en el Sprint 1.

La reformulación del 2026-09-26 ataba P2 a passkeys, plantillas y un puerto `IdvProvider`. Passkeys y plantillas de backend cerraron con P1. El puerto `IdvProvider` se descartó a propósito (Sprint 4). Ya no es la puerta.

**P2 (HSM/KMS y constancia NOM-151) puede abrirse. No se mezcla con un PR de hardening. El canónico sigue congelado, y el tenant de la petición sigue siendo el slug que deja `TenantContextGuard`.**
