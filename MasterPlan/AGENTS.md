# AGENTS.md — Prestige P1

Instrucciones para humanos y agentes de código que toquen `seguridata/nix-flow-prestige`.

## Nota de estado (2026-10-05)

P1 está cerrado. Léase `PROGRESO.md` antes de tocar código. `REPORTE.md` describe el commit `d80a296` y ya no es el mapa del repo.

La rama con el endurecimiento es `fix/p1-hardening`. El seguimiento (métodos tras un PAdES, reconciliador de Temporal, `bootstrap:tenant`, `backfill:tenant-ids`, 404 de evidencia, passkey en solicitud cerrada y guarda de Object Lock) está en `663d5f5`. La UI de plantillas está en `4981fd2`. No los reimplementes.

**`DigitalSignerAdapter` no es HMAC.** Firma PAdES (`backend/bff/src/signing/digital.adapter.ts`). El default de este sandbox es la CA interna. `KEY_CUSTODIAN=pkcs11` selecciona `Pkcs11KeyCustodian`: la RSA se calcula en el token (`CKM_RSA_PKCS`) y este proceso no recibe la llave. Sin módulo, PIN, etiqueta o `graphene-pk11`, el servicio no está disponible y no hay fallback a software. OCSP/CRL embebido y la constancia NOM-151 siguen abiertos (`P2-KMS.md`).

`TenantContextGuard` deja `user.tenantId` en el slug. `TenantMembership.tenantId` es el uuid del `Tenant`. Un backfill o un filtro que copie ese uuid aísla contra el identificador equivocado.

## Misión

P1 ya está homologado. El hardening de `fix/p1-hardening` está cerrado en esta rama. No reabras los sprints. P2 (HSM/KMS, NOM-151) no se mezcla aquí. No crees un vendor IdV: no hay contrato y el gate `kycPolicy` se queda.

Leer antes de codear:

- `PROGRESO.md`
- `00-FASES.md`
- `SPEC.md`
- `DATA-MODEL.md`

## Repo layout (no inventar otro)

- App: `frontend/web` (Next.js, puerto 3001)
- API: `backend/bff` (NestJS, puerto 3000)
- Schema: `backend/bff/prisma/schema.prisma`
- Infra: `backend/docker-compose.yml`
- Firmas: `backend/bff/src/signing/`
- Evidencia: `backend/bff/src/evidence/`
- Onboarding: `backend/bff/src/onboarding/`

## Reglas duras

1. No llamés `pdf-lib` `save()` sobre el objectKey canónico.  
2. No escribas INE/selfie en columnas Prisma Text.  
3. No expongas `contentBase64` en endpoints nuevos.  
4. En la UI, “firma digital” es el PAdES de `DigitalSignerAdapter`. Un HMAC, un sello visual o la autógrafa no se etiquetan así.  
5. Toda query de negocio filtra `tenantId`, y ese valor es el slug (el que deja el guard), no el uuid de `TenantMembership`.  
6. Eventos de auditoría: insert only + `prevHash`. El trigger de inmutabilidad ya está.  
7. `@Public()` ya usado, y que no se ensancha sin motivo: `GET /operations/health`, `GET /signature-requests/consent`, `GET /signature-requests/capabilities`, el portal `/public/links/:token/*`, `GET /evidence/:manifestId/verify`, y `POST /internal/workflows/*` (ese último solo salta el JWT: lo cierra `WorkerGuard`). No hay webhook IdV.  
8. No agregues NOM-151, blockchain ni FIEL en el cierre del hardening.  
9. No borres Temporal; no diseñes procesos BPMN nuevos.  
10. Si un cambio rompe el freeze, el cambio se rechaza.

## Cómo implementar (orden)

P1 ya se ejecutó (`PLAN-SPRINTS.md`). Un cambio nuevo sigue siendo un PR temático. No mezcles el cierre del hardening con HSM, NOM-151 ni un vendor IdV.

## Patrones de código

### Adapters

Un proveedor nuevo va detrás de la interfaz que ya existe (`SignerAdapter`, `KeyCustodian`, `IdentityVerifier`, `BiometricEngine`). No crees `backend/bff/src/idv/` ni `IdvSession`: el Sprint 4 dejó el gate en `kycPolicy` sobre `OnboardingCase`. `biometric.adapter.ts` es un método de ceremonia, no el puerto de identidad.

### Tokens

```
plain = randomBytes(32).toString('base64url')
stored = sha256(plain)
```

Se envía `plain` una vez (mail/UI). Se busca por hash.

### Hash de archivo

```
sha256 = createHash('sha256').update(bytes).digest('hex')
```

Nunca hashear el string base64 si podés hashear bytes.

### Passkeys

Challenge de ceremonia = SHA-256 de `frozenHash || envelopeId || nonce`.  
Verificar con SimpleWebAuthn. Guardar `counter`.

## Tests mínimos por PR

- Freeze: segundo write a bytes → 409.  
- Hash mismatch en complete → 409, sin Signer.status=FIRMADO.  
- Token reuse → 410.  
- Tenant A no lee Document de B.  
- El pack trae el hash del canónico igual al freeze (`Document.hash`).  
- INE y selfie no se guardan en base64 en SQL.

Los specs existentes en `signature-requests.service.spec.ts` se actualizan; no se ignoran.

## Estilo

TypeScript strict. Bun. Prisma migrate con nombre explícito (`p1_freeze_tokens`, etc.).  
UI: seguir brand Prestige (no rediseñar).  
Textos de firma: “Acepto” / “Autógrafa” / “Passkey”. Nunca “e.firma SAT” ni “FIEL”.

## Definition of Done P1

Checklist en `PLAN-SPRINTS.md`. Está en 11/11. Abrir HSM es el plan de `P2-KMS.md`, separado del cierre de `fix/p1-hardening`.
