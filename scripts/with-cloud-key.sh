#!/bin/sh
# Запускает команду с ключами облачного Supabase из CLI (ключи не печатаются и не сохраняются).
# Использование: sh scripts/with-cloud-key.sh npm run bootstrap-admin -- --ref <ref>
REF=isyyhzkmfntblgcolzvx
KEYS=$(supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null) || { echo "Нет доступа к Supabase CLI (supabase login)"; exit 1; }
SUPABASE_SECRET_KEY=$(printf '%s' "$KEYS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(k=>["service_role","secret"].includes(k.name)||k.type==="secret");process.stdout.write(k.api_key)})')
SUPABASE_URL="https://$REF.supabase.co"
export SUPABASE_URL SUPABASE_SECRET_KEY
exec "$@"
