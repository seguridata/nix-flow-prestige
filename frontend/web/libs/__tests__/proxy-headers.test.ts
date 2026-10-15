import { describe, expect, it } from "vitest";

import { filterRequestHeaders } from "@/libs/proxy-headers";

describe("filterRequestHeaders", () => {
  it("conserva solo las cabeceras de la lista blanca", () => {
    const out = filterRequestHeaders(
      new Headers({
        accept: "application/json",
        "content-type": "application/json",
        "if-match": '"v1"',
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "1.2.3.4",
        "x-user-id": "evil",
        "x-actor-id": "evil",
        cookie: "a=b",
        authorization: "Bearer x",
      }),
    );
    expect([...out.keys()].sort()).toEqual(["accept", "content-type", "if-match"]);
  });
});
