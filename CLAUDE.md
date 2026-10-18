# Continuidad de Prestige para Claude

**La fuente de la verdad de estado, pendientes y decisiones es la [página de Notion de Prestige](https://app.notion.com/p/3fac115acdaa812884a9de319b704baa)** (`3fac115a-cdaa-8128-84a9-de319b704baa`). [`MasterPlan/ESTADO-Y-PENDIENTES.md`](MasterPlan/ESTADO-Y-PENDIENTES.md) es su espejo en el repo; si difieren, manda Notion. Al cerrar una tanda se actualiza Notion primero y luego el espejo. Nunca escribas contraseñas en Notion ni en el repo.

Lee primero el espejo, después [reglas del proyecto](MasterPlan/AGENTS.md) y el [índice de MasterPlan](MasterPlan/README.md). Antes de editar frontend, lee también `frontend/web/AGENTS.md`.

Rama de trabajo: `develop`, con commits temáticos. `main` solo recibe el PR que apruebe el dueño. No reiniciar fases completadas.

Docker/Prisma/dev en WSL sobre este repo Windows; BFF 3000, web 3001, monitor ajeno 4000 intocable. No borrar volúmenes ni copiar secretos. No confundir pruebas registradas de sesiones anteriores con una comprobación actual del runtime o producción.
