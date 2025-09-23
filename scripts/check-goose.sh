#!/usr/bin/env bash
set -euo pipefail

# check-goose.sh
# Preflight check to ensure Goose is installed and configured.
# - Verifies goose binary is available
# - Runs `goose info` to confirm configuration is readable
# Exits non-zero with guidance if checks fail.

# If a local env script exists, source it so both preflight and Node inherit the vars
if [[ -f ".goose-env.sh" ]]; then
  # shellcheck disable=SC1091
  source ./.goose-env.sh
  echo "[preflight] Sourced .goose-env.sh"
fi

resolve_goose() {
  if [[ -n "${GOOSE_BINARY:-}" ]]; then
    if [[ -x "${GOOSE_BINARY}" ]]; then
      echo "${GOOSE_BINARY}"
      return 0
    else
      echo "GOOSE_BINARY is set but not executable: ${GOOSE_BINARY}" >&2
      return 1
    fi
  fi
  # Common install location
  if [[ -x "$HOME/.local/bin/goose" ]]; then
    echo "$HOME/.local/bin/goose"
    return 0
  fi
  if command -v goose >/dev/null 2>&1; then
    command -v goose
    return 0
  fi
  return 1
}

if ! GOOSE_PATH="$(resolve_goose)"; then
  echo "[preflight] Goose CLI not found. Attempting automatic install..." >&2
  if [[ -f "scripts/install-goose.sh" ]]; then
    CONFIGURE=false bash scripts/install-goose.sh || true
  else
    echo "[preflight] Installer script missing at scripts/install-goose.sh" >&2
  fi
  # Re-check after attempted install
  # Also try with PATH including ~/.local/bin for this script
  export PATH="$HOME/.local/bin:$PATH"
  if ! GOOSE_PATH="$(resolve_goose)"; then
    cat >&2 <<EOF
[preflight] Goose CLI still not found after attempted install.
- Install manually from: https://github.com/block/goose/releases
- Or set GOOSE_BINARY to the absolute path of the goose executable.
EOF
    exit 1
  fi
  # Persist the discovered goose path into a .env file for the Node server (dotenv)
  if [[ "$GOOSE_PATH" == "$HOME/.local/bin/goose" ]]; then
    ENV_FILE=".env"
    touch "$ENV_FILE"
    # Remove existing GOOSE_BINARY lines
    if grep -q '^GOOSE_BINARY=' "$ENV_FILE"; then
      tmpfile="${ENV_FILE}.tmp.$RANDOM"
      grep -v '^GOOSE_BINARY=' "$ENV_FILE" > "$tmpfile" && mv "$tmpfile" "$ENV_FILE"
    fi
    echo "GOOSE_BINARY=$GOOSE_PATH" >> "$ENV_FILE"
    echo "[preflight] Wrote GOOSE_BINARY to $ENV_FILE -> $GOOSE_PATH"
  fi
fi

echo "[preflight] Using goose at: ${GOOSE_PATH}"

# Run goose info to verify configuration; do not fail the entire startup on non-zero,
# but print clear guidance. Many config issues will show up here.
if ! "${GOOSE_PATH}" info; then
  cat >&2 <<EOF
[preflight] 'goose info' returned a non-zero status. This may indicate a configuration issue.
- Verify your provider env vars (e.g., GOOSE_PROVIDER__TYPE, GOOSE_PROVIDER__HOST, GOOSE_PROVIDER__API_KEY)
- See Goose env docs: https://block.github.io/goose/docs/guides/environment-variables
EOF
  exit 1
fi

echo "[preflight] Goose appears installed and configured."
