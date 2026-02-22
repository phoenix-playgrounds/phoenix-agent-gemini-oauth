# Phoenix Agent

A multi-provider AI agent that runs as a standalone container with a built-in chat UI. Authenticates via OAuth and communicates with AI providers through CLI wrappers.

## Chat UI

The agent ships with a built-in web-based chat interface served on port `3100` (configurable via `CHAT_PORT`). Open `http://localhost:3100` in a browser to interact with the agent directly — no Rails backend required.

The chat supports:
- OAuth authentication flow (provider-specific)
- Real-time messaging via WebSocket
- Single-session enforcement (one active user at a time)
- Auto-reconnect on connection drops

## Supported Providers

| Provider | `AGENT_PROVIDER` value | Status |
|---|---|---|
| Gemini CLI | `gemini` (default) | ✅ Fully implemented |
| OpenAI Codex | `openai_codex` | ✅ Fully implemented |
| Claude Code | `claude_code` | ✅ Implemented (requires dbus + gnome-keyring in Docker) |
| OpenCode | `opencode` | 🚧 Stub |
| Mock | `mock` | ✅ For testing (instant success, no real CLI calls) |

## Claude Code — Implementation Notes

Claude Code CLI requires special handling in Docker compared to Gemini and Codex:

**Authentication:** The `claude` CLI uses browser-redirect OAuth (no device code flow). In Docker, the agent captures the auth URL from stdout, sends it to the user, and when the user's browser redirect fails (pointing to container's localhost), the user copies the **full redirect URL** from their browser's address bar. The agent then forwards this URL to the CLI's local callback server inside the container via HTTP GET.

**Credential storage:** Claude Code uses `libsecret` (gnome-keyring) on Linux. The Docker image includes `dbus` and `gnome-keyring`, and `bin/start.sh` initializes them before the Node.js agent starts.

**Prompt execution:** Uses `claude -p "prompt" --dangerously-skip-permissions` with `--add-dir` for each repository directory under `/app/playground`.

**User experience difference:** Instead of copying a short auth code (like Gemini/Codex), the user copies a full localhost URL from their browser address bar. The API contract (`submit_auth_code`) remains unchanged — the agent handles the URL internally.


## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CHAT_PORT` | No | `3100` | Port for the built-in chat web server |
| `AGENT_PROVIDER` | No | `gemini` | Which AI CLI provider to use (set to `mock` for testing) |

## Architecture

```
src/
├── index.mjs              # Entrypoint, graceful shutdown
├── agent.mjs              # Creates orchestrator + starts chat server
├── server.mjs             # Express HTTP + WebSocket server
├── websocket.mjs          # Orchestrator (wires events to strategy)
├── public/                # Chat UI (served as static files)
│   ├── index.html         # Chat page
│   ├── styles.css         # Dark theme CSS
│   └── chat.js            # WebSocket client + state machine
└── strategies/
    ├── base.mjs           # Abstract interface
    ├── index.mjs          # Strategy resolver (reads env vars)
    ├── gemini.mjs         # Gemini CLI implementation
    ├── openai_codex.mjs   # OpenAI Codex CLI implementation
    ├── claude_code.mjs    # Claude Code CLI implementation
    ├── mock.mjs           # Mock provider (for testing)
    └── opencode.mjs       # Stub

bin/
└── start.sh               # Entrypoint (conditionally starts dbus/gnome-keyring)
```

## Quick Start

```bash
# Run with Docker Compose (uses mock provider by default in dev)
docker compose up --build

# Open the chat UI
open http://localhost:3100
```

## Testing

- Run unit tests: `npm test`
- Run integration tests: `node tests/integration.mjs`
- Run linter: `npm run lint`

Integration tests use the `mock` provider and verify the full WebSocket flow (auth status check → chat message → response).

## WebSocket Protocol

The chat UI communicates with the agent over a plain JSON WebSocket at `/ws`.

### Client → Agent

| Action | Payload | Description |
|---|---|---|
| `check_auth_status` | — | Request current auth status |
| `initiate_auth` | — | Start OAuth flow |
| `submit_auth_code` | `code` (string) | Submit the authorization code |
| `cancel_auth` | — | Cancel current auth process |
| `reauthenticate` | — | Clear credentials and restart auth |
| `send_chat_message` | `text` (string) | Send a prompt to the AI provider |

### Agent → Client

| Event Type | Payload | Description |
|---|---|---|
| `auth_status` | `status`: "authenticated" \| "unauthenticated" | Current auth status |
| `auth_url_generated` | `url` (string) | OAuth URL to visit |
| `auth_success` | — | Authentication succeeded |
| `chat_message_in` | `text` (string) | AI response to a prompt |
| `error` | `message` (string) | Error message |
