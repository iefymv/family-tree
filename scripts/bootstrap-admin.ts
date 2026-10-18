// Первый админ (Е6): npm run bootstrap-admin -- --ref <external_ref>
// Нужны переменные окружения SUPABASE_URL и SUPABASE_SECRET_KEY. Логин и пароль спрашиваются в терминале.
import { main } from './lib/member-cli.ts';

main('admin');
