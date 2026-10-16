-- ADR-008 - la matriz de responsables de gasto ya vive en la tabla de consulta «responsables-gasto» (migracion 20261018100000).
-- Ningun codigo ni pantalla usa ya ExpenseResponsible.

-- DropTable
DROP TABLE "ExpenseResponsible";
