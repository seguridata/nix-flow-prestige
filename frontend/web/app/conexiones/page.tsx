"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Plug2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/services/api-client";
import { useSession } from "@/store/session-store";

type McpInfo = { enabled: boolean; reason?: string; resource?: string; metadata?: string; issuer?: string; scope?: string; clientId?: string; tools?: string[]; readOnly?: boolean };
const toolLabels: Record<string, [string, string]> = {
  prestige_list_processes: ["Procesos publicados", "Consulta los flujos disponibles en tu organización."],
  prestige_list_formats: ["Formatos", "Encuentra los formatos que puedes usar."],
  prestige_my_requests: ["Mis solicitudes", "Consulta tus solicitudes y su estado."],
  prestige_my_tasks: ["Mis tareas", "Revisa las acciones asignadas a tu cuenta."],
  prestige_request_status: ["Estado del expediente", "Sigue una solicitud a la que tengas acceso."],
};

export default function ConexionesPage() {
  const { roles } = useSession();
  const admin = roles.includes("admin");
  const info = useQuery({ queryKey: ["mcp-info"], queryFn: () => apiClient.get<McpInfo>("/mcp/info"), enabled: admin });
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success("Copiado al portapapeles."); } catch { toast.error("No pudimos copiar. Selecciona y copia la dirección."); } };
  return <AppShell title="Conexiones">
    <div className="max-w-5xl">
      <div className="flex items-start gap-4"><Plug2 className="mt-1 size-6 shrink-0" /><div><h2 className="text-2xl font-semibold">Prestige, desde tu asistente</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Conecta un cliente compatible con MCP para consultar procesos, tareas y solicitudes usando tu cuenta corporativa. Cada consulta conserva tus permisos y los de tu organización.</p></div></div>
      {!admin ? <p className="mt-8 text-sm">Solicita a tu administrador la URL de conexión de tu organización.</p> : info.isLoading ? <p className="mt-8" role="status">Consultando la configuración real…</p> : info.isError ? <div role="alert" className="mt-8 border-y border-border py-6"><p>No pudimos consultar el servidor MCP.</p><Button className="mt-3" variant="outline" onClick={() => info.refetch()}>Reintentar</Button></div> : <>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-y border-border py-5"><span className="flex items-center gap-2 font-medium">{info.data?.enabled ? <><Check className="size-4" /> Servidor configurado · Solo lectura</> : "Conexión sin activar"}</span><Button variant="outline" size="sm" onClick={() => info.refetch()} disabled={info.isFetching}><RefreshCw className="size-4" /> Verificar configuración</Button></div>
        {!info.data?.enabled ? <p className="mt-5 text-sm text-muted-foreground">{info.data?.reason || "Configura la URL pública y la autorización corporativa para habilitar esta conexión."}</p> : <>
          <section className="mt-7" aria-labelledby="mcp-url"><h3 id="mcp-url" className="font-semibold">URL del servidor MCP</h3><div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-muted p-4"><code className="min-w-0 flex-1 break-all text-sm">{info.data.resource}</code><Button variant="outline" size="sm" onClick={() => copy(info.data!.resource!)}><Copy className="size-4" /> Copiar URL</Button></div></section>
          <ol className="my-8 space-y-5" aria-label="Cómo conectar un asistente"><li><span className="font-semibold">1. Agrega un servidor en tu asistente</span><p className="mt-1 text-sm text-muted-foreground">Pega la URL de Prestige en la sección de conectores o servidores MCP.</p></li><li><span className="font-semibold">2. Autoriza con tu cuenta corporativa</span><p className="mt-1 text-sm text-muted-foreground">Se abrirá Keycloak. Inicia sesión y revisa el permiso de lectura antes de continuar.</p></li><li><span className="font-semibold">3. Consulta tus procesos y pendientes</span><p className="mt-1 text-sm text-muted-foreground">El asistente consulta información autorizada. La publicación, las firmas y los envíos se realizan desde Prestige.</p></li></ol>
          <section aria-labelledby="mcp-tools"><h3 id="mcp-tools" className="text-lg font-semibold">Qué puedes consultar</h3><ul className="mt-3 divide-y divide-border border-y border-border">{(info.data.tools ?? []).map(name => <li key={name} className="grid gap-1 py-4 sm:grid-cols-[13rem_1fr]"><span className="font-medium">{toolLabels[name]?.[0] || name}</span><span className="text-sm text-muted-foreground">{toolLabels[name]?.[1] || "Consulta con los permisos de tu cuenta."}</span></li>)}</ul></section>
          <details className="mt-7 border-b border-border pb-5"><summary className="cursor-pointer text-sm font-medium">Configuración para equipos técnicos</summary><dl className="mt-4 grid gap-2 break-all text-sm sm:grid-cols-[10rem_1fr]"><dt className="text-muted-foreground">Cliente OAuth</dt><dd>{info.data.clientId}</dd><dt className="text-muted-foreground">Permiso</dt><dd>{info.data.scope}</dd><dt className="text-muted-foreground">Autorización</dt><dd>Código de autorización con PKCE S256</dd><dt className="text-muted-foreground">Metadata</dt><dd><a className="inline-flex items-center gap-1 underline underline-offset-4" href={info.data.metadata} target="_blank" rel="noreferrer">Abrir metadata <ExternalLink className="size-3" /></a></dd></dl><Button className="mt-4" variant="outline" size="sm" onClick={() => copy(JSON.stringify({ mcpServers: { prestige: { url: info.data!.resource } } }, null, 2))}><Copy className="size-4" /> Copiar configuración JSON</Button></details>
        </>}
      </>}
    </div>
  </AppShell>;
}
