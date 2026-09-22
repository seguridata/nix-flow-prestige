# Verificador offline del expediente probatorio

Valida un expediente de Prestige SIN el BFF, la base de datos ni Temporal.

```
cd verificador
npm install
node verify.mjs <carpeta-del-expediente>
```

Comprueba: hash del manifiesto, firma Ed25519, cadena de custodia SHA-256,
`signedHash`/`packageHash`, firma PAdES/PKCS#7 del PDF (cadena a la CA) y el
sello de tiempo RFC 3161 sobre `packageHash`.

El expediente se descarga de `GET /evidence/:manifestId/dossier`.
