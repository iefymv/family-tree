// Проверяет текст на слова из private/stoplist.txt (реальные имена — только локально).
import { readFileSync, existsSync } from 'node:fs';
const LIST = new URL('../private/stoplist.txt', import.meta.url);
export function loadStoplist() {
  if (!existsSync(LIST)) { console.error('Нет private/stoplist.txt — коммит запрещён.'); process.exit(1); }
  return readFileSync(LIST, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}
export function findHits(text, words) {
  const low = text.toLowerCase();
  return words.filter(w => low.includes(w.toLowerCase()));
}
if (process.argv[2] === '--text') {
  const hits = findHits(readFileSync(process.argv[3], 'utf8'), loadStoplist());
  if (hits.length) { console.error(`Стоп-слово в сообщении коммита (${hits.length} шт.). Уберите реальные имена.`); process.exit(1); }
}
