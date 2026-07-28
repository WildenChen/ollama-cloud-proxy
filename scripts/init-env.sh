#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env}"
EXAMPLE_FILE="${ENV_EXAMPLE_FILE:-.env.example}"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "Cannot find $EXAMPLE_FILE" >&2
    exit 1
  fi
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from $EXAMPLE_FILE"
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate KEY_ENCRYPTION_SECRET" >&2
  exit 1
fi

CURRENT_SECRET=$(sed -n 's/^KEY_ENCRYPTION_SECRET=//p' "$ENV_FILE" | head -n 1)

if [ -n "$CURRENT_SECRET" ]; then
  echo "KEY_ENCRYPTION_SECRET already exists; no existing setting was changed."
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  exit 0
fi

GENERATED_SECRET=$(openssl rand -hex 32)
TMP_FILE="${ENV_FILE}.tmp.$$"

awk -v secret="$GENERATED_SECRET" '
  BEGIN { replaced = 0 }
  /^KEY_ENCRYPTION_SECRET=/ && replaced == 0 {
    print "KEY_ENCRYPTION_SECRET=" secret
    replaced = 1
    next
  }
  { print }
  END {
    if (replaced == 0) print "KEY_ENCRYPTION_SECRET=" secret
  }
' "$ENV_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true

echo "Generated a secure KEY_ENCRYPTION_SECRET in $ENV_FILE"
echo "Next: docker compose -f docker-compose.release.yml up -d"
