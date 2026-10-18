// «Поделиться с родственником»: готовое приглашение со ссылкой на сайт — отправить, скопировать,
// WhatsApp, Telegram. Семейный пароль сайт не знает и не хранит: если человек сам впишет его здесь,
// он попадает только в текст сообщения и стирается при закрытии окна.
import './share.css';

export const SHARE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/></svg>';
const WA_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-4A8 8 0 1 1 8 18.8L4 20Z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9a5 5 0 0 1-2.8-2.8l.9-1-1-2L9 8.5Z"/></svg>';
const TG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4L3 11l6 2 2 6 3-4 5 4 2-15Z"/><path d="M9 13l9-7"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export const PASSWORD_LATER = 'я скажу его тебе отдельно';
export const passwordLine = (password: string): string => (password.trim() ? password.trim() : PASSWORD_LATER);

/** Текст приглашения. */
export function inviteText(url: string, password = '', name = ''): string {
  const hi = name.trim() ? `Привет! Это ${name.trim()}.` : 'Привет!';
  return `${hi} Мы всей семьёй собираем наше семейное дерево — родных, фото, даты и истории, чтобы ничего не забылось и дети знали, откуда мы.
Как зайти:
1. Открой ссылку: ${url}
2. Введи своё имя и фамилию
3. Введи общий семейный пароль — ${passwordLine(password)}
Если тебя ещё нет на дереве — сайт предложит добавить себя.
Что можно делать:
— добавлять родных через «+»
— исправлять ошибки и неточности — это нормально, всё сохраняется
— загружать старые фото и документы
— дописывать даты, места и истории, даже если не уверен
Чем больше каждый допишет, тем полнее будет дерево!`;
}

/** Адрес сайта: origin + путь сборки, без ?demo и #… */
export function siteUrl(): string {
  const u = new URL(import.meta.env.BASE_URL || '/', location.href);
  u.search = '';
  u.hash = '';
  return u.toString();
}

export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const telegramLink = (url: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

export interface ShareOptions {
  /** Имя того, кто приглашает (given_name); пусто — приветствие без имени. */
  name: () => string;
  say: (text: string) => void;
  /** Общий пароль с сервера — подставляется в приглашение сразу (только для вошедших). */
  password?: () => Promise<string | null>;
}

function btn(cls: string, html: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.innerHTML = html; // статичная иконка
  const s = document.createElement('span');
  s.textContent = label;
  b.appendChild(s);
  return b;
}

/** Большая зелёная кнопка «Поделиться с родственником». */
export function shareButton(onClick: () => void, cls = ''): HTMLButtonElement {
  const b = btn(`share-cta ${cls}`.trim(), SHARE_ICON, 'Поделиться с родственником');
  b.addEventListener('click', onClick);
  return b;
}

export function createShareDialog(host: HTMLElement, opts: ShareOptions) {
  const dlg = document.createElement('dialog');
  dlg.className = 'share-dialog';
  dlg.setAttribute('aria-labelledby', 'share-title');
  const box = document.createElement('div');
  box.className = 'share-box';

  const head = document.createElement('header');
  const title = document.createElement('h2');
  title.id = 'share-title';
  title.textContent = 'Поделиться с родственником';
  const close = btn('share-close', CLOSE_ICON, '');
  close.setAttribute('aria-label', 'Закрыть');
  head.append(title, close);
  const lead = document.createElement('p');
  lead.className = 'share-lead';
  lead.textContent = 'Отправьте это приглашение родным: по ссылке они откроют дерево и смогут дописать то, что знают. Текст можно поправить.';

  const area = document.createElement('textarea');
  area.className = 'share-text';
  area.rows = 10;
  area.setAttribute('aria-label', 'Текст приглашения');
  area.spellcheck = false;

  // Пароль — по желанию, только в текст. Поле без name, автозаполнение выключено, при закрытии стирается.
  const pwWrap = document.createElement('div');
  pwWrap.className = 'share-pw';
  const pwToggle = document.createElement('label');
  pwToggle.className = 'share-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  const cbText = document.createElement('span');
  cbText.textContent = 'Добавить пароль в сообщение';
  pwToggle.append(cb, cbText);
  const pwField = document.createElement('label');
  pwField.className = 'share-pw-field';
  pwField.hidden = true;
  const pwLabel = document.createElement('span');
  pwLabel.textContent = 'Семейный пароль';
  const pw = document.createElement('input');
  pw.type = 'text';
  pw.autocomplete = 'off';
  pw.setAttribute('autocapitalize', 'off');
  pw.spellcheck = false;
  pw.setAttribute('data-lpignore', 'true');
  pwField.append(pwLabel, pw);
  const note = document.createElement('p');
  note.className = 'share-note';
  note.textContent = 'Лучше скажите пароль лично или голосом. Сайт его не запоминает — он попадёт только в этот текст.';
  pwWrap.append(pwToggle, pwField, note);

  const actions = document.createElement('div');
  actions.className = 'share-actions';
  const send = btn('btn btn-primary share-send', SHARE_ICON, 'Отправить');
  const copy = btn('btn btn-soft share-copy', COPY_ICON, 'Скопировать');
  actions.append(send, copy);
  const quick = document.createElement('div');
  quick.className = 'share-quick';
  const link = (cls: string, icon: string, label: string) => {
    const a = document.createElement('a');
    a.className = `share-link ${cls}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = icon;
    const s = document.createElement('span');
    s.textContent = label;
    a.appendChild(s);
    quick.appendChild(a);
    return a;
  };
  const wa = link('share-wa', WA_ICON, 'WhatsApp');
  const tg = link('share-tg', TG_ICON, 'Telegram');

  // Окно лежит поверх всего (top layer), общий тост под ним не виден — подтверждение показываем здесь же.
  const status = document.createElement('p');
  status.className = 'share-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  box.append(head, lead, area, pwWrap, actions, status, quick);
  dlg.appendChild(box);
  host.appendChild(dlg);

  let url = '';
  let line = PASSWORD_LATER;
  const syncLinks = () => {
    wa.href = whatsappLink(area.value);
    tg.href = telegramLink(url, area.value);
  };
  /** Меняем только строку пароля — правки человека в остальном тексте сохраняются. */
  const syncPassword = () => {
    const next = passwordLine(cb.checked ? pw.value : '');
    if (next === line) return;
    const old = `семейный пароль — ${line}`;
    if (area.value.includes(old)) area.value = area.value.replace(old, `семейный пароль — ${next}`);
    line = next;
    syncLinks();
  };
  area.addEventListener('input', syncLinks);
  cb.addEventListener('change', () => {
    pwField.hidden = !cb.checked;
    if (cb.checked) pw.focus();
    syncPassword();
  });
  pw.addEventListener('input', syncPassword);

  async function copyText(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(area.value);
      return true;
    } catch {
      area.focus();
      area.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
  }
  let statusTimer = 0;
  const copyLabel = copy.querySelector('span')!;
  const tell = (ok: boolean) => {
    const msg = ok ? 'Скопировано — вставьте в WhatsApp, Telegram или SMS' : 'Текст выделен — нажмите «Копировать» в меню телефона';
    status.textContent = msg;
    status.classList.toggle('ok', ok);
    status.classList.add('show');
    if (ok) copyLabel.textContent = 'Скопировано';
    opts.say(msg);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      status.classList.remove('show');
      copyLabel.textContent = 'Скопировать';
    }, 3000);
  };
  copy.addEventListener('click', async () => tell(await copyText()));
  send.addEventListener('click', async () => {
    const data = { title: 'Наше семейное дерево', text: area.value };
    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return; // человек передумал
      }
    }
    // Нет системного «Поделиться» (часто на компьютере) — копируем.
    tell(await copyText());
  });

  const wipe = () => {
    status.classList.remove('show');
    copyLabel.textContent = 'Скопировать';
    pw.value = '';
    cb.checked = false;
    pwField.hidden = true;
  };
  const shut = () => {
    wipe();
    area.value = ''; // пароль мог быть в тексте
    if (dlg.open) dlg.close();
  };
  close.addEventListener('click', shut);
  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    shut();
  });
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) shut();
  });

  return {
    open() {
      wipe();
      url = siteUrl();
      line = PASSWORD_LATER;
      area.value = inviteText(url, '', opts.name());
      syncLinks();
      dlg.showModal();
      area.scrollTop = 0;
      requestAnimationFrame(() => send.focus());
      void opts.password?.().then((v) => {
        if (!v || !dlg.open || cb.checked) return;
        cb.checked = true;
        pw.value = v;
        pwField.hidden = false;
        syncPassword();
      });
    },
    close: shut,
    isOpen: () => dlg.open,
  };
}
