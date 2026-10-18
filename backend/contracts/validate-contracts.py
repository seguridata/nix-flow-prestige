"""Validate maintained API contracts against controllers; no network or writes.
Run: python backend/contracts/validate-contracts.py (requires PyYAML).
Includes ADR-008, Chat, Process Studio and the custom MCP OAuth transport.
The generated Swagger JSON is intentionally separate: MCP excludes Swagger.
"""
import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
VERBS = {"get", "post", "put", "patch", "delete", "head", "options"}


def requests(items):
    for item in items:
        if "item" in item:
            yield from requests(item["item"])
        elif "request" in item:
            yield item["request"]


def controller_routes(source, prefix):
    """Read literal Nest routes, array aliases and @All transport mapping.

    @All binds every verb in Nest; the MCP contract models the three protocol
    methods. Unsupported verbs are described, not advertised as operations.
    """
    matches = list(re.finditer(r"@(Get|Post|Put|Delete|Patch|All)\(([^)]*)\)", source))
    for i, match in enumerate(matches):
        start = source.rfind("\n  }", 0, match.start())
        decorators = source[start + 4:match.start()]
        roles = re.search(r"@Roles\(([^)]*)\)", decorators)
        roles = re.findall(r"'([^']+)'", roles[1]) if roles else []
        public = "@Public()" in decorators
        following = source[match.end():matches[i + 1].start() if i + 1 < len(matches) else len(source)]
        code = re.search(r"@HttpCode\((\d+)\)", following)
        suffixes = re.findall(r"'([^']*)'", match[2]) or [""]
        methods = ["post", "get", "delete"] if match[1] == "All" else [match[1].lower()]
        for suffix in suffixes:
            path = "/" + "/".join(part for part in [prefix, suffix] if part)
            path = re.sub(r":(\w+)", r"{\1}", path)
            for method in methods:
                yield {"path": path, "method": method, "roles": roles, "public": public,
                       "all": match[1] == "All", "status": code[1] if code else "201" if method == "post" else "200"}


def validate(contract, collection, root=ROOT):
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

    references(contract)
    formats = contract['paths']['/document-templates']['get']
    formats_params = {parameter['name']: parameter['schema'] for parameter in formats['parameters']}
    assert formats_params['limit']['maximum'] == 200
    assert formats_params['cursor']['maxLength'] == 200
    format_shapes = formats['responses']['200']['content']['application/json']['schema']['oneOf']
    assert any(shape.get('type') == 'array' for shape in format_shapes), 'Legacy formats array missing'
    assert any({'items', 'nextCursor'}.issubset(shape.get('required', [])) for shape in format_shapes), 'Formats page missing'
    postman = list(requests(collection["item"]))
    checked = 0
    modules = [("chat", "chat"), ("lookup-tables", "lookup-tables"),
               ("document-templates", "document-templates"), ("process", ""), ("mcp", "")]
    variables = {"key": "processKey", "version": "processVersion", "rowId": "rowId", "stagedId": "stagedId"}
    for module, prefix in modules:
        source = (root / f"backend/bff/src/{module}/{module}.controller.ts").read_text(encoding="utf-8")
        for route in controller_routes(source, prefix):
            path, method = route["path"], route["method"]
            operation = contract["paths"][path][method]
            if path == "/mcp":
                assert operation["security"] == [{"McpOAuth": ["prestige:read"]}], path
                assert "@UseGuards(McpAuthGuard)" in source, "MCP custom guard missing"
                assert operation.get("x-nest-route-all") is True, path
                assert {"401", "403", "503"}.issubset(operation["responses"]), path
                assert ("202" if method == "post" else "200") in operation["responses"], path
            else:
                assert operation["security"] == ([] if route["public"] else [{"BearerAuth": []}]), path
                assert route["status"] in operation["responses"], (path, route["status"])
            assert operation.get("x-required-roles", []) == route["roles"], (path, "role drift")
            params = {param["name"] for param in operation.get("parameters", []) if param["in"] == "path"}
            assert set(re.findall(r"\{(\w+)\}", path)) == params, path
            for param in operation.get("parameters", []):
                if param["in"] == "path":
                    assert param.get("required") is True, (path, "optional path parameter")
            mapping = {**variables, "id": "tableId" if module == "lookup-tables" else "templateId"}
            url = "{{baseUrl}}" + re.sub(r"\{(\w+)\}", lambda m: "{{" + mapping.get(m[1], m[1]) + "}}", path)
            candidates = [r for r in postman if r["method"].lower() == method and r["url"].split("?")[0] == url]
            assert candidates, ("Missing Postman route", method, path)
            if path == "/mcp":
                assert any(r.get("auth", {}).get("bearer", [{}])[0].get("value") == "{{mcpToken}}" for r in candidates), "MCP must use resource token"
            checked += 1

    tools_source = (root / "backend/bff/src/mcp/mcp.service.ts").read_text(encoding="utf-8")
    tools = re.findall(r"'([^']+)'", re.search(r"const names = \[(.*?)\] as const", tools_source, re.S)[1])
    documented_tools = contract["paths"]["/mcp"]["post"]["x-mcp-tools"]
    assert {t["name"] for t in documented_tools} == set(tools), "MCP tool drift"
    for tool in documented_tools:
        assert tool["annotations"]["readOnlyHint"] is True
        assert tool["inputSchema"]["additionalProperties"] is False
    schemes = contract["components"]["securitySchemes"]
    assert "prestige:read" in schemes["McpOAuth"]["flows"]["authorizationCode"]["scopes"]
    operation_ids = [op["operationId"] for path in contract["paths"].values()
                     for verb, op in path.items() if verb in VERBS]
    assert len(operation_ids) == len(set(operation_ids)), "Duplicate operationId"
    for request in postman:
        for field in request.get("body", {}).get("urlencoded", []):
            if field["key"] == "password":
                assert field["value"] == "{{password}}", "Hardcoded password in collection"
    return checked


if __name__ == "__main__":
    contract = yaml.safe_load((ROOT / "backend/contracts/openapi.yaml").read_text(encoding="utf-8"))
    collection = json.loads((ROOT / "backend/contracts/prestige.postman_collection.json").read_text(encoding="utf-8"))
    checked = validate(contract, collection)
    print(f"Contract OK: {checked} controller operations covered in OpenAPI and Postman; references, roles, statuses, MCP guards/tools and path params valid.")
