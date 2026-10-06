import { describe, expect, it } from "vitest";

import { clientIpFromForwarded, trustedProxyHops } from "@/libs/client-ip";

describe("clientIpFromForwarded", () => {
  it("con un proxy de confianza toma la última entrada (la que él agregó)", () => {
    expect(clientIpFromForwarded("203.0.113.9", 1)).toBe("203.0.113.9");
  });

  it("ignora lo que el cliente haya antepuesto para falsear su IP", () => {
    expect(clientIpFromForwarded("1.2.3.4, 203.0.113.9", 1)).toBe("203.0.113.9");
  });

  it("con dos proxies de confianza salta el último (el interno)", () => {
    expect(clientIpFromForwarded("203.0.113.9, 10.0.0.5", 2)).toBe("203.0.113.9");
  });

  it("sin proxies declarados (hops 0) no confía en la cabecera", () => {
    expect(clientIpFromForwarded("1.2.3.4", 0)).toBeUndefined();
  });

  it("cabecera ausente, más corta que los saltos o con basura => undefined", () => {
    expect(clientIpFromForwarded(null, 1)).toBeUndefined();
    expect(clientIpFromForwarded("203.0.113.9", 2)).toBeUndefined();
    expect(clientIpFromForwarded("no-es-una-ip", 1)).toBeUndefined();
    expect(clientIpFromForwarded("1.2.3.4, <script>", 1)).toBeUndefined();
  });

  it("acepta IPv6", () => {
    expect(clientIpFromForwarded("2001:db8::1", 1)).toBe("2001:db8::1");
  });
});

describe("trustedProxyHops", () => {
  it("0 por defecto o con valores inválidos; entero positivo si se declara", () => {
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ PUBLIC_TRUSTED_PROXY_HOPS: "abc" })).toBe(0);
    expect(trustedProxyHops({ PUBLIC_TRUSTED_PROXY_HOPS: "-1" })).toBe(0);
    expect(trustedProxyHops({ PUBLIC_TRUSTED_PROXY_HOPS: "1" })).toBe(1);
  });
});
