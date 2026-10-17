"""Regression checks for contract drift. Run: python -m unittest discover -s backend/contracts -p 'test_*.py'."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("validate_contracts", HERE / "validate-contracts.py")
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


class ContractDriftTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = yaml.safe_load((HERE / "openapi.yaml").read_text(encoding="utf-8"))
        cls.collection = json.loads((HERE / "prestige.postman_collection.json").read_text(encoding="utf-8"))

    def test_current_contract_covers_all_maintained_controllers(self):
        self.assertGreaterEqual(validator.validate(self.contract, self.collection), 61)

    def test_removing_studio_role_requirement_is_detected(self):
        changed = copy.deepcopy(self.contract)
        changed["paths"]["/process-catalog"]["get"].pop("x-required-roles")
        with self.assertRaisesRegex(AssertionError, "role drift"):
            validator.validate(changed, self.collection)

    def test_mcp_cannot_be_documented_as_public_or_regular_web_bearer(self):
        for security in [[], [{"BearerAuth": []}]]:
            with self.subTest(security=security):
                changed = copy.deepcopy(self.contract)
                changed["paths"]["/mcp"]["post"]["security"] = security
                with self.assertRaises(AssertionError):
                    validator.validate(changed, self.collection)

    def test_unresolved_schema_reference_is_detected(self):
        changed = copy.deepcopy(self.contract)
        changed["components"]["schemas"]["StudioPackage"]["properties"]["flow"] = {
            "$ref": "#/components/schemas/NonexistentFlow"
        }
        with self.assertRaises(KeyError):
            validator.validate(changed, self.collection)

    def test_omitted_version_endpoint_is_detected(self):
        changed = copy.deepcopy(self.contract)
        del changed["paths"]["/process-definitions/{key}/versions/{version}"]["get"]
        with self.assertRaises(KeyError):
            validator.validate(changed, self.collection)

    def test_wrong_restore_http_status_is_detected(self):
        changed = copy.deepcopy(self.contract)
        operation = changed["paths"]["/process-definitions/{key}/versions/{version}/restore"]["post"]
        operation["responses"]["200"] = operation["responses"].pop("201")
        with self.assertRaises(AssertionError):
            validator.validate(changed, self.collection)

    def test_read_only_mcp_tool_drift_is_detected(self):
        changed = copy.deepcopy(self.contract)
        changed["paths"]["/mcp"]["post"]["x-mcp-tools"][0]["annotations"]["readOnlyHint"] = False
        with self.assertRaises(AssertionError):
            validator.validate(changed, self.collection)

    def test_missing_postman_studio_folder_is_detected(self):
        changed = copy.deepcopy(self.collection)
        changed["item"] = [item for item in changed["item"] if item.get("name") != "Process Studio"]
        with self.assertRaisesRegex(AssertionError, "Missing Postman route"):
            validator.validate(self.contract, changed)


if __name__ == "__main__":
    unittest.main()
