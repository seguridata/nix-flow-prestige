# P2 — Custodia PKCS#11 y constancia (una página)

> Fuera del paquete P1 y del hardening ya integrado en `develop` (`1e22320`). El corte de custodia está en `feat/p2-pkcs11`. P1 está cerrado. El canónico no se muta y `DIGITAL` ya es PAdES/CAdES. P2 no está cerrado: este sandbox no tiene módulo PKCS#11, ni certificado de una CA que Acrobat reconozca, ni contrato de PSC.

## Qué ya hace el código

| Pieza | Estado en `feat/p2-pkcs11` |
|---|---|
| `SoftwareKeyCustodian` | Sigue siendo el default (`KEY_CUSTODIAN=software`). Genera el PKCS#12 en `PKI_DIR`. |
| `Pkcs11KeyCustodian` | Con `KEY_CUSTODIAN=pkcs11` abre el módulo (`PKCS11_MODULE`, `PKCS11_PIN`, `PKCS11_KEY_LABEL`; `PKCS11_SLOT` opcional, default 0) por `graphene-pk11`. Firma con `CKM_RSA_PKCS` sobre el DigestInfo ya armado. No lee `CKA_VALUE` de la llave privada y no devuelve PKCS#12. |
| Falla cerrada | Falta el módulo, el PIN, la etiqueta, el slot, el paquete o el certificado del token: `ServiceUnavailableException`. No cae al custodio de software. El PIN no se escribe en el error. |
| Algoritmo | Sigue RSA (SHA-256 con PKCS#1 v1.5). El camino de software no pasó a ECDSA. |
| Este sandbox | `KEY_CUSTODIAN` sigue en software. No hay módulo, slot, PIN ni certificado AATL/PSC. `graphene-pk11` no está en `package.json`: se carga solo cuando se elige pkcs11. |

## Qué no se movió

- `SigningRouter` y `signature-requests.service.ts` quedan iguales. `DigitalSignerAdapter` elige el firmador: si el material trae `signRsaPkcs1`, arma el PKCS#7 con `TokenBackedSigner`; si trae PKCS#12, sigue `P12Signer`.
- El formato sigue siendo PAdES-B / CAdES-detached. `TokenBackedSigner` produce los mismos bytes que `P12Signer` para el mismo contenido, el mismo certificado y el mismo `Date`.
- `trustedChain` sigue en falso. El sello RFC 3161 sigue apuntando a la TSA de `TSA_URL`.

## Lo que este corte deja abierto

1. **Cadena pública.** Hace falta un certificado que encadene a una raíz del trust store de Adobe (AATL) o a la PSC. Este sandbox no lo tiene.
2. **OCSP/CRL.** La CA interna no trae AIA ni punto de distribución de CRL. node-forge no agrega una CRL al PKCS#7. Un DSS sin respondedor real no se incrusta. Cuando el certificado traiga URL, el corte siguiente la lee y la incrusta como actualización incremental, sin reescribir los bytes de las firmas previas.
3. **Constancia NOM-151.** No hay contrato ni API de PSC. No se construye un cliente. `timestampProvider` y `timestampTokenHash` ya reciben el token RFC 3161.
4. **Verificador.** `verifier/verify.mjs` y `EvidenceService.verify()` siguen comparando el hash del canónico. La validación de una cadena X.509 pública espera a ese certificado. `trustedChain` no se pone en verdadero.

## Orden

Firmar con el token hereda el freeze y el tenant: el canónico no se reescribe y la petición lleva el slug que deja `TenantContextGuard`. Este corte no entra en los commits del hardening. El default del sandbox no se cambia a `pkcs11`.
