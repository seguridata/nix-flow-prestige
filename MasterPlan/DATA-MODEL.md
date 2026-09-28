# DATA-MODEL P1

Cambios sobre `backend/bff/prisma/schema.prisma`.

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
