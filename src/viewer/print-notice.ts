// 印刷しようとしたときに出す案内の窓。リーダーの印刷は紙面の見えている範囲しか出せないので、
// ブラウザーの印刷は止めて、ルビ付き PDF を作って開けば印刷できることを知らせ、窓からも作り始められるようにする。
// 窓は showModal で開き、焦点を窓の中に閉じこめる。Esc で閉じ、閉じたら開く前の場所へ焦点を戻す。
import { browser } from 'wxt/browser';

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

/** 印刷の案内の窓 */
export interface PrintNotice {
  /** 案内の窓を開く。すでに開いているときは何もしない */
  open(): void;
}

/** 印刷の操作かどうかを調べるのに使う、キーの押下の情報 */
export type PrintShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>;

/**
 * 印刷の操作（Ctrl+P・Mac は Cmd+P）かどうかを返す。Shift や Alt が付いた押し方は対象にしない。
 * @param event キーの押下の情報
 * @returns 印刷の操作なら true
 */
export function isPrintShortcut(event: PrintShortcutEvent): boolean {
  if (event.key.toLowerCase() !== 'p') return false;
  if (event.shiftKey || event.altKey) return false;
  return event.ctrlKey !== event.metaKey;
}

/**
 * 印刷の案内の窓を作り、画面に入れる。
 * @param options 窓の設定
 * @param options.onExport 「印刷・保存」を押したときの動き
 * @param options.canExport 「印刷・保存」を出すか（PDF を開いていないときは出さない）
 * @param options.onOpenNative 「標準の表示で開く」を押したときの動き
 * @returns 印刷の案内の窓
 */
export function createPrintNotice(options: {
  readonly onExport: () => void;
  readonly canExport: () => boolean;
  readonly onOpenNative: () => void;
}): PrintNotice {
  const text = (name: MessageName): string => browser.i18n.getMessage(name);

  const dialog = document.createElement('dialog');
  dialog.className = 'print-dialog';
  dialog.setAttribute('aria-labelledby', 'print-dialog-title');
  dialog.setAttribute('aria-describedby', 'print-dialog-text');
  const form = document.createElement('div');
  form.className = 'print-form';
  const title = document.createElement('h2');
  title.id = 'print-dialog-title';
  title.className = 'print-title';
  title.textContent = text('viewer_print_title');
  const body = document.createElement('p');
  body.id = 'print-dialog-text';
  body.className = 'print-text';
  body.textContent = text('viewer_print_notice');
  // ボタンの形は、バーの下の案内と同じものを使う
  const button = (name: MessageName): HTMLButtonElement => {
    const created = document.createElement('button');
    created.className = 'bar-button notice-button';
    created.type = 'button';
    created.textContent = text(name);
    return created;
  };
  const exportButton = button('viewer_print_export');
  exportButton.classList.add('export-primary');
  const openNative = button('viewer_print_openNative');
  const close = button('viewer_print_close');
  const actions = document.createElement('div');
  actions.className = 'print-actions';
  actions.append(exportButton, openNative, close);
  form.append(title, body, actions);
  dialog.append(form);
  document.body.append(dialog);

  let opener: Element | undefined;

  exportButton.addEventListener('click', () => {
    dialog.close();
    options.onExport();
  });
  openNative.addEventListener('click', () => {
    dialog.close();
    options.onOpenNative();
  });
  close.addEventListener('click', () => {
    dialog.close();
  });
  // Esc は窓を閉じるだけにして、後ろの向きを直すモードなどまで閉じないよう、外へ伝えない
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  dialog.addEventListener('close', () => {
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    opener = undefined;
  });

  return {
    open() {
      if (dialog.open) return;
      opener = document.activeElement ?? undefined;
      exportButton.hidden = !options.canExport();
      dialog.showModal();
      (exportButton.hidden ? openNative : exportButton).focus();
    },
  };
}
