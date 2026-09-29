# LedgerLens MCP server

Stdio MCP server that gives an AI assistant the same read-only analysis the web app has, under the same user scope.

## Tools

| Tool | Effect |
|---|---|
| `list_dimensions` | Metrics, accounts, departments in scope, approved budgets, current snapshot |
| `ask_variance` | Hebrew/English question → answer, clarification or abstention, with result IDs |
| `query_variance` | Typed query: metric, months, grouping, optional department filter |
| `get_evidence` | Source rows behind a `result_id` (refused if any row is out of scope) |
| `close_status` | Close tasks and gates for a month (read-only) |
| `create_scenario` | Private hypothetical levers on future months |
| `calculate_scenario` | Baseline vs scenario by month |

**Not exposed on purpose:** imports and publishing, task updates, declaring close ready, approvals. These need a human in the web UI.

## Configure (Claude Code / Claude Desktop)

```json
{
  "mcpServers": {
    "ledgerlens": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/server.ts"],
      "cwd": "/path/to/ledgerlens",
      "env": {
        "DATABASE_URL": "postgres://ledger_app:ledger_app_dev@localhost/ledgerlens",
        "LEDGERLENS_DEMO_AUTH": "1",
        "LEDGERLENS_USER": "cfo"
      }
    }
  }
}
```

`LEDGERLENS_USER` is a demo identity. Production needs an authenticated identity per user (for example an HTTP transport behind OAuth) before this server touches real data.
