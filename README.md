# Joulo plugin for ChatGPT, Codex and Claude

This repository is the source of the Joulo plugin on two platforms: OpenAI (ChatGPT and Codex) and Anthropic (Claude Code). The plugin connects an AI assistant to a user's own Joulo account. With it, the assistant can read the user's EV charging stations, charging sessions, energy totals, ERE (Emissiereductie-eenheden) position, electricity prices and charging costs. It can also read Joulo's own guides and kennisbank.

The plugin is read-only. It cannot start or stop charging, change the account, delete data, sell ERE's or start a payment.

> **Status.** The Claude plugin has been in Anthropic's directory since 15 October 2026, with the Community label. The Claude connector for `https://joulo.nl/mcp` is not submitted yet. This file does not track the OpenAI submission.

## How it works

The plugin holds no code of its own. It points the assistant at one remote MCP server, which Joulo runs in production:

| | |
|---|---|
| MCP endpoint | `https://joulo.nl/mcp` (streamable HTTP, JSON-RPC over POST) |
| Authentication | OAuth 2.1 with PKCE (S256) and dynamic client registration |
| Discovery | `https://joulo.nl/.well-known/oauth-protected-resource/mcp` |
| Developer docs | https://developer.joulo.nl/guides/mcp |

Each user signs in with their own Joulo account and grants read scopes. The repository and the packages hold no tokens, client secrets or reviewer logins.

### Tools

On 15 October 2026 the server (version 1.3.0) exposes fifteen tools. Each one wraps an existing read-only route of the Joulo API. Each carries a `title`, `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: false`.

| Tool | Scope | What it returns |
|---|---|---|
| `get_account` | `profile:read` | Account name, effective fee, indicative ERE price, referral code |
| `list_chargers` | `chargers:read` | Charging stations, status, MID eligibility, live charging state |
| `list_charging_sessions` | `sessions:read` | Sessions, filtered by period or station, paged |
| `get_energy_totals` | `energy:read` | Lifetime and monthly kWh, ERE and session counts |
| `get_ere_position` | `position:read` | Expected, reserved, sold, payable and paid ERE per year and quarter |
| `get_registration_status` | `position:read` | Registration steps: done and still open |
| `get_price_curve` | `profile:read` | Electricity price per hour or quarter-hour for one day, with the price widget |
| `find_cheapest_window` | `profile:read` | The cheapest time to charge a number of kWh before a deadline |
| `get_charging_costs` | `profile:read` | Charging costs over a period, per session at the EPEX price of that moment |
| `get_household` | `profile:read` | Energy contract and household details |
| `list_locations` | `locations:read` | Charging addresses: postcode, city and country, never the street |
| `get_ere_market` | none | Indicative ERE price and Joulo's past ERE sales |
| `read_kennisbank_article` | none | One article from Joulo's public kennisbank |
| `get_connection_guide` | none | How to connect a charging station of one brand |
| `get_feature_guide` | none | How a feature of the Joulo dashboard or app works |

A tool with scope "none" serves public reference data, so every signed-in caller may call it. `locations:read` came after the first connections. A token without it still sees `list_locations`. A call then answers 403 `insufficient_scope`, and the client asks the user for that scope.

### Resources

One tool renders a widget: `get_price_curve` names it in its `_meta`. The server lists the same HTML twice, once per host convention:

| URI | MIME type | Host |
|---|---|---|
| `ui://joulo/price-curve.html` | `text/html;profile=mcp-app` | MCP Apps |
| `ui://joulo/price-curve.skybridge.html` | `text/html+skybridge` | ChatGPT (OpenAI Apps SDK) |

The widget makes no network requests: its CSP allows no domains, and the data arrives with the tool result. A client without UI support shows the text result, which is complete on its own. The server has no resource templates.

### Source

The tools, the resources and the server instructions come from the server source (`supabase/functions/api/mcp.ts` in the Joulo monorepo). The server owns them, so a change there does not need a change here. Update the tables above when they drift.

## Repository layout

```
.
├── .claude-plugin/
│   └── marketplace.json        Claude marketplace: lists plugins/joulo
├── plugins/joulo/              the plugin, shared by both platforms
│   ├── plugin.json             OpenAI / Agent Plugins manifest (as uploaded to OpenAI)
│   ├── mcp.json                OpenAI / Agent Plugins MCP config
│   ├── .claude-plugin/
│   │   └── plugin.json         Claude Code manifest
│   ├── .mcp.json               Claude Code MCP config
│   ├── assets/joulo-icon.png   icon, used by both platforms
│   └── README.md               plugin description for the Claude directory
├── schemas/agent-plugins-1.0.0/   pinned copies of the Agent Plugins JSON Schemas
├── scripts/
│   ├── check.mjs               validates the source for both platforms
│   ├── package-openai.mjs      builds and validates the OpenAI ZIP
│   └── lib/                    shared checks and a deterministic ZIP writer
├── docs/
│   ├── platform-support.md     what works where, and why
│   └── demo.mp4                the demo recording (also linked in the OpenAI manifest)
├── package.json
├── LICENSE                     MIT
└── README.md
```

`mcp.json` and `assets/joulo-icon.png` are byte-identical to the draft ZIP (`joulo-submission-draft.zip`, 11 October 2026). `plugin.json` is identical apart from one added field, `"license": "MIT"`. Generated archives go to `dist/`, which git ignores.

## Development

Requirements: Node.js 22 or later, `unzip`, and for the Claude checks the [Claude Code CLI](https://code.claude.com/docs).

```bash
npm ci
```

```bash
npm run check
```

`check` runs three things:

1. The OpenAI package against the pinned Agent Plugins schemas and the OpenAI portal rules (field lengths, category, icon size, five positive and three negative test cases, no reviewer credentials, no MCP headers).
2. The Claude manifest against the OpenAI manifest: same name, version, description, author, public URLs, icon and MCP endpoint.
3. `claude plugin validate --strict` on the plugin and on the marketplace. Without the `claude` CLI this step is skipped; add `-- --require-claude` to make that a failure.

```bash
npm run package:openai
```

This writes `dist/openai/joulo-<version>.zip` and then validates the archive itself. The script tests ZIP integrity and checks for one top-level `joulo/` folder with no siblings. It also refuses any `__MACOSX`, `.DS_Store`, `.claude-plugin` or `.mcp.json` entry and checks OpenAI's size limits. Then it extracts the ZIP, compares every file byte for byte with the source and runs all package checks on the extracted copy.

The build is reproducible. Entries are sorted and carry one timestamp: `SOURCE_DATE_EPOCH` when set, otherwise the time of the last commit that touched `plugins/joulo`. The same commit always gives the same ZIP and the same SHA-256.

`npm test` runs both commands.

## Changing the plugin

- **Shared fields** (name, version, description, author, public URLs, icon, MCP endpoint) live in both manifests. Change both; `npm run check` fails when they differ.
- **OpenAI listing and review data** live only in `plugins/joulo/plugin.json` under `extensions["com.openai"]`.
- **A new version**: bump `version` in both manifests, update `publication.release_notes`, then run `npm test`.
- **Skills**: put them in `plugins/joulo/skills/<name>/SKILL.md`. Both platforms read that layout, and the OpenAI package includes the folder.

## Installation

Every route needs a Joulo account. The user signs in at joulo.nl during the OAuth step.

### ChatGPT and Codex

After OpenAI approves and publishes the plugin, users install it from the plugin directory in ChatGPT or Codex. Until then, the plugin exists as a private draft in the OpenAI portal. ChatGPT asks the user to connect their Joulo account on first use.

### Claude Code

The repository is a Claude Code marketplace. Add it and install the plugin:

```
/plugin marketplace add joulo-nl/joulo-mcp-plugin
```

```
/plugin install joulo@joulo
```

Then run `/mcp`, choose `plugin:joulo:joulo` and sign in. While the repository is private, `marketplace add` clones it with your own GitHub credentials, so only people with access to the repository can install it.

To try a local checkout without installing:

```bash
claude --plugin-dir plugins/joulo
```

### Claude.ai and Claude Desktop

Claude.ai and Claude Desktop do not load Claude Code plugins. They reach the same server as a custom connector: add a custom connector in Claude and paste `https://joulo.nl/mcp`. A listing in the Claude connectors directory is a separate submission; see below.

## Configuration

None. The endpoint is fixed and public, and each user authenticates with their own account. The plugin reads no environment variables and needs no API keys.

## Submission

The Claude plugin went live in Anthropic's directory on 15 October 2026. The Claude connector is not submitted yet. This file does not record the OpenAI submission.

### OpenAI (ChatGPT and Codex)

Source: [developers.openai.com/plugins/deploy/submission](https://developers.openai.com/plugins/deploy/submission).

1. Run `npm test` and keep the SHA-256 that `package:openai` prints.
2. In the OpenAI portal, pick the organization and the verified Joulo B.V. publisher.
3. Upload `dist/openai/joulo-<version>.zip` as a draft. Finish the endpoint and OAuth setup and the scans the portal asks for.
4. Domain verification: `https://joulo.nl/.well-known/openai-apps-challenge` serves the token (deployed 11 October 2026).
5. Enter reviewer login details in the portal's secure fields only, never in this repository.
6. Run all eight test cases against the saved submission version and record Passed, Failed or Blocked for each.
7. Complete the legal and policy attestations, then submit for review. Publishing after approval is a separate step.

### Claude (plugin directory)

Sources: [claude.com/docs/plugins/submit](https://claude.com/docs/plugins/submit) and the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).

1. Run `npm run check -- --require-claude`.
2. The checklist needs a `LICENSE` file or a `license` field. Both are in place (MIT).
3. At [claude.ai/directory/manage](https://claude.ai/directory/manage) choose Submit new › Plugin bundle. Point it at this GitHub repository, with plugin path `plugins/joulo`. A Team or Enterprise organization needs an Owner for this step.
4. The repository may stay private during review, with the Claude GitHub App installed. It must be public before the plugin is published.

Listed on 15 October 2026 with the Community label. Three things we learned from the live listing:

- **Where it shows.** The directory inside claude.ai lists the plugin. The public website does not: on 15 October 2026, `claude.com/marketplace/plugins` showed none of the Community plugins we searched for, Joulo included. The search on `claude.com/marketplace/connectors-plugins` covers connectors only.
- **Category.** Anthropic assigns the plugin's category; no field in `plugin.json` sets it. The first listing came out as `workouts-health-records`. Version 0.1.1 adds `keywords` and clearer README text to steer it. To change it directly, email `directory@anthropic.com`.
- **Updates.** The directory follows the tracked branch, which is `main` unless the portal says otherwise. A push there starts a scan, and by default a reviewer publishes each passing version. Raise `version` in both manifests with every release.

### Claude (connectors directory)

Anthropic asks for a plugin that points at an MCP server to submit that server as a connector too. The connector listing is also the route to the public website, and its categories are ours to set in the portal. Source: [claude.com/docs/connectors/building/submission](https://claude.com/docs/connectors/building/submission).

1. Submit from the same claude.ai organization as the plugin, so the portal can pair the two.
2. In the portal, choose MCP connector and enter `https://joulo.nl/mcp`.
3. Fill in the listing, the privacy policy and support URLs, and test credentials for a populated account. Pick energy and EV categories, and answer no to personal health data under Data handling.
4. Claude.ai calls back on `https://claude.ai/api/mcp/auth_callback`. The Joulo OAuth server accepts that host.

## Demo

[`docs/demo.mp4`](docs/demo.mp4) is a two-minute run in Codex (1072 × 1440, re-encoded from the screen recording), recorded on 11 October 2026 with a demo account. It shows the fee and price question, recent sessions, MID and all-station totals, the 2026 position per quarter, and three refused requests: stop charging, delete history, sell credits. GitHub Pages serves it as a playable video at https://joulo-nl.github.io/joulo-mcp-plugin/docs/demo.mp4, and the OpenAI manifest links that URL as `review.demo_recording_url`. GitHub's own file view does not play video. The video is not part of the OpenAI ZIP.

## Testing status

| Check | Result |
|---|---|
| Agent Plugins schemas and OpenAI portal rules on the source | Passed (`npm run check`) |
| Generated ZIP: integrity, layout, limits, byte comparison, checks on the extracted copy | Passed (`npm run package:openai`) |
| ZIP is reproducible (two builds, same SHA-256) | Passed |
| `claude plugin validate --strict`, plugin and marketplace (Claude Code 2.1.281) | Passed |
| Claude Code loads the plugin and reaches the server | Passed: `claude mcp list` shows `plugin:joulo:joulo` as "Needs authentication" |
| Unauthenticated `POST /mcp` returns 401 with `WWW-Authenticate` and resource metadata | Passed |
| OAuth sign-in and tool calls from Claude Code | **Not tested**: needs an interactive sign-in |
| Tool calls from Codex | **Not tested here**: [`docs/demo.mp4`](docs/demo.mp4) shows a development run |
| Upload of the generated ZIP to the OpenAI portal | **Not tested**: OpenAI publishes no offline validator |
| Install from the private GitHub repository | Passed: `marketplace add` and `install joulo@joulo` in a clean Claude Code config, then "Needs authentication" |

## Platform differences

See [`docs/platform-support.md`](docs/platform-support.md).

## License

MIT, see [`LICENSE`](LICENSE). The license covers this repository: manifests, icon, docs and scripts. The MCP server and the Joulo service are not part of it.
