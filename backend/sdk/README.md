# SDK de Prestige (M14)

Todo se deriva del **OpenAPI real** que emite el BFF:

- Swagger UI: `GET /docs`
- OpenAPI JSON: `GET /docs-json`
- Volcado en repo (dev, al arrancar el BFF): `backend/contracts/openapi.generated.json`
- Colección Postman del caso ancla + webhooks: `backend/contracts/prestige.postman_collection.json`

## TypeScript (`sdk/typescript/`)

- `schema.d.ts` — **generado**: `cd backend/bff && bun run sdk:gen`
  (`openapi-typescript ../contracts/openapi.generated.json -o ../sdk/typescript/schema.d.ts`).
  Regenerar tras cualquier cambio de contrato.
- `client.ts` — cliente fino tipado contra `schema.d.ts` (`PrestigeClient`) +
  `verifyWebhookSignature()` (Web Crypto).

```ts
import { PrestigeClient } from './sdk/typescript/client';
const api = new PrestigeClient({ baseUrl: 'http://localhost:3000', token });
const req = await api.post('/signature-requests', {
  documentId, methods: ['DIGITAL'], signers: [{ signerId: 'maria', name: 'María' }],
});
```

## Python (`sdk/python/`)

- `prestige_client.py` — `PrestigeClient` (requests) + `verify_webhook_signature()`.
- Para un cliente 100 % tipado: `openapi-generator-cli generate -i ../contracts/openapi.generated.json -g python -o ./generated`.

## Webhooks

Cada entrega lleva:

| Cabecera | Valor |
|---|---|
| `X-Prestige-Event` | tipo CloudEvents (`mx.seguridata.prestige.request.completed`, `…evidence.sealed`, `…onboarding.enabled`) |
| `X-Prestige-Delivery` | id de la entrega (idempotencia en el receptor) |
| `X-Prestige-Timestamp` | epoch ms |
| `X-Prestige-Signature` | `sha256=` + HMAC-SHA256 de `` `${timestamp}.${rawBody}` `` con el `secret` de la suscripción |

El cuerpo es un **CloudEvent 1.0** (`specversion`, `id`, `type`, `source`, `time`,
`tenantid`, `data`). Verifica la firma **antes** de parsear y responde `2xx` para
confirmar; cualquier otra cosa se reintenta con backoff exponencial y acaba en
la **DLQ** (`GET /webhooks/deliveries?status=DLQ`, `POST /webhooks/deliveries/:id/retry`).
