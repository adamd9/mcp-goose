#!/usr/bin/env bash
set -euo pipefail

# install-goose.sh
# Checks for Goose CLI and installs it if missing using the official installer,
# skipping interactive configuration so you can supply config via environment variables.
#
# Usage:
#   ./scripts/install-goose.sh
#
# Notes:
# - Honors $GOOSE_BINARY if set to an absolute path.
# - Otherwise looks for `goose` on PATH.
# - If not found, installs from the stable release channel with CONFIGURE=false.
# - After installation, prints the resolved goose path and version.

# Resolve goose path
RESOLVED_GOOSE=""
if [[ -n "${GOOSE_BINARY:-}" ]]; then
  if [[ -x "${GOOSE_BINARY}" ]]; then
    RESOLVED_GOOSE="${GOOSE_BINARY}"
  else
    echo "GOOSE_BINARY is set but not executable: ${GOOSE_BINARY}" >&2
    exit 1
  fi
else
  if command -v goose >/dev/null 2>&1; then
    RESOLVED_GOOSE="$(command -v goose)"
  fi
fi

if [[ -n "${RESOLVED_GOOSE}" ]]; then
  echo "Goose already installed at: ${RESOLVED_GOOSE}"
  "${RESOLVED_GOOSE}" --version || true
  exit 0
fi

# Install Goose from stable channel without interactive configure
echo "Goose not found. Installing from stable channel..."
if command -v curl >/dev/null 2>&1; then
  # shellcheck disable=SC2312
  bash -c 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash'
else
  echo "curl is required to install Goose automatically. Please install curl and retry." >&2
  exit 1
fi

# Re-resolve after install
if command -v goose >/dev/null 2>&1; then
  RESOLVED_GOOSE="$(command -v goose)"
  echo "Goose installed at: ${RESOLVED_GOOSE}"
  "${RESOLVED_GOOSE}" --version || true
else
  echo "Goose installation completed but 'goose' was not found on PATH. You may need to add it to PATH or set GOOSE_BINARY." >&2
  exit 1
fi
