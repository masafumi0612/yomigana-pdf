// ルビ付きの PDF ができたときの窓。［印刷］（見えない iframe から Chrome の印刷の画面）・［保存］（ダウンロードのフォルダ）・
// ［開く］（新しいタブの Chrome の標準の表示）と［閉じる］を置く。
// 窓は showModal で開き、Esc で閉じ、閉じたら決めた所（バーの「印刷・保存」）へ焦点を戻す。
import type { browser } from 'wxt/browser';

import { createLogger } from '@/log';

import type { PdfPrinter } from './pdf-print';
import { pageListText, type RubyPdfName } from './ruby-export-name';

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

const log = createLogger('viewer');

/** 文言を引く関数 */
export type MessageText = (name: MessageName, substitutions?: string | string[]) => string;

/** できたときの窓 */
export interface RubyExportDialog {
  /** 開いているなら true */
  readonly isOpen: boolean;
  /**
   * 窓を開く。
   * @param url 作った PDF の blob の URL
   * @param name ルビ付きの PDF の名前
   * @param failedPages ルビを付けずに作ったページ
   * @param alert 窓に出す知らせ（印刷を呼べなかったときなど）
   */
  open(url: string, name: RubyPdfName, failedPages: readonly number[], alert?: MessageName): void;
  /** ［印刷］を押したときと同じように、印刷の画面を出す */
  print(): void;
  /** 開いていれば閉じる */
  close(): void;
}

/**
 * ルビを付けずに作ったページを知らせる文を作る。
 * @param text 文言を引く関数
 * @param failedPages ルビを付けずに作ったページ（小さい順）
 * @returns 知らせる文。ページがなければ空の文字列
 */
export function failedPagesMessage(text: MessageText, failedPages: readonly number[]): string {
  if (failedPages.length === 0) return '';
  const pages = pageListText(failedPages);
  return pages.isTruncated
    ? text('viewer_export_failedPagesMany', [pages.list, String(failedPages.length)])
    : text('viewer_export_failedPages', pages.list);
}

/**
 * 要素を作る。
 * @param tag 要素の名前
 * @param className class
 * @param content 中の文字
 * @returns 作った要素
 */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content = '',
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = content;
  return created;
}

/**
 * できたときの窓を作り、画面に入れる。
 * @param text 文言を引く関数
 * @param printer PDF を印刷する道具
 * @param returnFocus 閉じたときに焦点を戻す所
 * @returns 窓
 */
export function createRubyExportDialog(
  text: MessageText,
  printer: PdfPrinter,
  returnFocus: HTMLElement,
): RubyExportDialog {
  const dialog = element('dialog', 'export-dialog');
  dialog.setAttribute('aria-labelledby', 'export-dialog-title');
  dialog.setAttribute('aria-describedby', 'export-dialog-text');
  const form = element('div', 'print-form');
  const title = element('h2', 'print-title', text('viewer_export_doneTitle'));
  title.id = 'export-dialog-title';
  const fileName = element('p', 'print-text export-name');
  const body = element('p', 'print-text', text('viewer_export_doneText'));
  body.id = 'export-dialog-text';
  const failed = element('p', 'print-text export-failed');
  const alert = element('p', 'print-text export-alert');
  alert.setAttribute('role', 'alert');
  // ボタンの形は、印刷の案内と同じものを使う
  const button = (name: MessageName, titleName: MessageName, className = ''): HTMLButtonElement => {
    const created = element('button', `bar-button notice-button ${className}`.trim(), text(name));
    created.type = 'button';
    created.title = text(titleName);
    return created;
  };
  const printButton = button('viewer_export_print', 'viewer_export_printTitle', 'export-primary');
  const save = button('viewer_export_save', 'viewer_export_saveTitle');
  const open = button('viewer_export_open', 'viewer_export_openTitle');
  const closeButton = element(
    'button',
    'bar-button notice-button',
    text('viewer_export_dialogClose'),
  );
  closeButton.type = 'button';
  const actions = element('div', 'print-actions');
  actions.append(printButton, save, open, closeButton);
  form.append(title, fileName, body, failed, alert, actions);
  dialog.append(form);
  document.body.append(dialog);

  let current: { url: string; name: RubyPdfName } | undefined;
  const showAlert = (name: MessageName | undefined): void => {
    alert.textContent = name === undefined ? '' : text(name);
    alert.hidden = name === undefined;
  };
  const print = (): void => {
    if (current === undefined) return;
    showAlert(undefined);
    printer
      .print(current.url)
      .then((isPrinted) => {
        // 印刷を呼べなかったときは、新しいタブに開いて印刷してもらう
        if (isPrinted || !dialog.open) return;
        showAlert('viewer_export_printFailed');
        open.focus();
      })
      .catch((error: unknown) => {
        log.error('印刷の画面を出す途中で予想外の失敗がありました', error);
      });
  };

  printButton.addEventListener('click', print);
  save.addEventListener('click', () => {
    if (current === undefined) return;
    const link = document.createElement('a');
    link.href = current.url;
    link.download = current.name.fileName;
    link.click();
  });
  open.addEventListener('click', () => {
    if (current === undefined) return;
    // 開いた先は自分で作った PDF を Chrome の標準の表示で出すだけなので、noopener は付けない
    //（付けると、ポップアップを止められたかが分からない）。止められたときは、押し直してもらう
    showAlert(
      window.open(current.url, '_blank') === null ? 'viewer_export_popupBlocked' : undefined,
    );
  });
  closeButton.addEventListener('click', () => {
    dialog.close();
  });
  // Esc は窓を閉じるだけにして、後ろの向きを直すモードなどまで閉じないよう、外へ伝えない
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  dialog.addEventListener('close', () => {
    current = undefined;
    if (returnFocus.isConnected) returnFocus.focus();
  });

  return {
    get isOpen() {
      return dialog.open;
    },
    open(url, name, failedPages, alertName) {
      current = { url, name };
      fileName.textContent = name.fileName;
      failed.textContent = failedPagesMessage(text, failedPages);
      failed.hidden = failedPages.length === 0;
      showAlert(alertName);
      if (!dialog.open) dialog.showModal();
      (alertName === undefined ? printButton : open).focus();
    },
    print,
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
