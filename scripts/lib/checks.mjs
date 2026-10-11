// Checks shared by `npm run check` (the source tree) and
// `npm run package:openai` (the extracted ZIP). Each check pushes a message
// onto `errors`; the caller decides how to report them.
//
// The OpenAI limits below come from developers.openai.com/plugins (read
// 2026-10-11): deploy/submission, deploy/submission-errors and
// plugin-guidelines. Recheck them when OpenAI changes the portal.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_DIR = join(ROOT, "schemas", "agent-plugins-1.0.0");

export const OPENAI_CATEGORIES = [
  "Productivity",
  "Creativity",
  "Developer Tools",
  "Business & Operations",
  "Data & Analytics",
  "Communication",
  "Education & Research",
  "Security",
  "Finance",
  "Healthcare",
  "Travel",
  "Entertainment",
  "Other",
];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function schemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return {
    plugin: ajv.compile(readJson(join(SCHEMA_DIR, "plugin.schema.json"))),
    mcp: ajv.compile(readJson(join(SCHEMA_DIR, "mcp.schema.json"))),
  };
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 1024) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Width and height of a PNG, or null when the bytes are not a PNG. */
function pngSize(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function checkIcon(pluginDir, ref, label, errors) {
  if (typeof ref !== "string" || !ref.startsWith("./")) {
    errors.push(`${label}: path must start with "./" (got ${JSON.stringify(ref)})`);
    return;
  }
  const file = join(pluginDir, ref);
  if (!existsSync(file)) {
    errors.push(`${label}: ${ref} does not exist`);
    return;
  }
  if (statSync(file).size > 5 * 1024 * 1024) errors.push(`${label}: ${ref} is larger than 5 MiB`);
  if (!ref.toLowerCase().endsWith(".png")) {
    errors.push(`${label}: only PNG icons are checked by this script; ${ref} needs a manual check`);
    return;
  }
  const size = pngSize(readFileSync(file));
  if (!size) {
    errors.push(`${label}: ${ref} has a .png name but is not a PNG`);
  } else if (size.width !== size.height || size.width < 48 || size.width > 4096) {
    errors.push(`${label}: ${ref} must be square, 48 to 4096 px (got ${size.width}x${size.height})`);
  }
}

/** Find keys anywhere in a JSON value. OpenAI rejects reviewer secrets in the package. */
function findKeys(value, names, path = "$", hits = []) {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (names.includes(k)) hits.push(`${path}.${k}`);
      findKeys(v, names, `${path}.${k}`, hits);
    }
  }
  return hits;
}

/** Check the OpenAI / Agent Plugins package in `pluginDir` (plugin.json + mcp.json). */
export function checkOpenAiPackage(pluginDir, errors) {
  const validate = schemaValidator();
  const plugin = readJson(join(pluginDir, "plugin.json"));
  const mcp = readJson(join(pluginDir, "mcp.json"));

  if (!validate.plugin(plugin)) {
    for (const e of validate.plugin.errors) errors.push(`plugin.json schema: ${e.instancePath || "/"} ${e.message}`);
  }
  if (!validate.mcp(mcp)) {
    for (const e of validate.mcp.errors) errors.push(`mcp.json schema: ${e.instancePath || "/"} ${e.message}`);
  }
  if (plugin.$schema?.split("/").at(-2) !== mcp.$schema?.split("/").at(-2)) {
    errors.push("plugin.json and mcp.json must target the same Agent Plugins version");
  }

  if (!SEMVER.test(plugin.version ?? "")) errors.push(`version must be semver (got ${JSON.stringify(plugin.version)})`);
  if (!plugin.description || plugin.description.length > 1024) errors.push("description is required, at most 1,024 characters");

  for (const [name, server] of Object.entries(mcp.mcpServers ?? {})) {
    if (server.headers && Object.keys(server.headers).length > 0) {
      errors.push(`mcp.json ${name}: OpenAI rejects non-empty headers on a public submission`);
    }
    if (server.type !== "stdio" && !isHttpsUrl(server.url)) errors.push(`mcp.json ${name}: url must be https`);
  }

  const openai = plugin.extensions?.["com.openai"];
  if (!openai) {
    errors.push('plugin.json: extensions["com.openai"] is missing');
    return;
  }
  const ui = openai.interface ?? {};
  const maxLen = (key, max) => {
    if (typeof ui[key] !== "string" || ui[key].length === 0) errors.push(`interface.${key} is required`);
    else if (ui[key].length > max) errors.push(`interface.${key} is ${ui[key].length} characters, max ${max}`);
  };
  maxLen("displayName", 30);
  maxLen("shortDescription", 30);
  maxLen("longDescription", 4000);
  maxLen("developerName", 80);

  const prompts = ui.defaultPrompt ?? [];
  if (!Array.isArray(prompts) || prompts.length > 3) errors.push("interface.defaultPrompt holds at most 3 prompts");
  if (new Set(prompts).size !== prompts.length) errors.push("interface.defaultPrompt entries must be unique");
  for (const p of prompts) {
    if (p.length > 128) errors.push(`defaultPrompt over 128 characters: ${p.slice(0, 40)}…`);
    if (p.includes("@")) errors.push(`defaultPrompt must not @mention: ${p.slice(0, 40)}…`);
  }

  for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    if (!isHttpsUrl(ui[key])) errors.push(`interface.${key} must be an https URL of at most 1,024 characters`);
  }
  if (!OPENAI_CATEGORIES.includes(ui.category)) errors.push(`interface.category ${JSON.stringify(ui.category)} is not an OpenAI category`);

  checkIcon(pluginDir, ui.logo, "interface.logo", errors);
  checkIcon(pluginDir, ui.composerIcon, "interface.composerIcon", errors);

  const review = openai.review ?? {};
  const positive = review.test_cases?.positive ?? [];
  const negative = review.test_cases?.negative ?? [];
  if (positive.length !== 5) errors.push(`review needs exactly 5 positive test cases (got ${positive.length})`);
  if (negative.length !== 3) errors.push(`review needs exactly 3 negative test cases (got ${negative.length})`);
  positive.forEach((c, i) => {
    for (const k of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
      if (typeof c[k] !== "string" || c[k].length === 0) errors.push(`positive[${i}].${k} must be a non-empty string`);
    }
  });
  negative.forEach((c, i) => {
    for (const k of ["description", "prompt"]) {
      if (typeof c[k] !== "string" || c[k].length === 0) errors.push(`negative[${i}].${k} must be a non-empty string`);
    }
  });
  if (typeof review.commerce !== "boolean") errors.push("review.commerce must be a boolean");
  if (!isHttpsUrl(review.demo_recording_url)) errors.push("review.demo_recording_url must be an https URL");
  if (!openai.publication?.release_notes) errors.push("publication.release_notes is required");

  for (const hit of findKeys(plugin, ["test_credentials", "reviewer_instructions"])) {
    errors.push(`${hit}: reviewer credentials belong in the portal, never in the package`);
  }
}

/**
 * Check that the Claude manifest describes the same plugin as the OpenAI
 * manifest: same identity, same public URLs, same icon file, same MCP endpoint.
 */
export function checkCrossPlatform(pluginDir, errors) {
  const openai = readJson(join(pluginDir, "plugin.json"));
  const claude = readJson(join(pluginDir, ".claude-plugin", "plugin.json"));
  const ui = openai.extensions?.["com.openai"]?.interface ?? {};

  const same = (label, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      errors.push(`${label} differs: OpenAI ${JSON.stringify(a)} vs Claude ${JSON.stringify(b)}`);
    }
  };
  same("name", openai.name, claude.name);
  same("version", openai.version, claude.version);
  same("description", openai.description, claude.description);
  same("author", openai.author, claude.author);
  same("license", openai.license, claude.license);
  same("display name", ui.displayName, claude.displayName);
  same("website", ui.websiteURL, claude.homepage);
  same("support URL", ui.supportURL, claude.supportUrl);
  same("privacy policy URL", ui.privacyPolicyURL, claude.privacyPolicyUrl);
  same("terms URL", ui.termsOfServiceURL, claude.termsOfServiceUrl);
  same("icon", ui.logo, claude.icon);

  // Agent Plugins names the transport "streamable-http"; Claude Code names
  // the same transport "http". The endpoint must be identical.
  const TRANSPORT = { "streamable-http": "http", sse: "sse", stdio: "stdio" };
  const openaiServers = readJson(join(pluginDir, "mcp.json")).mcpServers ?? {};
  const claudeServers = readJson(join(pluginDir, ".mcp.json")).mcpServers ?? {};
  same("MCP server names", Object.keys(openaiServers).sort(), Object.keys(claudeServers).sort());
  for (const [name, s] of Object.entries(openaiServers)) {
    const c = claudeServers[name];
    if (!c) continue;
    same(`MCP ${name} url`, s.url, c.url);
    same(`MCP ${name} transport`, TRANSPORT[s.type], c.type);
  }

  const marketplace = readJson(join(ROOT, ".claude-plugin", "marketplace.json"));
  const entry = marketplace.plugins?.find((p) => p.name === claude.name);
  if (!entry) errors.push(`marketplace.json lists no plugin named ${claude.name}`);
  else same("marketplace description", openai.description, entry.description);
}
