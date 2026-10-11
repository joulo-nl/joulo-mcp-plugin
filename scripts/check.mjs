#!/usr/bin/env node
// Validate the source tree for both platforms:
//   1. the OpenAI package (Agent Plugins schemas plus OpenAI's portal rules)
//   2. the Claude manifest against the OpenAI one (same plugin, same endpoint)
//   3. `claude plugin validate --strict` on the plugin and the marketplace
//
// Usage: npm run check [-- --require-claude]
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOpenAiPackage, checkCrossPlatform } from "./lib/checks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = join(ROOT, "plugins", "joulo");
const requireClaude = process.argv.includes("--require-claude");

let failed = false;
function report(title, errors) {
  if (errors.length === 0) {
    console.log(`✔ ${title}`);
  } else {
    failed = true;
    console.log(`✘ ${title}`);
    for (const e of errors) console.log(`    ${e}`);
  }
}

const openaiErrors = [];
checkOpenAiPackage(PLUGIN_DIR, openaiErrors);
report("OpenAI package (plugins/joulo/plugin.json, mcp.json)", openaiErrors);

const crossErrors = [];
checkCrossPlatform(PLUGIN_DIR, crossErrors);
report("Claude manifest matches the OpenAI manifest", crossErrors);

for (const [label, target] of [
  ["Claude plugin", "plugins/joulo"],
  ["Claude marketplace", "."],
]) {
  const run = spawnSync("claude", ["plugin", "validate", target, "--strict"], { cwd: ROOT, encoding: "utf8" });
  if (run.error?.code === "ENOENT") {
    console.log(`- ${label}: SKIPPED, the claude CLI is not installed`);
    if (requireClaude) failed = true;
    continue;
  }
  report(`${label} (claude plugin validate ${target} --strict)`, run.status === 0 ? [] : [(run.stdout + run.stderr).trim()]);
}

process.exit(failed ? 1 : 0);
