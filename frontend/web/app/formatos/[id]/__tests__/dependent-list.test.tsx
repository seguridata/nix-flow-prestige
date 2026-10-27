import { Suspense } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsarFormatoPage from "../page";

const { fetchFormat } = vi.hoisted(() => ({ fetchFormat: vi.fn() }));
vi.mock("@/services/formats-service", () => ({
  fetchFormat,
  previewFormatFlow: vi.fn(async () => ({ steps: [] })),
  instantiateFormat: vi.fn(),
}));
vi.mock("@/store/session-store", () => ({ useSession: () => ({ tenantId: "A", signerId: "persona", name: "Persona", email: "p@x.mx", roles: [] }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/formats/live-preview", () => ({ LivePreview: () => null }));
vi.mock("@/components/formats/send-to-steps", () => ({ SendToSteps: () => null }));
vi.mock("@/components/formats/attachments-block", () => ({
  AttachmentsBlock: () => null,
  useAttachments: () => ({ counts: {}, uploading: false, staged: () => [] }),
}));

/**
 * Mismas agrupaciones que `CONCEPTOS_POR_TIPO` del BFF (hoja «Responsables Gasto»): los grupos cortos son los reales y los largos
 * se rellenan hasta las 68 opciones del formato publicado, para ejercitar tanto el select como la lista con búsqueda.
 */
const POR_TIPO: Record<string, string[]> = {
  "Bienes y servicios": ["Nómina", "Asesoría Fiscal-Legal", ...Array.from({ length: 38 }, (_, i) => `Bien o servicio ${i + 1}`)],
  "Costo de venta directo (Entrust)": ["Entrust", "HDW terceros", "SW terceros", "Aliados", "Azure"],
  "Gastos de oficina, seguros y comunicación": ["Renta oficinas", "Mantenimiento inmueble", ...Array.from({ length: 9 }, (_, i) => `Gasto de oficina ${i + 1}`)],
  Marketing: Array.from({ length: 11 }, (_, i) => `Marketing ${i + 1}`),
  Viaje: ["Gastos de Viaje"],
};
const TIPOS = Object.keys(POR_TIPO);
const TODOS = TIPOS.flatMap((t) => POR_TIPO[t]);

const formato = {
  id: "gastos",
  name: "Solicitud de gastos (Adquisiciones)",
  description: null,
  category: "Administración",
  published: true,
  kind: "FORM",
  pageCount: 1,
  fields: [],
  signatureBoxes: [],
  attachmentSpecs: [],
  flowKey: null,
  flowVersion: 1,
  methods: ["ACCEPT"],
  kycPolicy: "NONE",
  requirePasskey: false,
  flow: {
    variables: [
      { key: "tipoGasto", label: "Tipo de gasto", type: "select", required: true, options: TIPOS },
      {
        key: "concepto",
        label: "Concepto de gasto",
        type: "select",
        required: true,
        options: TODOS,
        dependsOn: { variable: "tipoGasto", options: POR_TIPO },
      },
      { key: "monto", label: "Monto (MXN)", type: "number", required: true },
    ],
    steps: [],
  },
};

async function abrir() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <UsarFormatoPage params={Promise.resolve({ id: "gastos" })} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  await screen.findByLabelText(/Tipo de gasto/);
}

const opcionesDe = (el: HTMLElement) => within(el).getAllByRole("option").map((o) => o.textContent);
const elegirTipo = (tipo: string) => fireEvent.change(screen.getByLabelText(/Tipo de gasto/), { target: { value: tipo } });

describe("Formato de gastos: el concepto solo ofrece las opciones del tipo elegido", () => {
  beforeEach(() => fetchFormat.mockResolvedValue(formato));

  it("sin tipo elegido no ofrece ningún concepto (antes mostraba las 68 opciones)", async () => {
    await abrir();
    const concepto = screen.getByLabelText(/Concepto de gasto/);
    expect(concepto).toBeDisabled();
    expect(opcionesDe(concepto)).toEqual(["Primero elige «Tipo de gasto»"]);
  });

  it("Costo de venta directo muestra solo sus 5 conceptos", async () => {
    await abrir();
    elegirTipo("Costo de venta directo (Entrust)");
    const concepto = screen.getByLabelText(/Concepto de gasto/);
    expect(concepto).toBeEnabled();
    expect(opcionesDe(concepto)).toEqual(["Elige una opción", "Entrust", "HDW terceros", "SW terceros", "Aliados", "Azure"]);
  });

  it("cambiar de tipo descarta el concepto que ya no corresponde", async () => {
    await abrir();
    elegirTipo("Costo de venta directo (Entrust)");
    fireEvent.change(screen.getByLabelText(/Concepto de gasto/), { target: { value: "Azure" } });
    expect(screen.getByLabelText(/Concepto de gasto/)).toHaveValue("Azure");

    elegirTipo("Viaje");
    const concepto = screen.getByLabelText(/Concepto de gasto/);
    expect(concepto).toHaveValue("");
    expect(opcionesDe(concepto)).toEqual(["Elige una opción", "Gastos de Viaje"]);
    expect(screen.queryByRole("option", { name: "Azure" })).not.toBeInTheDocument();
  });

  it("un tipo con muchos conceptos usa la lista con búsqueda, pero solo con los suyos", async () => {
    await abrir();
    elegirTipo("Bienes y servicios");
    const opciones = Array.from(document.querySelectorAll("#f-concepto-options option")).map((o) => (o as HTMLOptionElement).value);
    expect(opciones).toHaveLength(POR_TIPO["Bienes y servicios"].length);
    expect(opciones).toContain("Nómina");
    expect(opciones).not.toContain("Entrust");
    expect(screen.getByText(`${POR_TIPO["Bienes y servicios"].length} opciones; escribe para filtrar.`)).toBeInTheDocument();
  });
});
