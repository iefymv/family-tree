// Просмотр документа на весь экран: картинка — здесь же, PDF — в новой вкладке браузера.
export function createViewer(host: HTMLElement) {
  const dlg = document.createElement('dialog');
  dlg.className = 'viewer';
  dlg.setAttribute('aria-label', 'Просмотр документа');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-soft viewer-close';
  close.textContent = 'Закрыть';
  const fig = document.createElement('figure');
  const img = document.createElement('img');
  img.className = 'viewer-img';
  img.alt = '';
  const cap = document.createElement('figcaption');
  fig.append(img, cap);
  dlg.append(close, fig);
  host.appendChild(dlg);
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => img.removeAttribute('src'));

  return {
    /** onBroken — ссылка истекла или битая: вызывающий может выдать новую. */
    show(url: string, title: string, mime: string | null | undefined, onBroken?: () => void) {
      if (mime === 'application/pdf') {
        window.open(url, '_blank', 'noopener');
        return;
      }
      cap.textContent = title;
      img.alt = title;
      img.onerror = () => onBroken?.();
      img.src = url;
      if (!dlg.open) dlg.showModal();
    },
    close: () => dlg.open && dlg.close(),
  };
}
