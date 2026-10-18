#!/bin/sh
# Локальный запуск Edge Functions для интеграционных тестов (нужен `supabase start`).
# ALLOWED_ORIGINS здесь не секрет; в проде задаётся через `supabase secrets set`.
set -e
envfile=$(mktemp)
trap 'rm -f "$envfile"' EXIT INT TERM
echo 'ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4174,http://127.0.0.1:4174' > "$envfile"
supabase functions serve --env-file "$envfile"
