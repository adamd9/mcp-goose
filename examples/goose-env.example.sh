#!/usr/bin/env bash
# Example environment configuration for Goose (headless) + mcp-goose
# Copy to your own .env or export into your shell before starting the server.
# For more options, see: https://block.github.io/goose/docs/guides/environment-variables

# --- Authentication for mcp-goose ---
export AUTH_TOKEN="replace-with-a-strong-secret"

# --- Project selection ---
# Preferred: set PROJECT_NAME and mcp-goose will use a subdirectory under this repo:
#   <repo-root>/projects/$PROJECT_NAME
# That directory will be auto-created and "git init" will be run on first start.
export PROJECT_NAME="my-website"

# Optional override: provide an absolute scope directory instead of PROJECT_NAME.
# If set, this takes precedence and must be an absolute path.
# export GOOSE_SCOPE_DIR="/abs/path/to/your/project"

# --- Optional: explicit goose binary path ---
# export GOOSE_BINARY="/usr/local/bin/goose"

# --- Optional: server limits ---
export MAX_CONCURRENCY="1"
export LOG_MAX_BYTES="8000000"

# --- Provider configuration (example: OpenAI) ---
# These map to Goose's environment variable schema.
export GOOSE_PROVIDER__TYPE="openai"
export GOOSE_PROVIDER__HOST="https://api.openai.com/v1"
export GOOSE_PROVIDER__API_KEY="your-openai-api-key"

# --- General Goose headless tuning (optional) ---
export GOOSE_MODE="auto"
export GOOSE_PROVIDER="openai"
export GOOSE_MODEL="gpt-4.1"
export GOOSE_MAX_TURNS="100"
export GOOSE_CONTEXT_STRATEGY="summarize"
export GOOSE_CLI_MIN_PRIORITY="0.2"

# After exporting these, you can run:
#   npm start
# And authenticate your MCP client with: Authorization: Bearer $AUTH_TOKEN
