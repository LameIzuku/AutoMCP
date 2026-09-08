# Grok connection

The user passed the Sonnet + Sol live test and supplied a successful Grok-reported continuation result.

Double-click BhootMCP.cmd for an enable/disable/status menu. No project path is needed. Restart Grok after toggling. In a normal Grok session, ask it to use BhootMCP resolve_clarification for technical questions and continue with resolved answers. Enabling makes the tool available, but does not force tool calls or intercept every question.

Keep the bridge and the extension's dedicated Sonnet 5 Medium tab running. In PowerShell:

```powershell
& 'C:\path\to\AutoMCP\Grok-with-BhootMCP.cmd' --test
```

The launcher checks the browser heartbeat, finds Codex, registers BhootMCP using the local environment, and asks Grok to actually call the clarification tool. It requests a recommendation afterward in the same turn. Approve the BhootMCP tool if Grok asks. The test must end with BHOOT_GROK_CONTINUATION_OK in Grok's final response. This is Grok's reported continuation; inspect the displayed tool activity as well before claiming the full integration is verified. No file edits are requested.

To use it with a real project:

```powershell
& 'C:\path\to\AutoMCP\Grok-with-BhootMCP.cmd' 'C:\path\to\your\project'
```

With no project argument the optional launcher uses the terminal's current folder. It supplies the MCP clarification rules every session. Starting plain grok will discover the enabled tool but will not automatically receive these extra rules. Unrelated Grok configuration is preserved. No blanket auto-approve setting is enabled. If an existing project defines its own bhoot MCP server, that project configuration may override the user entry; inspect it with grok mcp list in that project.

The MCP result returns directly to Grok's active turn; a separate Stop hook is not needed for this route. Clarifications printed without a tool call are not intercepted. If your MCP timeout is too short, set tool_timeout_sec=480 under [mcp_servers.bhoot] in your Grok config.
