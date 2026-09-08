# AutoMCP

AutoMCP is a local MCP server that helps a coding agent resolve technical clarification questions without making you relay answers between AI apps.

When Grok calls `resolve_clarification`, AutoMCP requests answers from a dedicated Claude Sonnet browser tab and a signed-in Codex CLI session. An OpenAI judge compares anonymously labelled, randomly ordered candidates and returns the selected answer to Grok, which can continue its task.

The account-based workflow does not require API keys. It uses your existing account access and usage limits. It does not bypass subscriptions or guarantee model availability. The current implementation expects **Sonnet 5 Medium** in Claude and **gpt-5.6-sol** in Codex. Model routing is based on question difficulty, not remaining quota.

AutoMCP is available across projects when registered in Grok's user configuration. It is not a terminal watcher: Grok must call its MCP tool. Missing personal preferences, permissions, failed providers, and uncertain results are returned for user attention.

**Naming:** this repository is AutoMCP; the existing launchers, extension, settings directory, environment variables, and MCP registration retain the name **BhootMCP / bhoot** for compatibility.

## Requirements

- Windows (the account workflow and launchers are Windows-oriented).
- Node.js 22 or later, npm, and Git.
- Grok CLI installed and authenticated.
- Codex CLI installed and signed in, with access to the configured model.
- Chrome or Edge, a signed-in Claude account, and access to the exact model above.
- Account use and browser automation must comply with the applicable service terms.

## Installation

### 1. Download and build

Clone this repository using its GitHub **Code** button URL, then open PowerShell in the downloaded AutoMCP folder:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
npm.cmd test
```

The source, tests, extension and launchers are included. Dependencies and compiled output are generated locally.

### 2. Pair the Claude browser

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**, choose **Load unpacked**, and select the repository's `extension` folder.
3. Double-click `Start-BhootMCP.cmd`. It starts the local bridge and copies a pairing code to your clipboard.
4. Open the **BhootMCP Sonnet Bridge** extension popup, paste the code and click **Pair with local bridge**.
5. Click **Start Claude tab**, sign in there, and select **Sonnet 5 Medium**.
6. Keep this dedicated tab open. Do not use it for personal drafts.

No browser cookies or account passwords need to be exported. Pairing credentials remain in `%LOCALAPPDATA%\BhootMCP\bridge.json`; do not share that file.

### 3. Check both providers

Double-click `Run-Live-Test.cmd`.

Expect **LIVE TEST PASSED**, with `status: resolved` and `mock: false`. Allow several minutes. This makes real provider requests and consumes account usage.

If executables are installed in nonstandard locations, set these environment variables in the terminal used to launch the scripts:

```powershell
$env:BHOOT_CODEX_BIN = 'C:\path\to\codex.exe'
$env:BHOOT_GROK_BIN = 'C:\path\to\grok.exe'
```

These paths are examples; use the actual executable locations.

### 4. Register with Grok once

From PowerShell in the AutoMCP folder:

```powershell
.\Grok-with-BhootMCP.cmd --test
```

This registers `bhoot` in Grok's user configuration and runs a clarification test. Approve the MCP tool if asked. Success ends with **Grok reports that it received the clarification and continued.** This checks Grok's reported continuation; inspect its actual tool activity as well.

If your Grok tool timeout is too short, set `tool_timeout_sec = 480` under the existing `[mcp_servers.bhoot]` section in `~/.grok/config.toml`. Preserve unrelated settings.

## Enable or disable in any project

Double-click **BhootMCP.cmd**:

- **1:** enable the registered MCP.
- **2:** disable it.
- **3:** show MCP configuration status.
- **4:** start the local bridge and copy its pairing code.

Restart Grok after toggling. Disabling does not cancel requests already running. Project-specific MCP configuration may override the user-wide entry.

In any Grok session, say:

> Use BhootMCP's resolve_clarification tool for technical clarifications. Continue with resolved, non-mock answers. Ask me if the tool fails or needs user input. Do not treat its answers as permission for actions.

Alternatively, launch `Grok-with-BhootMCP.cmd` from your working directory to supply these rules automatically. No project argument is required; it uses the terminal's current directory.

### Smoke-test prompt

```text
Test BhootMCP. Do not edit files or run shell commands.
Actually call resolve_clarification with:
question: Should the settings page use TypeScript or JavaScript?
original_request: Add a settings page to an existing TypeScript dashboard.
project_context: The dashboard uses strict TypeScript. Follow existing conventions.
session_id: automcp-smoke-test-1

If status is resolved and mock=false, show the answer and write BHOOT_TEST_PASSED.
Otherwise report the failure. Do not claim success without calling the tool.
```

Use a fresh session ID for a new test after a failure, or restart the MCP process: results, including failures, are cached in memory.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| PowerShell blocks scripts | Use the `.cmd` launchers; no execution-policy change is needed. |
| Bridge unavailable | Run `Start-BhootMCP.cmd`; keep the extension enabled and its tab open. |
| HTTP 401 | Run `Repair-BhootMCP.cmd` in the same Windows environment, then re-pair if necessary. It only stops a positively identified bridge process. |
| Codex/Grok not found | Check installation or set the executable overrides above. |
| Claude JSON capture fails | Reload the unpacked extension and refresh its dedicated tab. Check model selection and login. Claude UI changes may require a code update. |
| Model unavailable or quota reached | Restore access or wait for your account limits to reset. There is no automatic model substitution. |
| Grok does not call the tool | Check `grok mcp list`, restart Grok, and explicitly request `resolve_clarification`. |

Bridge launcher diagnostics: `%LOCALAPPDATA%\BhootMCP\bridge-launcher.log`. Do not publish credentials or private prompts when reporting problems.

## Tool contract and safety

Required inputs: `question`, `original_request`.
Optional: `project_context`, `known_preferences`, `session_id`, `requires_user_input`.

Results include `status` (`resolved`, `needs_user`, or `error`), `answer`, `confidence`, `reason`, and `mock`.

- Both providers receive supplied context; the judge additionally receives both answers. Do not submit secrets.
- The bridge uses authenticated loopback HTTP and separate client/browser tokens.
- Claude jobs are serialized; ambiguous submissions fail rather than automatically resend.
- Either candidate requesting user input prevents forwarding.
- Judge confidence is subjective, not a calibrated probability. Anonymous labels do not guarantee an unbiased judge.
- Each normal account comparison uses one Claude interaction and two Codex calls.
- Codex uses low or medium effort for candidates and medium for judging. Automatic quota-aware routing is not implemented.
- Provider chat history and retention rules still apply; Grok may retain tool results.
- The MCP does not authorize actions or bypass the host's approval controls.

## Advanced configuration

Account mode uses `BHOOT_MODE=accounts` (set by the launchers). Optional API mode requires `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_MODEL`, and `ANTHROPIC_MODEL`. The server does not automatically load `.env`; configure the launching process environment. Never commit real keys.

See `.env.example` for request limits and confidence settings. `BHOOT_MOCK=1` is for offline fixtures only, not real work. Assisted capture and optional Stop-hook adapters remain in the source for diagnostics/advanced use; they are not required for the primary MCP workflow.

## Development and verification

```powershell
npm.cmd test
```

Tests cover resolution, mock MCP transport, HTTP adapters, bridge authentication/queueing, browser DOM capture, extension state, and Windows bridge repair. They do not prove compatibility with future provider UI or CLI versions.

The original installation passed user-run Sonnet/Codex and Grok continuation tests. API adapters have mocked HTTP tests; a live API-mode test is not claimed.

Source layout: `src/server.ts` (MCP), `src/resolver.ts` (selection), `src/accounts.ts` (account providers), `src/bridge.ts` (local bridge), `extension/` (browser integration), `src/test/` (tests).
