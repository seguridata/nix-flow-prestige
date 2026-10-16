"""Run: python backend/contracts/validate-contracts.py (requires PyYAML).

Checks the maintained ADR-008/chat contract against real controller routes and
the Postman collection, plus local references, path params, roles and status codes.
No network, authentication, writes or production requests are made.
"""
import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
contract = yaml.safe_load((ROOT / "backend/contracts/openapi.yaml").read_text(encoding="utf-8"))
collection = json.loads((ROOT / "backend/contracts/prestige.postman_collection.json").read_text(encoding="utf-8"))


def references(node):
    if isinstance(node, dict):
        if "$ref" in node:
            assert node["$ref"].startswith("#/"), "Unexpected external reference"
            target = contract
            for segment in node["$ref"][2:].split("/"):
                target = target[segment.replace("~1", "/").replace("~0", "~")]
        for child in node.values():
            references(child)
    elif isinstance(node, list):
        for child in node:
            references(child)


def requests(items):
    for item in items:
        if "item" in item:
            yield from requests(item["item"])
        elif "request" in item:
            yield item["request"]


references(contract)
postman = list(requests(collection["item"]))
checked = 0
for module, prefix in [("chat", "chat"), ("lookup-tables", "lookup-tables"), ("document-templates", "document-templates")]:
    source = (ROOT / f"backend/bff/src/{module}/{module}.controller.ts").read_text(encoding="utf-8")
    routes = list(re.finditer(r"@(Get|Post|Put|Delete)\((?:'([^']*)')?\)", source))
    for i, match in enumerate(routes):
        method = match[1].lower()
        suffix = re.sub(r":(\w+)", r"{\1}", match[2] or "")
        path = "/" + prefix + ("/" + suffix if suffix else "")
        operation = contract["paths"][path][method]
        assert operation["security"] == [{"BearerAuth": []}], path
        before = source[max(0, match.start() - 90):match.start()]
        if "@Roles('admin')" in before:
            assert operation.get("x-required-roles") == ["admin"], path
        following = source[match.end():routes[i + 1].start() if i + 1 < len(routes) else len(source)]
        code = re.search(r"@HttpCode\((\d+)\)", following)
        expected = code[1] if code else "201" if method == "post" else "200"
        assert expected in operation["responses"], (path, expected)
        assert set(re.findall(r"\{(\w+)\}", path)) == {p["name"] for p in operation.get("parameters", []) if p["in"] == "path"}, path
        variable = "tableId" if module == "lookup-tables" else "templateId"
        url = "{{baseUrl}}" + path.replace("{id}", "{{" + variable + "}}").replace("{rowId}", "{{rowId}}").replace("{stagedId}", "{{stagedId}}")
        assert any(r["method"].lower() == method and r["url"].split("?")[0] == url for r in postman), ("Missing Postman route", path)
        checked += 1

operation_ids = [op["operationId"] for path in contract["paths"].values() for verb, op in path.items() if verb in {"get", "post", "put", "patch", "delete"}]
assert len(operation_ids) == len(set(operation_ids)), "Duplicate operationId"
for request in postman:
    for field in request.get("body", {}).get("urlencoded", []):
        if field["key"] == "password":
            assert field["value"] == "{{password}}", "Hardcoded password in collection"
print(f"Contract OK: {checked} controller operations covered in OpenAPI and Postman; references, roles, statuses and path params valid.")
