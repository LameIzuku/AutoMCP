# Connect Sonnet without API keys

The browser extension and localhost bridge are implemented. The extension uses the Claude page UI, not private endpoints or exported account cookies. Keep Chrome or Edge running and keep its dedicated Claude tab open. This is a separate browser login from the Codex in-app browser.

## One-time setup

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge. Turn on Developer mode, click **Load unpacked**, and choose `C:\path\to\AutoMCP\extension`.
2. In PowerShell, run:

   ```powershell
   & 'C:\path\to\AutoMCP\Start-BhootMCP.cmd'
   ```

   This starts a hidden localhost bridge and copies its local pairing code to the clipboard. It does not print that code or collect any Claude credentials. The .cmd launcher uses Node directly and does not change or depend on PowerShell script execution policy. You can also double-click Start-BhootMCP.cmd.

3. Open the BhootMCP extension popup. Paste the pairing code, click **Pair with local bridge**, then **Start Claude tab**.
4. Sign into Claude in the tab it opens, select **Sonnet 5 Medium**, and leave that tab open. The extension will reject a different model rather than switch to Opus or silently substitute another Sonnet version.

The extension requests access only to Claude and loopback HTTP, plus storage and alarms. Its secret is scoped to claiming browser jobs and returning answers; it cannot submit jobs to the server. Ordinary websites cannot access the local bridge. The extension acts only in the tab it creates, and never reads account cookies. Pause it from the popup when finished. Treat its dedicated tab as an automation workspace, not a personal drafting tab.

## Test the live loop

```powershell
Set-Location 'C:\path\to\AutoMCP'
$env:BHOOT_MODE = 'accounts'
Remove-Item Env:BHOOT_CLAUDE_CAPTURE -ErrorAction SilentlyContinue
Remove-Item Env:BHOOT_MOCK -ErrorAction SilentlyContinue
$env:BHOOT_CODEX_BIN = (Get-Command codex).Source
node dist/cli.js examples/question.json
```

Expect a new question in the dedicated Claude tab, a Sonnet answer, then a JSON result from BhootMCP with `mock: false`. Sol runs through Codex account login. The comparison makes two Codex calls (candidate and judge) and one Sonnet browser request. Questions reach Sonnet and Sol in parallel. Typical polling is every two seconds; background tab throttling may slow this down.

## Connect Grok after the live test

```powershell
grok mcp add bhoot -e BHOOT_MODE=accounts -e "BHOOT_CODEX_BIN=$((Get-Command codex).Source)" -- node 'C:\path\to\AutoMCP\dist\server.js'
grok mcp doctor bhoot
```

Set the bhoot MCP tool timeout to 480 seconds in Grok configuration if needed. Claude jobs expire after 240 seconds, Codex calls after 180 seconds; a judge runs after both candidates. Use the MCP rules in examples/grok-rules.txt. The optional Stop hook is an alternative and needs the same account-mode environment and a 480-second timeout. Leave permissions dialogs for the user.

## Behavior and limits

- One Claude job runs at a time. Every job gets its own new chat and request ID.
- The extension records a submission before clicking Send. Interrupted or ambiguous jobs fail rather than resend automatically.
- Login requirements, wrong model, malformed answers and timeouts become failures. No Opus, upgrade, or API fallback is automatic.
- New jobs need a connected extension heartbeat. Closed/paused browsers are reported as unavailable before starting Codex work.
- Bridge state is held in memory and is cleared on restart. Pending jobs are not replayed after restart. Request content is not written to bridge logs.
- Credentials for the bridge are stored in `%LOCALAPPDATA%\BhootMCP\bridge.json`, outside the OneDrive project. Claude chat history remains in your account under Claude's normal behavior.
- Sol uses low or medium effort based on question difficulty; judging uses medium. Remaining subscription quota is not yet read automatically. Claude usage exhaustion is handled as a failed/timed-out job, not worked around.
- Tests cover the real HTTP queue, authentication and role separation, plus simulated extension/UI behavior using selectors observed in Claude. An installed-extension live test is still required before calling this end-to-end verified.

## Troubleshooting

Run Start-BhootMCP.cmd again after restarting Windows. Check `%LOCALAPPDATA%\BhootMCP\bridge-launcher.log` if the server is unavailable. Reopen the popup and Start Claude tab after closing its tab. If the selected model changes, correct it and submit a new request. Do not repeatedly run the same failed request in one long-lived MCP process: its cache retains failures until restart or eviction.
