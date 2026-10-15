# Platform support

One plugin folder, `plugins/joulo`, serves both platforms. Each platform reads its own manifest and ignores the other's.

| File | OpenAI | Claude Code |
|---|---|---|
| `plugin.json` | Manifest (Agent Plugins 1.0.0 with `extensions["com.openai"]`) | Not read |
| `mcp.json` | MCP config, found automatically | Not read |
| `.claude-plugin/plugin.json` | Also accepted by the portal, so the OpenAI ZIP leaves it out | Manifest |
| `.mcp.json` | Not read unless a manifest points at it; left out of the ZIP | MCP config |
| `assets/joulo-icon.png` | `logo` and `composerIcon` | `icon` (directory listing) |
| `README.md` | Left out of the ZIP | Directory requirement (at least 40 words) |
| `skills/` (none yet) | Read | Read |

Claude Code does not read the Agent Plugins format. Its docs and `claude plugin validate` accept only `.claude-plugin/plugin.json`; a root `plugin.json` alone fails with "No manifest found". That is why the Claude manifest and `.mcp.json` exist next to the OpenAI files instead of replacing them.

## Shared

- **MCP server.** Both point at `https://joulo.nl/mcp`. There is one server and one deployment.
- **Authentication.** Both use OAuth 2.1 with dynamic client registration against `https://joulo.nl`. Each client registers itself. The Joulo consent page recognizes ChatGPT and Claude by their redirect URI.
- **Tools.** The same read-only tools (fifteen on 15 October 2026), with the same annotations and the same server instructions. The server sends them, so neither manifest lists them. The README lists them.
- **Identity.** Name `joulo`, version, description, author `Joulo B.V.`, website, support, privacy and terms URLs, and the icon. `npm run check` fails when the two manifests disagree on any of these.

## Adapted

| Topic | OpenAI | Claude Code | Why |
|---|---|---|---|
| Transport name | `"type": "streamable-http"` | `"type": "http"` | Same transport. Agent Plugins does not allow `http`; Claude Code documents `http` and lists `streamable-http` as an alias. The directory checklist names only `http`, `sse` and `ws`. |
| OAuth callback | `chatgpt.com` | Claude Code: `http://localhost:<port>/callback`. Claude.ai: `https://claude.ai/api/mcp/auth_callback` | The Joulo server accepts all three. |
| Listing URLs | `websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL` | `homepage`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl` | Different field names, same values. |
| Price widget | `ui://joulo/price-curve.skybridge.html`, `text/html+skybridge` | `ui://joulo/price-curve.html`, `text/html;profile=mcp-app` | Same HTML. Each host reads its own convention from the tool's `_meta`. A client without UI support shows the text result. |
| Documentation URL | Not in the manifest | `documentationUrl`: `https://developer.joulo.nl/guides/mcp` | The server already names this URL as `resource_documentation` in its OAuth metadata. |
| Distribution | ZIP upload in the OpenAI portal | Git marketplace (`.claude-plugin/marketplace.json`) and the Claude directory, which reads GitHub | |

## OpenAI only

These have no field in the Claude manifest. The Claude directory asks for some of them in its portal form instead.

- `interface.shortDescription`, `longDescription`, `developerName`, `category`, `composerIcon`
- `interface.defaultPrompt`: three starter prompts
- `review.test_cases`: five positive and three negative cases
- `review.commerce`, `commerce_description`, `demo_recording_url`
- `publication.release_notes`, `publication.countries`

Test cases could become Claude plugin evals (`claude plugin eval`). That is not done: every case needs a signed-in Joulo account with fixture data.

## Claude only

- **Marketplace install from Git.** `/plugin marketplace add joulo-nl/joulo-mcp-plugin` installs the plugin before any directory review, for anyone with read access to the repository. Tested on 11 October 2026 against the private repository, in a clean Claude Code config.
- **Claude Code CLI.** The plugin brings the MCP server into Claude Code. ChatGPT's coding agent, Codex, gets it from the OpenAI package.

## Not on both

- **Claude.ai and Claude Desktop** do not load Claude Code plugins. They reach the server as a connector. A directory listing there is a separate connector submission, not this plugin.
- **ChatGPT** loads plugins only through the OpenAI portal or directory. It does not read this Git repository.
