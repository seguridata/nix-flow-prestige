> **Fuente de la verdad (17 oct 2026):** la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa) manda sobre estado, pendientes y decisiones. El [espejo en el repo](../MasterPlan/ESTADO-Y-PENDIENTES.md) lo replica; los documentos históricos y las especificaciones técnicas conservan su alcance.

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
