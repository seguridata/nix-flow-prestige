import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import InboxPage from "@/app/inbox/page";
import SentPage from "@/app/sent/page";
import { SessionContext, type SessionUser } from "@/store/session-store";
import { type InboxItem, type InboxPage as ResultPage, filterInboxItems, mergeInboxPages } from "@/services/inbox-service";

const { inboxPage, sentPage } = vi.hoisted(() => ({ inboxPage: vi.fn(), sentPage: vi.fn() }));
vi.mock("@/services/inbox-service", async original => ({ ...await original<typeof import("@/services/inbox-service")>(), fetchInboxPage: inboxPage, fetchSentPage: sentPage }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/inbox/evidence-panel", () => ({ EvidencePanel: () => <div>Detalle de evidencia</div> }));
vi.mock("@/components/inbox/signer-rail", () => ({ SignerRail: () => null }));

const session: SessionUser = { tenantId: "acme", signerId: "alice", name: "Alice", email: null, roles: ["sender"] };
const item = (n: number, title = `Gasto ${n}`): InboxItem => ({ signatureRequestId: `request-${n}`, documentId: `doc-${n}`, documentTitle: title, caseTitle: title, requestedByName: "Alice", status: "COMPLETADA", myStatus: "FIRMADO", methods: ["ACCEPT"], createdAt: "2026-10-17T00:00:00Z", signers: [] });
const page = (from: number, to: number, next: string | null): ResultPage => ({ items: Array.from({ length: to - from + 1 }, (_, n) => item(from + n)), nextCursor: next });
function mount(component: ReactNode = <InboxPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = (user: SessionUser) => <QueryClientProvider client={client}><SessionContext.Provider value={user}>{component}</SessionContext.Provider></QueryClientProvider>;
  const rendered = render(tree(session));
  return { client, changeSession: (user: SessionUser) => rendered.rerender(tree(user)) };
}
beforeEach(() => {
  inboxPage.mockReset(); sentPage.mockReset();
  inboxPage.mockResolvedValue({ items: [], nextCursor: null }); sentPage.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(cleanup);

describe("Inbox pagination", () => {
  it("loads beyond 200, removes overlapping pages and stops at the final cursor", async () => {
    inboxPage.mockImplementation(async (cursor?: string) => {
      const start = cursor ? Number(cursor) : 1;
      const end = Math.min(start + 49, 205);
      return page(start, end, end < 205 ? String(end + 1) : null);
    });
    mount();
    await screen.findByText("Gasto 1");
    for (const end of [100, 150, 200, 205]) {
      fireEvent.click(screen.getByRole("button", { name: "Cargar más sobres" }));
      await screen.findByText(`Gasto ${end}`);
    }
    expect(screen.getAllByText(/^Gasto \d+$/)).toHaveLength(205);
    expect(screen.queryByRole("button", { name: "Cargar más sobres" })).not.toBeInTheDocument();
    expect(inboxPage.mock.calls.map(call => call[0])).toEqual([undefined, "51", "101", "151", "201"]);
  });
  it("keeps load-more visible when the search has no matches and retains the search while paging", async () => {
    inboxPage.mockImplementation(async (cursor?: string) => cursor ? { items: [item(2, "Licencia anual")], nextCursor: null } : { items: [item(1, "Papelería")], nextCursor: "older" });
    mount(); await screen.findByText("Papelería");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Licencia" } });
    await screen.findByText("Sin coincidencias en los sobres cargados");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más sobres" }));
    await screen.findByText("Licencia anual");
    expect(screen.getByRole("searchbox")).toHaveValue("Licencia"); expect(screen.queryByText("Papelería")).toBeNull();
  });
  it("preserves loaded records and retries a failed next page", async () => {
    let attempts = 0;
    inboxPage.mockImplementation(async (cursor?: string) => {
      if (!cursor) return { items: [item(1)], nextCursor: "next" };
      if (attempts++ === 0) throw new Error("Offline");
      return { items: [item(1), item(2)], nextCursor: null };
    });
    mount(); await screen.findByText("Gasto 1"); fireEvent.click(screen.getByRole("button", { name: "Cargar más sobres" }));
    await screen.findByRole("alert"); expect(screen.getByText("Gasto 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cargar más sobres" }));
    await screen.findByText("Gasto 2"); expect(screen.getAllByText("Gasto 1")).toHaveLength(1);
  });
  it("resets cursor and records when tenant or filter changes, with isolated query keys", async () => {
    let otherTenant = false;
    inboxPage.mockImplementation(async (cursor?: string) => ({ items: [item(cursor ? 2 : 1, otherTenant ? "Gasto de otro espacio" : cursor ? "Anterior" : "Actual")], nextCursor: cursor || otherTenant ? null : "old" }));
    const { client, changeSession } = mount(); await screen.findByText("Actual");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más sobres" })); await screen.findByText("Anterior");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Actual" } });
    await waitFor(() => expect(inboxPage.mock.calls.at(-1)?.[0]).toBeUndefined());
    expect(screen.queryByText("Anterior")).toBeNull();
    otherTenant = true; changeSession({ ...session, tenantId: "tenant-b" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    await screen.findByText("Gasto de otro espacio"); expect(screen.queryByText("Actual")).toBeNull();
    expect(client.getQueryCache().findAll().some(query => query.queryKey[2] === "tenant-b")).toBe(true);
  });
  it("paginates sent entries with a visible action even when the current filter is empty", async () => {
    sentPage.mockImplementation(async (cursor?: string) => cursor ? { items: [item(2, "Renovación")], nextCursor: null } : { items: [item(1, "Papelería")], nextCursor: "old" });
    mount(<SentPage />); await screen.findAllByText("Papelería");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Renovación" } });
    await screen.findByText("Sin coincidencias en los envíos cargados");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más envíos" }));
    await screen.findAllByText("Renovación"); expect(screen.getByRole("searchbox")).toHaveValue("Renovación");
  });
  it("deduplicates pages without mutating records and filters people without exposing pagination state", () => {
    const first = item(1); const second = item(2);
    const result = mergeInboxPages([{ items: [first], nextCursor: "next" }, { items: [first, second], nextCursor: null }]);
    expect(result).toEqual([first, second]); expect(first).not.toHaveProperty("nextCursor");
    expect(filterInboxItems(result, "gasto 2")).toEqual([second]);
  });
});
