"use strict";

const fs = require("fs");
const path = require("path");

const rulesPath = path.join(__dirname, "default-rules.json");

function loadRules() {
  return JSON.parse(fs.readFileSync(rulesPath, "utf8")).rules;
}

function evaluateCompliance(extractionResult) {
  const input = extractionResult && typeof extractionResult === "object"
    ? extractionResult
    : {};
  const fields = {};
  const violations = [];

  for (const rule of loadRules()) {
    const declaration = input[rule.field] || { value: null, box: null };
    const value = declaration.value === undefined ? null : declaration.value;
    const box = declaration.box === undefined ? null : declaration.box;
    let reason = null;

    if (rule.required && value === null) {
      reason = "Required declaration not detected";
    } else if (rule.format_regex && !new RegExp(rule.format_regex).test(value)) {
      reason = rule.description;
    }

    fields[rule.field] = {
      value,
      status: reason ? "FAIL" : "PASS",
      box,
    };

    if (reason) violations.push({ field: rule.field, reason });
  }

  return {
    overall_status: violations.length === 0 ? "COMPLIANT" : "NON_COMPLIANT",
    fields,
    violations,
  };
}

module.exports = { evaluateCompliance };
