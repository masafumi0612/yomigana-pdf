// Ctrl+P（Cmd+P）でルビ付きの印刷ができないとき（PDF を開いていない・暗号化・文字が画像など）に出す案内の窓。
// 理由を知らせ、標準の表示で開けばルビなしで印刷できることを知らせる。
// 窓は showModal で開き、焦点を窓の中に閉じこめる。Esc で閉じ、閉じたら開く前の場所へ焦点を戻す。
import { browser } from 'wxt/browser';

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

/** 印刷の案内の窓 */
export interface PrintNotice {
  /**
   * 案内の窓を開く。すでに開いているときは、文だけ入れかえる。
   * @param message ルビ付きで印刷できない理由
   */
  open(message: string): void;
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
 * @param options.onOpenNative 「標準の表示で開く」を押したときの動き
 * @param options.canOpenNative 「標準の表示で開く」を出すか（開く PDF がないときは出さない）
 * @returns 印刷の案内の窓
 */
export function createPrintNotice(options: {
  readonly onOpenNative: () => void;
  readonly canOpenNative: () => boolean;
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
  const hint = document.createElement('p');
  hint.className = 'print-text';
  hint.textContent = text('viewer_print_nativeHint');
  // ボタンの形は、バーの下の案内と同じものを使う
  const button = (name: MessageName): HTMLButtonElement => {
    const created = document.createElement('button');
    created.className = 'bar-button notice-button';
    created.type = 'button';
    created.textContent = text(name);
    return created;
  };
  const openNative = button('viewer_print_openNative');
  const close = button('viewer_print_close');
  const actions = document.createElement('div');
  actions.className = 'print-actions';
  actions.append(openNative, close);
  form.append(title, body, hint, actions);
  dialog.append(form);
  document.body.append(dialog);

  let opener: Element | undefined;

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
    open(message) {
      body.textContent = message;
      const isNativeShown = options.canOpenNative();
      openNative.hidden = !isNativeShown;
      hint.hidden = !isNativeShown;
      if (dialog.open) return;
      opener = document.activeElement ?? undefined;
      dialog.showModal();
      (isNativeShown ? openNative : close).focus();
    },
  };
}
