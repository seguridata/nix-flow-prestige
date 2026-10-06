# Interoperabilidad con Adobe Acrobat / Reader (Fase B)

La firma DIGITAL de Prestige es **PAdES-B** (`ETSI.CAdES.detached`), incrustada
con `@signpdf` sobre un PDF normalizado con tabla xref clásica
(`pdf-lib … save({ useObjectStreams:false })`). El certificado del firmante lo
emite la CA interna del proyecto (raíz 4096 + intermedia 3072), y la cadena
completa viaja dentro del PKCS#7.

## Lo que ya está verificado (automático)

- `openssl verify` de la cadena firmante → intermedia → raíz: **OK**
  (`8af449b`, e2e en WSL).
- Verificador **offline** propio (`verifier/verify.mjs`, sólo `node-forge`):
  `firmaPAdES estructura=true cadena=true` — **VÁLIDO** (`fc97cee` y posteriores).
- `SigningRouter.verifyPdf()` (`@signpdf` `extractSignature`) sobre el PDF firmado.

## Verificación manual pendiente (Adobe)

Requiere Acrobat Reader DC en una máquina con GUI:

1. Descargar `documento-firmado.pdf` del dossier (`GET /evidence/:id/dossier`).
2. Abrir en Acrobat Reader → panel **Firmas**.
3. Esperado: "Firmado y todas las firmas son válidas" **una vez que la CA raíz
   del proyecto se añade como ancla de confianza** (Preferencias → Firmas →
   Identidades y certificados de confianza → Importar `ca/root.cert.pem`).
   Sin el ancla, Acrobat mostrará "validez desconocida" (no "inválida"), que es
   el comportamiento correcto para una CA privada.
4. Comprobar en **Propiedades de la firma**:
   - Algoritmo: `SHA-256` / `RSA`.
   - "El documento no se ha modificado desde que se firmó".
   - Sello de tiempo: si `TSA_URL` estaba configurada, Acrobat debe mostrar la
     hora de la TSA (RFC 3161) y no la del reloj local.
5. Para **LTV** (Long-Term Validation) en Acrobat hace falta incrustar OCSP/CRL
   en el PDF. Sigue N/A: la CA de software no publica AIA ni CRL DP, y el
   custodio PKCS#11 tampoco incrusta esas respuestas. Hace falta un certificado
   de la PSC que traiga esas URL.

## En producción

Con el HSM y la PKI de SeguriData como PSC acreditado, el certificado del
firmante encadenará a una raíz ya confiable en el trust store de Adobe (AATL)
y la validación será "verde" sin importar anclas manualmente.
