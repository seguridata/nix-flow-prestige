"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CircleAlert, CircleCheck, Copy, ExternalLink, Plug2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/services/api-client";
import { useSession } from "@/store/session-store";

type McpInfo = {
  enabled: boolean;
  reason?: string;
  resource?: string;
  metadata?: string;
  issuer?: string;
  scope?: string;
  clientId?: string;
  tools?: string[];
  readOnly?: boolean;
};

const toolLabels: Record<string, [string, string]> = {
  prestige_list_processes: ["Procesos publicados", "Consulta los flujos disponibles en tu organización."],
  prestige_list_formats: ["Formatos", "Encuentra los formatos que puedes usar."],
  prestige_my_requests: ["Mis solicitudes", "Consulta tus solicitudes y su estado."],
  prestige_my_tasks: ["Mis tareas", "Revisa las acciones asignadas a tu cuenta."],
  prestige_request_status: ["Estado del expediente", "Sigue una solicitud a la que tengas acceso."],
};

const STEPS: [string, string][] = [
  ["Agrega un servidor en tu asistente", "Pega la URL de Prestige en la sección de conectores o servidores MCP."],
  ["Autoriza con tu cuenta corporativa", "Se abrirá Keycloak. Inicia sesión y revisa el permiso de lectura antes de continuar."],
  [
    "Consulta tus procesos y pendientes",
    "El asistente consulta información autorizada. La publicación, las firmas y los envíos se realizan desde Prestige.",
  ],
];

export default function ConexionesPage() {
  const { roles } = useSession();
  const admin = roles.includes("admin");
  const info = useQuery({ queryKey: ["mcp-info"], queryFn: () => apiClient.get<McpInfo>("/mcp/info"), enabled: admin });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado al portapapeles.");
    } catch {
      toast.error("No pudimos copiar. Selecciona y copia la dirección.");
    }
  };

  return (
    <AppShell title="Conexiones">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Prestige, desde tu asistente"
          description="Conecta un cliente compatible con MCP para consultar procesos, tareas y solicitudes con tu cuenta corporativa. Cada consulta conserva tus permisos y los de tu organización."
        />

        {!admin ? (
          <EmptyState
            icon={<Plug2 />}
            title="Pide la conexión a tu administrador"
            description="La URL de conexión de tu organización la entrega quien administra Prestige."
          />
        ) : info.isLoading ? (
          <div role="status" aria-label="Consultando la configuración" className="space-y-3">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        ) : info.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-foreground p-5 text-sm">
            <CircleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
            <span>No pudimos consultar el servidor MCP.</span>
            <Button size="sm" variant="outline" onClick={() => info.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-background p-4">
              <span className="flex items-center gap-2 font-medium">
                {info.data?.enabled ? (
                  <>
                    <CircleCheck className="size-5" aria-hidden /> Servidor configurado · solo lectura
                  </>
                ) : (
                  <>
                    <CircleAlert className="size-5 text-destructive" aria-hidden /> Conexión sin activar
                  </>
                )}
              </span>
              <Button variant="outline" onClick={() => info.refetch()} disabled={info.isFetching}>
                <RefreshCw className={info.isFetching ? "animate-spin" : undefined} /> Verificar configuración
              </Button>
            </div>

            {!info.data?.enabled ? (
              <p className="max-w-[65ch] text-sm text-muted-foreground">
                {info.data?.reason || "Configura la URL pública y la autorización corporativa para habilitar esta conexión."}
              </p>
            ) : (
              <>
                <section aria-labelledby="mcp-url">
                  <h2 id="mcp-url" className="text-lg font-semibold">
                    URL del servidor MCP
                  </h2>
                  <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-muted p-4">
                    <code className="min-w-0 flex-1 break-all font-mono text-sm">{info.data.resource}</code>
                    <Button onClick={() => copy(info.data!.resource!)}>
                      <Copy /> Copiar URL
                    </Button>
                  </div>
                </section>

                <section aria-labelledby="mcp-steps">
                  <h2 id="mcp-steps" className="text-lg font-semibold">
                    Cómo conectar un asistente
                  </h2>
                  <ol className="mt-3 space-y-4">
                    {STEPS.map(([title, text], i) => (
                      <li key={title} className="flex gap-3">
                        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border border-foreground text-sm font-medium">
                          {i + 1}
                        </span>
                        <span>
                          <span className="block font-medium">{title}</span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">{text}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>

                <Collapsible title="Qué puedes consultar" hint={`${(info.data.tools ?? []).length} herramientas de solo lectura`}>
                  <ul className="divide-y divide-border">
                    {(info.data.tools ?? []).map((name) => (
                      <li key={name} className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr]">
                        <span className="font-medium">{toolLabels[name]?.[0] || name}</span>
                        <span className="text-sm text-muted-foreground">{toolLabels[name]?.[1] || "Consulta con los permisos de tu cuenta."}</span>
                      </li>
                    ))}
                  </ul>
                </Collapsible>

                <Collapsible title="Configuración para equipos técnicos">
                  <dl className="grid gap-2 break-all text-sm sm:grid-cols-[10rem_1fr]">
                    <dt className="text-muted-foreground">Cliente OAuth</dt>
                    <dd>{info.data.clientId}</dd>
                    <dt className="text-muted-foreground">Permiso</dt>
                    <dd>{info.data.scope}</dd>
                    <dt className="text-muted-foreground">Autorización</dt>
                    <dd>Código de autorización con PKCE S256</dd>
                    <dt className="text-muted-foreground">Metadata</dt>
                    <dd>
                      <a
                        className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 sm:min-h-0"
                        href={info.data.metadata}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir metadata <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </dd>
                  </dl>
                  <Button
                    className="mt-4"
                    variant="outline"
                    onClick={() => copy(JSON.stringify({ mcpServers: { prestige: { url: info.data!.resource } } }, null, 2))}
                  >
                    <Copy /> Copiar configuración JSON
                  </Button>
                </Collapsible>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Collapsible({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-background">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        <span className="font-medium">{title}</span>
        {hint ? <span className="hidden text-sm text-muted-foreground sm:inline">{hint}</span> : null}
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}
