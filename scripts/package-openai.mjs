#!/usr/bin/env node
// Build the OpenAI submission ZIP from plugins/joulo and validate the result.
//
// The ZIP holds one top-level folder, joulo/, with only the files OpenAI
// reads: plugin.json, mcp.json and the assets/ and skills/ trees. The Claude
// files (.claude-plugin/, .mcp.json) and the README stay out: OpenAI also
// accepts .claude-plugin/plugin.json, and two manifests in one upload would
// make it ambiguous which one the portal reads.
//
// The output is reproducible: sorted entries and one fixed timestamp, taken
// from SOURCE_DATE_EPOCH or else the last commit that touched plugins/joulo.
//
// Usage: npm run package:openai
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildZip } from "./lib/zip.mjs";
import { checkOpenAiPackage, readJson } from "./lib/checks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = join(ROOT, "plugins", "joulo");
const ZIP_ROOT = "joulo";
const INCLUDE_FILES = ["plugin.json", "mcp.json"];
const INCLUDE_DIRS = ["assets", "skills"];

// OpenAI's upload limits (developers.openai.com/plugins/deploy/submission-errors).
const MAX_COMPRESSED = 100 * 1024 * 1024;
const MAX_EXTRACTED = 512 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_SEGMENTS = 20;

function fail(message) {
  console.error(`✘ ${message}`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === ".DS_Store") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (st.isFile()) out.push(full);
    else fail(`${relative(ROOT, full)} is not a regular file`);
  }
  return out;
}

function buildTimestamp() {
  if (process.env.SOURCE_DATE_EPOCH) return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000);
  const git = spawnSync("git", ["log", "-1", "--format=%ct", "--", "plugins/joulo"], { cwd: ROOT, encoding: "utf8" });
  const epoch = Number(git.stdout?.trim());
  if (git.status === 0 && epoch > 0) return new Date(epoch * 1000);
  console.warn("! no commit touches plugins/joulo yet; using 2026-01-01T00:00:00Z as the ZIP timestamp");
  return new Date(Date.UTC(2026, 0, 1));
}

// ── Build ────────────────────────────────────────────────────────────────
const plugin = readJson(join(PLUGIN_DIR, "plugin.json"));
const sourceErrors = [];
checkOpenAiPackage(PLUGIN_DIR, sourceErrors);
if (sourceErrors.length) fail(`source package is invalid:\n    ${sourceErrors.join("\n    ")}`);

const files = [
  ...INCLUDE_FILES.map((f) => join(PLUGIN_DIR, f)),
  ...INCLUDE_DIRS.filter((d) => existsSync(join(PLUGIN_DIR, d))).flatMap((d) => walk(join(PLUGIN_DIR, d))),
];
const entries = files.map((full) => ({
  name: `${ZIP_ROOT}/${relative(PLUGIN_DIR, full).split(sep).join("/")}`,
  data: readFileSync(full),
}));

const zip = buildZip(entries, buildTimestamp());
const outDir = join(ROOT, "dist", "openai");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${plugin.name}-${plugin.version}.zip`);
writeFileSync(outFile, zip);
const sha256 = createHash("sha256").update(zip).digest("hex");
console.log(`✔ built ${relative(ROOT, outFile)} (${zip.length} bytes, sha256 ${sha256})`);

// ── Validate the archive itself ──────────────────────────────────────────
const errors = [];
const unzip = (args) => spawnSync("unzip", args, { encoding: "utf8" });

const integrity = unzip(["-tq", outFile]);
if (integrity.error?.code === "ENOENT") fail("unzip is not installed; cannot validate the archive");
if (integrity.status !== 0) errors.push(`unzip -t failed: ${(integrity.stdout + integrity.stderr).trim()}`);

const names = unzip(["-Z1", outFile]).stdout.split("\n").filter(Boolean);
const tops = new Set(names.map((n) => n.split("/")[0]));
if (tops.size !== 1 || !tops.has(ZIP_ROOT)) errors.push(`ZIP must hold one top-level folder "${ZIP_ROOT}/" and no siblings (got ${[...tops].join(", ")})`);
if (names.length > MAX_ENTRIES) errors.push(`${names.length} entries, max ${MAX_ENTRIES}`);
if (zip.length > MAX_COMPRESSED) errors.push(`ZIP is ${zip.length} bytes, max ${MAX_COMPRESSED}`);
for (const n of names) {
  if (n.split("/").length > MAX_SEGMENTS) errors.push(`${n}: more than ${MAX_SEGMENTS} path segments`);
  if (/(^|\/)(__MACOSX|\.DS_Store|\.claude-plugin|\.mcp\.json|\.env)/.test(n)) errors.push(`${n}: must not be in the OpenAI ZIP`);
}

const extractDir = mkdtempSync(join(tmpdir(), "joulo-openai-zip-"));
try {
  const extract = unzip(["-q", outFile, "-d", extractDir]);
  if (extract.status !== 0) errors.push(`extract failed: ${extract.stderr.trim()}`);
  const extractedRoot = join(extractDir, ZIP_ROOT);
  const extracted = walk(extractedRoot);
  const total = extracted.reduce((n, f) => n + statSync(f).size, 0);
  if (total > MAX_EXTRACTED) errors.push(`extracted size ${total} bytes, max ${MAX_EXTRACTED}`);
  for (const { name, data } of entries) {
    const got = readFileSync(join(extractDir, name));
    if (!got.equals(data)) errors.push(`${name}: extracted bytes differ from the source file`);
  }
  // Run every package check against the extracted copy, so a file missing
  // from the ZIP (an icon, say) fails here and not in the portal.
  checkOpenAiPackage(extractedRoot, errors);
} finally {
  rmSync(extractDir, { recursive: true, force: true });
}

if (errors.length) fail(`archive validation failed:\n    ${errors.join("\n    ")}`);
console.log(`✔ archive validated: ${names.length} files under ${ZIP_ROOT}/`);
for (const n of names) console.log(`    ${n}`);
