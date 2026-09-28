# P2 — Firma digital real en KMS/HSM (una página)

> Fuera de alcance de este paquete P1. Documento puente para cuando se abra P2 — la regla de oro de `00-FASES.md` sigue aplicando: **no se abre P2 mientras el PDF original se muta o `DIGITAL` es HMAC sin flag `DEV_ONLY`.** Ninguna de las dos condiciones aplica hoy: el canónico no se muta (freeze verificado, Sprint 1) y `DIGITAL` ya es PAdES/CAdES real con CA propia (Fase B), no HMAC. La puerta está abierta; lo que sigue es sustituir la CA de software por un HSM real.

## Qué cambia respecto a hoy

| Hoy (CA de software) | P2 (KMS/HSM) |
|---|---|
| `SoftwareKeyCustodian` genera y guarda la clave privada en disco (`PKI_DIR`), cifrada con `PKI_PASSPHRASE` | La clave privada nunca sale del HSM/KMS; solo se invoca una operación de firma |
| CA raíz + intermedia propias del proyecto | Certificado emitido por una CA que Adobe/Acrobat reconozca (AATL) o por la PSC de SeguriData |
| `Pkcs11KeyCustodian` existe como interfaz pero lanza "servicio no disponible" | `Pkcs11KeyCustodian` se conecta a un módulo PKCS#11 real (slot + PIN) |

## Qué NO cambia

- El contrato `SignerAdapter`/`KeyCustodian` ya está detrás de interfaz (`backend/bff/src/signing/pki/key-custodian.ts`) — sustituir la implementación no debería tocar `SigningRouter`, `DigitalSignerAdapter` ni el pipeline de `signature-requests.service.ts`.
- El formato de firma sigue siendo PAdES-B / CAdES-detached (`@signpdf`), ya validado con `openssl verify` y el verificador offline propio.
- El sello de tiempo RFC 3161 ya es real (Fase B); P2 solo necesita decidir si la TSA usada es de confianza pública (`trustedChain: true`) — hoy es `false` porque la CA es propia.

## Trabajo concreto de P2

1. **Custodio HSM real**: implementar `Pkcs11KeyCustodian` contra un HSM/KMS (AWS KMS, Azure Key Vault, o PKCS#11 físico). Algoritmo `ECDSA_P256` (o el que el HSM elegido soporte) en vez de RSA de software.
2. **Cadena de confianza pública**: certificado del firmante encadenando a una raíz en el trust store de Adobe (AATL) o a la PSC acreditada de SeguriData — no la CA interna del taller.
3. **OCSP/CRL**: incrustar material de validación de largo plazo (LTV) en el PDF para que Acrobat valide sin conexión ni ancla manual.
4. **Constancia NOM-151**: contratar y conectar un prestador de servicios de certificación (PSC) que emita la constancia real; el manifiesto ya tiene los campos `timestampProvider`/`timestampTokenHash` listos para recibirla.
5. **Verificar el pack**: el verificador offline (`verifier/verify.mjs`) y `EvidenceService.verify()` deben aceptar la nueva cadena de confianza sin cambiar su lógica de comparación de hashes — solo la validación de la cadena X.509 cambia de "propia" a "pública".

## Riesgo de no hacerlo en orden

Firmar con HSM sobre un canónico que todavía se pudiera mutar, o sin haber cerrado tenant/freeze (P1), heredaría el mismo problema de integridad que P1 vino a resolver — solo que con una firma más cara y más difícil de revocar. Por eso P2 espera.
