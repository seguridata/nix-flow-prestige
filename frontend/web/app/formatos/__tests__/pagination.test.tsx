import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FormatosPage from "../page";

const { fetchPage, session } = vi.hoisted(() => ({
  fetchPage: vi.fn(), session: { tenantId: "A", signerId: "persona", roles: [] as string[] },
}));
vi.mock("@/services/formats-service", () => ({ fetchFormatsPage: fetchPage }));
vi.mock("@/store/session-store", () => ({ useSession: () => session }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/chat/template-drafts", () => ({ TemplateDrafts: () => null }));

const format = (i: number, tenant = "A") => ({ id: `${tenant}-${i}`, name: i === 234 ? "Último especial" : `Formato ${i}`, category: i % 2 ? "Operación" : "Finanzas", description: null, fieldCount: 1, stepCount: 1, published: true, kind: "FORM" });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => <QueryClientProvider client={client}><FormatosPage /></QueryClientProvider>;
  return { ...render(view()), client, view };
}

describe("Formatos: catálogo completo por páginas", () => {
  beforeEach(() => {
    session.tenantId = "A";
    session.signerId = "persona";
    fetchPage.mockReset();
    fetchPage.mockImplementation(async (_all: boolean, cursor: string | null) => {
      const start = cursor ? Number(cursor.split(":")[1]) : 0;
      const end = Math.min(start + 50, 235);
      return { items: Array.from({ length: end - start }, (_, i) => format(start + i, session.tenantId)), nextCursor: end < 235 ? `${session.tenantId}:${end}` : null };
    });
  });

  it("permite alcanzar registros más allá de200 y anuncia final sin duplicar", async () => {
    setup();
    await screen.findByRole("link", { name: /Formato 0 / });
    for (let i = 0; i < 4; i++) {
      const button = screen.getByRole("button", { name: "Cargar más formatos" });
      fireEvent.click(button);
      await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(i + 2));
      await waitFor(() => expect(button).not.toBeDisabled());
    }
    expect(await screen.findByRole("link", { name: /Último especial/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar más formatos" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("235 formatos visibles entre 235 cargados");
  });

  it("no oculta Cargar más cuando un filtro todavía no encuentra resultados; cambiar filtro reinicia", async () => {
    setup();
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más formatos" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("100 cargados"));
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar formato" }), { target: { value: "especial" } });
    expect(await screen.findByText("No hay coincidencias entre los formatos cargados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar más formatos" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("50 cargados");
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar formato" }), { target: { value: "" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("50 formatos visibles entre 50 cargados"));
  });

  it("cambiar tenant elimina filtros y filas previas y comienza sin cursor", async () => {
    const { rerender, view } = setup();
    await screen.findByRole("status");
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar formato" }), { target: { value: "Formato 1" } });
    await screen.findByRole("status");
    session.tenantId = "B";
    rerender(view());
    await screen.findByRole("status");
    expect(screen.getByRole("textbox", { name: "Buscar formato" })).toHaveValue("");
    expect(screen.getByRole("link", { name: /Formato 0 / })).toHaveAttribute("href", "/formatos/B-0");
    expect(fetchPage).toHaveBeenLastCalledWith(false, null);
  });

  it("un error al cargar más conserva la página visible y ofrece reintento", async () => {
    setup();
    await screen.findByRole("status");
    fetchPage.mockRejectedValueOnce(new Error("fallo de red"));
    fireEvent.click(screen.getByRole("button", { name: "Cargar más formatos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conservamos los formatos cargados");
    expect(screen.getByRole("link", { name: /Formato 0 / })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cargar más formatos" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("100 cargados"));
  });
});
