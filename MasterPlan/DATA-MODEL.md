# DATA-MODEL P1

Cambios que este paquete pedía sobre `backend/bff/prisma/schema.prisma`. Lo de abajo de "Conservar" es el pedido original (2026-09-26). El delta es el schema real al 2026-10-05 (`fix/p1-hardening`).

## Delta contra el schema real (2026-10-05)

| Pedido | Qué hay |
|---|---|
| `Document.sha256` | La columna se llama `hash`. También `frozenAt`, `enc`, `presentedObjectKey`, `presentedHash`. |
| `contentBase64` nullable | La columna no existe. |
| `SignatureRequest.templateId` | No hay columna. `templateId` se resuelve al crear y no se guarda. Sí están `kycPolicy` y `requirePasskey`. |
| `Signer.lastIdvSessionId` | No existe. |
| `EvidenceManifest.packObjectKey` | No existe. El pack se arma en el servicio de evidencia; el manifiesto guarda hashes, token RFC 3161 y firma Ed25519. |
| `Membership` | `TenantMembership`: `tenantId` es la FK al uuid de `Tenant`, más `roles[]`, `email`, `name`, `active`. El slug vive en `Tenant.slug`. |
| `EnvelopeToken` | `OneTimeLink`: `tokenHash`, `expiresAt`, `usedAt`, `signerId`, `signatureRequestId`. Sin `tenantId` y sin `frozenHash`. |
| `PasskeyCredential` | Existe, más `PasskeyAssertion` y `PasskeyRegistrationChallenge`. |
| `EnvelopeTemplate` | Existe, por tenant, nombre único. |
| `IdvSession` | No existe. El alta vive en `OnboardingCase` (claves de storage, OCR, scores, consentimiento). |
| `KycPolicy` | `NONE`, `ONCE`, `EVERY_SIGN`. |
| `SignatureMethod` | `DIGITAL`, `AUTOGRAFA`, `BIOMETRICA`, `ACCEPT`, `PASSKEY`. `DIGITAL` es PAdES real y se ofrece en la UI. |
| `ProcessAuditEvent.tenantId` | Nullable, desde `20261005100000_p1_tenant_scoping`. La cadena ya tenía `prevHash` desde M11. |

El mismo hardening añadió `tenantId` nullable en `NotificationOutbox`, `HumanTask`, `DocumentComment`, `UserNotification`, `ProcessWatcher`, `WorkflowRun` y `SignatureField`. `bun run backfill:tenant-ids` (`663d5f5`) rellena outbox y `UserNotification` cuando hay una pista única; lo demás se queda NULL. `WebhookSubscription` tiene `previousSecret` y `previousSecretUntil` (`20261005120000_webhook_secret_rotation`).

## Conservar

`Case`, `SignatureField`, `HumanTask`, `ConsentAcceptance`, `WorkflowRun`, `DocumentComment`, `UserNotification`, `ProcessDefinition`, `ProcessWatcher`, `OnboardingKind/Status`.

## Modificar

### Case

Sin cambio de forma. `tenantId` ya existe.

### Document

```
tenantId        String
sha256          String     // API name; map from hash or rename column
locked          Boolean
objectKey       String     // required after migrate
contentBase64   String?    // nullable, stop writing
currentVersion  Int
```

Índice `@@index([tenantId, caseId])`.

### SignatureRequest (API: Envelope)

```
tenantId        String
kycPolicy       KycPolicy  @default(NONE)  // NONE | ONCE | EVERY_SIGN
templateId      String?
requirePasskey  Boolean    @default(false)
```

### Signer (API: Recipient)

Sin cambio fuerte. Añadir `lastIdvSessionId String?`.

### EvidenceManifest

Añadir `packObjectKey String?`. Seguir usando hashes existentes.

### ProcessAuditEvent

```
tenantId   String
prevHash   String?
eventHash  String
```

`@@index([tenantId, createdAt])`

### OnboardingCase

Eliminar (migración): `ineFrontBase64`, `ineBackBase64`, `selfieBase64`.  
Añadir: `idvSessionId`, `ineObjectPrefix String?` (keys MinIO, no bytes).

## Nuevas tablas

### Membership

```
id, userId, tenantId, role, createdAt
@@unique([userId, tenantId])
```

### Document no se parte en P1 si duele — alternativa EnvelopeToken

### EnvelopeToken

```
id                String  @id
tenantId          String
signatureRequestId String
signerId          String
tokenHash         String  @unique
expiresAt         DateTime
usedAt            DateTime?
frozenHash        String
```

### PasskeyCredential

```
id, tenantId, userId?, signerId?,
credentialId Bytes @unique
publicKey    Bytes
counter      BigInt
transports   String[]
createdAt
```

### EnvelopeTemplate

```
id, tenantId, name, order, kycPolicy,
allowedMethods SignatureMethod[],
requirePasskey, slaHours, createdAt
```

### IdvSession

```
id, tenantId, vendor, vendorSessionId,
purpose     String
subjectRef  String?
status      String
renapoStatus String?
ineStatus    String?
liveness     Boolean?
faceScore    Float?
faceMatch    Boolean?
resultJson   Json?     // sin imágenes
createdAt
```

## Enums nuevos

```
enum KycPolicy { NONE ONCE EVERY_SIGN }
```

`SignatureMethod` P1: `AUTOGRAFA | BIOMETRICA | ACCEPT | PASSKEY`  
Dejar `DIGITAL` en enum por no romper datos; UI lo esconde salvo `ALLOW_DEV_HMAC`.

## Migración

Una migrate por sprint, no un big-bang. Orden:

1. `p1_tenant_columns`  
2. `p1_nullable_base64`  
3. `p1_tokens_templates_kyc`  
4. `p1_passkeys_idv_sessions`  
5. `p1_audit_chain`  
6. `p1_drop_idv_blobs` (cuando el código ya no lea esas columnas)
