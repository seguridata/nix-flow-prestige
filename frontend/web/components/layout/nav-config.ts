import type { Route } from "next";
import {
  Files,
  FileText,
  FolderOpen,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Plug2,
  Send,
  Server,
  Table2,
  UserPlus,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: Route;
  label: string;
  /** Una línea que dice para qué sirve; se usa en tooltips y en la paleta. */
  hint: string;
  icon: LucideIcon;
  /** La entrada solo se muestra si el usuario tiene alguno (espeja los @Roles del BFF). */
  roles?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Navegación agrupada por lo que la persona quiere hacer, no por módulo técnico.
 * - Trabajo: lo que requiere mi acción hoy.
 * - Documentos: dónde vive el material (archivos, formatos, plantillas).
 * - Configuración: cómo se arma y se vigila el sistema (solo quien lo administra).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "trabajo",
    label: "Mi trabajo",
    items: [
      { href: "/overview", label: "Inicio", hint: "Qué necesita tu atención hoy", icon: LayoutDashboard },
      { href: "/inbox", label: "Por firmar", hint: "Documentos que esperan tu firma o revisión", icon: Inbox },
      { href: "/sent", label: "Enviados", hint: "Seguimiento de lo que enviaste", icon: Send },
      { href: "/tasks", label: "Tareas", hint: "Tareas de los procesos asignadas a ti", icon: ListChecks },
    ],
  },
  {
    id: "documentos",
    label: "Documentos",
    items: [
      { href: "/documentos" as Route, label: "Mis documentos", hint: "Archivos y carpetas", icon: FolderOpen },
      { href: "/formatos" as Route, label: "Formatos", hint: "Solicitudes que se llenan en línea", icon: FileText },
      {
        href: "/plantillas",
        label: "Plantillas de envío",
        hint: "Valores por defecto para enviar a firma",
        icon: Files,
        roles: ["sender", "admin"],
      },
    ],
  },
  {
    id: "identidad",
    label: "Personas",
    items: [
      {
        href: "/onboarding",
        label: "Altas de identidad",
        hint: "Verificar y habilitar firmantes",
        icon: UserPlus,
        roles: ["rh", "admin"],
      },
    ],
  },
  {
    id: "configuracion",
    label: "Configuración",
    items: [
      {
        href: "/process",
        label: "Procesos",
        hint: "Etapas y responsables de cada solicitud",
        icon: GitBranch,
        roles: ["sender", "admin"],
      },
      { href: "/flujos" as Route, label: "Flujos", hint: "Flujos publicados", icon: Workflow, roles: ["admin"] },
      {
        href: "/tablas-consulta" as Route,
        label: "Tablas de consulta",
        hint: "Datos para asignar responsables",
        icon: Table2,
        roles: ["admin"],
      },
      {
        href: "/operations",
        label: "Operación",
        hint: "Salud del sistema y envíos con problemas",
        icon: Server,
        roles: ["sender", "rh", "admin"],
      },
      { href: "/conexiones" as Route, label: "Conexiones", hint: "Integraciones externas", icon: Plug2, roles: ["admin"] },
    ],
  },
];

export function visibleGroups(roles: string[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r))),
  })).filter((g) => g.items.length > 0);
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
