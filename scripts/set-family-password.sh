#!/bin/sh
# Задаёт общий семейный пароль на сервере (секрет функции family-login). Пароль не печатается и не сохраняется в файлах.
printf 'Общий пароль для родни (не виден при вводе): '
stty -echo; read -r P; stty echo; echo
[ ${#P} -ge 6 ] || { echo "Нужно минимум 6 символов"; exit 1; }
supabase secrets set FAMILY_PASSWORD="$P" >/dev/null && echo "Готово: семейный пароль сохранён на сервере."
