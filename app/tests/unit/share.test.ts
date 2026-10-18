// Текст приглашения «Поделиться с родственником»: точный текст, строка пароля, ссылки.
import { describe, expect, it } from 'vitest';
import { inviteText, PASSWORD_LATER, passwordLine, telegramLink, whatsappLink } from '../../src/ui/share';

const URL = 'https://example.test/family/';

describe('приглашение', () => {
  it('с именем отправителя; без имени — просто «Привет!»', () => {
    expect(inviteText(URL, '', 'Анна').startsWith('Привет! Это Анна. Мы всей семьёй собираем наше семейное дерево')).toBe(true);
    expect(inviteText(URL, '', '  ').startsWith('Привет! Мы всей семьёй')).toBe(true);
  });
  it('текст по умолчанию — без пароля', () => {
    const t = inviteText(URL);
    expect(t.startsWith('Привет! Мы всей семьёй собираем наше семейное дерево — родных, фото, даты и истории, чтобы ничего не забылось и дети знали, откуда мы.\n')).toBe(true);
    expect(t).toContain(`1. Открой ссылку: ${URL}\n`);
    expect(t).toContain(`3. Введи общий семейный пароль — ${PASSWORD_LATER}\n`);
    expect(t.endsWith('Чем больше каждый допишет, тем полнее будет дерево!')).toBe(true);
    expect(t.split('\n')).toHaveLength(12);
  });
  it('пароль попадает только если вписан', () => {
    expect(passwordLine('')).toBe(PASSWORD_LATER);
    expect(passwordLine('  ')).toBe(PASSWORD_LATER);
    expect(inviteText(URL, 'ромашка')).toContain('семейный пароль — пароль: ромашка\n');
  });
  it('ссылки WhatsApp и Telegram кодируют текст', () => {
    const t = inviteText(URL);
    expect(whatsappLink(t)).toBe(`https://wa.me/?text=${encodeURIComponent(t)}`);
    expect(telegramLink(URL, t)).toBe(`https://t.me/share/url?url=${encodeURIComponent(URL)}&text=${encodeURIComponent(t)}`);
  });
});
