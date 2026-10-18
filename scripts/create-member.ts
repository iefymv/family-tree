// Резервный путь, если Edge Function admin-users недоступна:
// npm run create-member -- --ref <external_ref> [--display-name <имя>]
// Нужны переменные окружения SUPABASE_URL и SUPABASE_SECRET_KEY. Создаёт вход с ролью relative.
import { main } from './lib/member-cli.ts';

main('relative');
