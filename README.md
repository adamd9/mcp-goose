# mcp-goose

A secure MCP (Model Context Protocol) server that lets other AI agents use the Goose CLI to automate coding tasks on a single project folder.

- Works with the official Goose CLI in headless (non-interactive) mode
- Runs only inside one pre-approved project directory
- Lets you start tasks, check status, and stream logs for long-running work
- Protected by a bearer token (Authorization header)


## Quick Start (fully headless)
```bash
# 1) Install dependencies
npm install

# 2) Configure environment (edit values for your setup)
export AUTH_TOKEN="your-secret"
export GOOSE_SCOPE_DIR="/abs/path/to/your/project"
# optional: export GOOSE_BINARY="/usr/local/bin/goose"

# Provider and model (example: OpenAI)
export GOOSE_PROVIDER__TYPE="openai"
export GOOSE_PROVIDER__HOST="https://api.openai.com/v1"
export GOOSE_PROVIDER__API_KEY="your-openai-api-key"
export GOOSE_MODE="auto"
export GOOSE_PROVIDER="openai"
export GOOSE_MODEL="gpt-4.1"
export GOOSE_MAX_TURNS="100"

# Tip: If you keep your exports in a shell file (e.g. ./.goose-env.sh), be sure to SOURCE it so the variables apply to your current shell:
#   source ./.goose-env.sh
# (Running `sh ./.goose-env.sh` will not persist the variables.)

# 3) Start the server (auto-preflight + auto-install if needed)
npm start
```

What happens on `npm start`:
- Verifies Goose is installed. If missing, it automatically installs Goose from the stable channel (non-interactive) and retries.
- Runs `goose info` to confirm configuration (e.g., provider API key). If there is a problem, startup fails with clear guidance.

Note: automatic install requires `curl` to be available on the system.

Absolute path requirement:
- `GOOSE_SCOPE_DIR` must be an absolute path (e.g., `/Users/you/code/my-project`).


## What is this?
`mcp-goose` is like a bridge between AI agents and your local Goose setup. It exposes a small set of safe, focused commands from the Goose CLI through the MCP protocol, so any MCP-compatible AI agent can:

- Start a Goose task (for example, run a recipe)
- Check how that task is going
- Read the output logs as the task runs
- Stop a task if needed

All of this happens inside a single project directory that you configure up-front.


## Why would I use it?
- You want an AI agent (or multiple agents) to run Goose tasks on a codebase you control
- You want strong safety boundaries: only Goose can run, and only in one folder
- You need reliable ways to monitor and manage long-running tasks


## How it works (at a high level)
- You point `mcp-goose` at the project folder you want Goose to operate on (the "scope directory").
- You provide a bearer token that clients must use to authenticate.
- An AI agent connects over MCP and uses a small set of tools to run Goose commands.
- The server captures logs and provides status updates while Goose works.


## Security boundaries
- Only the Goose binary is executed; no shell access, no arbitrary commands
- All commands run inside your configured project directory
- A small, allowlisted set of Goose commands and flags is supported
- Authentication is required via `Authorization: Bearer <token>`
- Concurrency is limited to one job at a time by default

These boundaries are designed to be safe for production-style usage.


## What you’ll need
- Node.js 18+
- The Goose CLI installed (latest recommended)
- A project directory already configured for Goose (zero-config for this server)

Helpful Goose docs:
- Quickstart: https://block.github.io/goose/docs/quickstart
- CLI Commands: https://block.github.io/goose/docs/guides/goose-cli-commands
- Headless Mode: https://block.github.io/goose/docs/tutorials/headless-goose


## Installation
1) Clone this repository
2) Install dependencies

```bash
npm install
```

3) Install Goose CLI (if needed)

```bash
# optional: installs Goose from the stable channel without interactive configure
chmod +x scripts/install-goose.sh
./scripts/install-goose.sh
```


## Configuration
Set the following environment variables before starting the server:

- `AUTH_TOKEN` (required)
  The bearer token clients must send in the `Authorization` header.

- `GOOSE_SCOPE_DIR` (required)
  Absolute path to the project directory Goose should operate on.

- `GOOSE_BINARY` (optional)
  Absolute path to the `goose` executable. Defaults to `goose` on your PATH.

- `MAX_CONCURRENCY` (optional)
  Defaults to `1`. Keeps operations predictable and safe.

- `LOG_MAX_BYTES` (optional)
  Maximum bytes of log data kept per job (default: 8,000,000 ~ 8 MB).

Example:
```bash
export AUTH_TOKEN="your-secret"
export GOOSE_SCOPE_DIR="/abs/path/to/your/project"
export GOOSE_BINARY="/usr/local/bin/goose"   # optional
export MAX_CONCURRENCY="1"
export LOG_MAX_BYTES="8000000"
```

You can also start from the example environment file provided in this repo (remember to SOURCE it, not run it):

```bash
cp examples/goose-env.example.sh .goose-env.sh
# edit .goose-env.sh to set your token, ABSOLUTE scope directory, and provider API key
source .goose-env.sh
```

Provider configuration example (OpenAI) — set these before `npm start`:

```bash
export GOOSE_PROVIDER__TYPE="openai"
export GOOSE_PROVIDER__HOST="https://api.openai.com/v1"
export GOOSE_PROVIDER__API_KEY="your-openai-api-key"

# Optional general headless tuning
export GOOSE_MODE="auto"
export GOOSE_PROVIDER="openai"
export GOOSE_MODEL="gpt-4.1"
export GOOSE_MAX_TURNS="100"
export GOOSE_CONTEXT_STRATEGY="summarize"
export GOOSE_CLI_MIN_PRIORITY="0.2"
```

For more Goose environment variables, see:
https://block.github.io/goose/docs/guides/environment-variables


## Starting the server
```bash
npm start
```

The server will run and wait for MCP clients to connect. On startup it automatically checks that Goose is installed and reports `goose info` results. It authenticates requests using the same header style as the reference MCP server (`Authorization: Bearer <token>`).


## Using with an MCP client
Any MCP-compatible client/agent can connect and call the tools exposed by `mcp-goose`. At a high level, the flow looks like this:

1) Start a Goose task with `goose_run` (for example, run a recipe)
2) Poll progress with `goose_status`
3) Stream logs with `goose_stream_logs`
4) Optionally fetch the final output with `goose_get_output`
5) If needed, stop a running job with `goose_stop`


## Supported tools (simple overview)
- `goose_run`
  - Start a new Goose job in headless mode using a text prompt only. This tool always executes `goose run --no-session -t "<text>"`.

- `goose_status`
  - Check if a job is queued, running, finished, failed, or canceled.

- `goose_stream_logs`
  - Read the live or recent logs from a job in chunks, so you can follow progress.

- `goose_get_output`
  - Retrieve the final stdout/stderr once a job is done.

- `goose_stop`
  - Stop a running job.

- `goose_recipe_validate`
  - Validate a recipe file (wraps `goose recipe validate <file>`).

- `goose_recipe_deeplink`
  - Generate a shareable link for a recipe file (wraps `goose recipe deeplink <file>`).

- `goose_session_list`
  - List saved sessions (wraps `goose session list` with optional `--verbose`, `--format`, `--ascending`).

- `goose_session_export`
  - Export a session to Markdown or stdout (wraps `goose session export` with `--id/--name/--path/--output`).

- `goose_list_commands`
  - See which Goose commands and flags this server allows.

- `goose_help`
  - Get `goose --help` output (either general or for a specific subcommand).

- `goose_version`
  - Return the installed Goose version.

- `get_config`
  - Return non-sensitive server settings (like the scope directory).

- `health_check`
  - Simple liveness/readiness check.


## Common examples
- Run a text prompt headlessly and monitor
  - Call `goose_run` with input: `{ "text": "create a simple website that is a love letter to gooses" }`.
  - Poll with `goose_status` while it runs.
  - Use `goose_stream_logs` to watch progress.

- Validate a recipe
  - Call `goose_recipe_validate` with `file: "my-recipe.yaml"`.

- Check Goose version
  - Call `goose_version`.


## MCP Inspector
You can quickly exercise the MCP endpoint with the inspector:

```bash
# server should be running (npm start) and AUTH_TOKEN exported
npm run mcp:inspect
```

This sends MCP traffic to `POST http://localhost:3003/mcp` with the `Authorization: Bearer $AUTH_TOKEN` header.


## Tips for reliable headless runs
- Prefer recipes for repeatable automation. In headless mode, recipes should include a `prompt` field.
- Set Goose environment variables to your preferences (provider, model, max turns) in your shell/profile before starting the server.
- Avoid interactive flags; this server is designed for non-interactive, automated tasks.

Console output:
- Job stdout/stderr is echoed to the server console by default with prefixes like `[goose:<jobId>:stdout] ...`.
- To disable console echoing, set `ECHO_JOB_LOGS=false` before `npm start`.


## Troubleshooting
- Authentication errors: make sure your client sends `Authorization: Bearer <AUTH_TOKEN>`.
- "Command not allowed": the server blocks commands/flags not on its internal allowlist.
- "Goose not found": set `GOOSE_BINARY` to the absolute path of your Goose CLI if it isn’t on PATH.
- Logs truncated: increase `LOG_MAX_BYTES` if you need longer history per job.


## Roadmap
- Optional webhook notifications on job completion (with signing)
- Persistent job history (so you can see past runs after restarts)
- Metrics and tracing (visibility into run times and success rates)
- Per-token policies and rate limits


## License
This project reuses patterns from the `mcp-reference` server and follows similar licensing practices. See `LICENSE` for details.


## Local Goose Docs (optional)
For offline reference, the Goose documentation has been checked out sparsely under:

- `ref-docs/documentation/docs/`

This includes guides like `guides/goose-cli-commands.md`, `quickstart.md`, and tutorials.*** End Patch
