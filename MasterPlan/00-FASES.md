# Fases — Prestige / NIX Flow

## Fase actual (revisado 2026-10-06 contra código): P1 cerrado, hardening y UI integrados en `develop`

P1 cerró el 2026-09-26 (DoD 11/11, commits `5659271` … `27719e1`). La foto viva está en `PROGRESO.md`.

`fix/p1-hardening` llega a la UI de plantillas en `4981fd2`. El hardening va de `4726f71` a `fe45256` y el seguimiento está en `663d5f5`. `develop` toma esta rama desde `3c98372`.

El 2026-10-06 `develop` sumó el PR #4 (custodio PKCS#11) y el PR #5 (propuesta de UI, vista Drive «Mis documentos», formatos con campos que se llenan y administrador de flujos). El detalle está en `PROGRESO.md`, sección «UI y producto».

Lo que ya no es deuda:

- El PDF canónico vive en `Document.objectKey` + `enc` (AES-256-GCM). No hay `contentBase64`.
- `DIGITAL` es PAdES: X.509 + PKCS#7 CAdES-detached (`digital.adapter.ts`). En este sandbox corre el custodio de software. `Pkcs11KeyCustodian` firma dentro del token cuando `KEY_CUSTODIAN=pkcs11` y hay módulo; si falta la configuración, el servicio no está disponible.
- `OneTimeLink`: hash del token, TTL, consumo atómico.
- Auditoría con `prevHash` y trigger de inmutabilidad (`20261005110000_p1_audit_immutability`).
- `tenantId` en documento y solicitud, `TenantMembership`, `TenantContextGuard` fail-closed. El guard deja el tenant de la petición en el **slug**.
- Passkeys (registro interno, ceremonia, `requirePasskey`) y `EnvelopeTemplate` + `kycPolicy` en backend.
- UI de plantillas (`4981fd2`): elegir en el wizard y crear en `/plantillas`. El nombre es único. No hay edición ni borrado. `templateId` no es columna.
- Login OIDC contra el realm `prestige`. La sesión `maria` es el usuario demo de Keycloak, no un bypass del guard.
- Freeze obligatorio al crear la solicitud. `sign()` rehashea el canónico. Una autógrafa sobre un PDF que ya tiene PAdES responde 409.
- INE y selfie son claves de storage cifrado, con consentimiento LFPDPPP antes de capturarlas.
- Puerto `IdvProvider` de redirect: no se construye. No hay contrato. El gate `kycPolicy` no se toca.
- UI «mostrar la prueba» (bandeja, portal del firmante, onboarding, evidencia) y vista Drive personal con carpetas, expedientes y documentos.
- Formatos (`DocumentTemplate`) que se llenan y calculan sus firmantes por condiciones, y flujos que el admin crea y publica. Los flujos publicados alimentan a los formatos; el flujo de Temporal sigue siendo `contratoDosPartes`.

Lo que sigue abierto, y no es P1:

- Ejecutar un flujo publicado en Temporal (hoy solo los formatos lo ejecutan, resolviendo firmantes al crear la solicitud), cajas de firma en el editor de formatos y auditoría de publicar flujos.
- Módulo PKCS#11 cargado, OCSP/CRL y constancia NOM-151 de un PSC. El custodio de `09e6ac3` ya firma dentro del token; este sandbox no tiene módulo. Ver `P2-KMS.md`.
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

P1 ya cerró, y PAdES sobre el hash congelado ya existe con CA de software. El camino PKCS#11 ya firma dentro del token (`CKM_RSA_PKCS`, sin exportar la llave) cuando el entorno trae módulo, PIN, etiqueta y `graphene-pk11`. Este sandbox no lo tiene: el default sigue siendo software. P2 no está cerrado. El detalle está en `P2-KMS.md`:

- Certificado que Acrobat reconozca (AATL o la PSC), más OCSP/CRL leídos de ese certificado.
- Constancia NOM-151 de un PSC. El sello RFC 3161 ya está enchufado. Sin contrato no se construye un cliente.
- IdV de proveedor de pago solo con contrato. El gate `kycPolicy` no se toca.

## Fase posterior: P3 — Plataforma

RLS de Postgres, Merkle diario, white-label, TLA. Fuera de este paquete.

Object Lock en modo GOVERNANCE a 30 días ya está en el init de MinIO del sandbox (`prestige-docs`). GOVERNANCE se puede levantar con bypass. No cuenta como el capítulo de plataforma.

## Regla de oro (2026-10-05)

La versión original prohibía abrir P2 mientras el PDF se mutara o `DIGITAL` fuera HMAC. Las dos condiciones dejaron de aplicar en la Fase B y en el Sprint 1.

La reformulación del 2026-09-26 ataba P2 a passkeys, plantillas y un puerto `IdvProvider`. Passkeys y plantillas de backend cerraron con P1. El puerto `IdvProvider` se descartó a propósito (Sprint 4). Ya no es la puerta.

**P2 (HSM/KMS y constancia NOM-151) puede abrirse. No se mezcla con un PR de hardening. El canónico sigue congelado, y el tenant de la petición sigue siendo el slug que deja `TenantContextGuard`.**
