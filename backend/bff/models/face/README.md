> **Fuente de la verdad (17 oct 2026):** la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa) manda sobre estado, pendientes y decisiones. El [espejo en el repo](../../../../MasterPlan/ESTADO-Y-PENDIENTES.md) lo replica; los documentos históricos y las especificaciones técnicas conservan su alcance.

# Pesos de face-api (M16 — `BIOMETRIC_ENGINE=local`)

`LocalFaceBiometricEngine` (`src/identity/biometric-engine.ts`) carga desde este
directorio (`FACE_MODEL_DIR`, por defecto `./models/face`):

- `ssd_mobilenetv1_model-weights_manifest.json` + shards
- `face_landmark_68_model-weights_manifest.json` + shards
- `face_recognition_model-weights_manifest.json` + shards

Descargar del repositorio oficial (Apache-2.0):
<https://github.com/vladmandic/face-api/tree/master/model>

```bash
cd backend/bff/models/face
for m in ssd_mobilenetv1 face_landmark_68 face_recognition; do
  curl -LO "https://raw.githubusercontent.com/vladmandic/face-api/master/model/${m}_model-weights_manifest.json"
done
# + los .bin que referencian los manifests (mismo directorio del repo)
```

Sin estos archivos el motor `local` reporta `available()=false` y el alta cae a
**revisión manual** (nunca un falso positivo). El motor `noop` (por defecto) y el
`remote` (`BIOMETRIC_PROVIDER_URL`) no necesitan nada de esto.
