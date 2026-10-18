#!/bin/sh
# Локальный запуск Edge Functions для интеграционных тестов (нужен `supabase start`).
# ALLOWED_ORIGINS здесь не секрет; в проде задаётся через `supabase secrets set`.
# FAMILY_PASSWORD — ТЕСТОВОЕ значение, генерируется при каждом запуске (настоящий семейный пароль сюда не попадает)
# и кладётся в gitignored supabase/.temp/family-password.test, откуда его читают тесты.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
umask 077
envfile=$(mktemp)
trap 'rm -f "$envfile"' EXIT INT TERM
family="test-$(openssl rand -hex 12)"
mkdir -p "$root/supabase/.temp"
printf '%s' "$family" > "$root/supabase/.temp/family-password.test"
{
  echo 'ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4174,http://127.0.0.1:4174'
  echo "FAMILY_PASSWORD=$family"
} > "$envfile"
cd "$root"
supabase functions serve --env-file "$envfile"
