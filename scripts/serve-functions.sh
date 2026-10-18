#!/bin/sh
# Локальный запуск Edge Functions для интеграционных тестов (нужен `supabase start`).
# ALLOWED_ORIGINS здесь не секрет; в проде задаётся через `supabase secrets set`.
set -e
envfile=$(mktemp)
trap 'rm -f "$envfile"' EXIT INT TERM
echo 'ALLOWED_ORIGINS=http://localhost:5173' > "$envfile"
supabase functions serve --env-file "$envfile"
