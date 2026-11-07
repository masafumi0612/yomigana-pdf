// ルビ付き PDF を作る画面の流れ。バーのボタン（と印刷の案内）から始め、バーの下に進み具合と［止める］を出し、
// できたら窓で［開く］（新しいタブの Chrome の標準の表示）と［保存］（ダウンロードのフォルダ）を選んでもらう。
// 作っている間に向き・読み・設定が変わったら、途中のものを捨てて初めから作り直す（ページごとに設定が混ざらないように）。
// 作った PDF の blob の URL は、開いたタブが読んでいる間に消さないよう、窓を閉じても持っておき、
// 次の PDF ができたときと別の PDF を開いたときに捨てる（リーダーのタブを閉じたときは Chrome が捨てる）。
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import type { Result } from '@/result';

import { exportRubyPdf, type RubyExport, type RubyExportOptions } from './ruby-export';
import { pageListText, type RubyPdfName, rubyPdfName } from './ruby-export-name';

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

/** 作れなかった理由のうち、案内を出すもの。failed は思いがけない失敗 */
type ShownError = 'encrypted' | 'unreadable' | 'failed';

/** 進み具合を読み上げる回数（全体を何回に分けて知らせるか）。毎ページ読み上げるとうるさいため */
const ANNOUNCE_STEPS = 10;

const ERROR_MESSAGES: Record<ShownError, MessageName> = {
  encrypted: 'viewer_export_encrypted',
  unreadable: 'viewer_export_unreadable',
  failed: 'viewer_export_failed',
};

const log = createLogger('viewer');

/** 画面の流れの作り方 */
export interface RubyExportUiOptions {
  /** バーの「ルビ付き PDF」のボタン */
  readonly button: HTMLButtonElement;
  /** バーの下の進み具合・案内 */
  readonly notice: HTMLElement;
  /** 進み具合・案内の文 */
  readonly noticeText: HTMLElement;
  /** 読み上げに伝える所（aria-live） */
  readonly live: HTMLElement;
  /** ［止める］ */
  readonly stop: HTMLButtonElement;
  /** 案内を閉じるボタン */
  readonly close: HTMLButtonElement;
  /**
   * 開いている PDF を引く
   * @returns PDF。開いていなければ undefined
   */
  readonly getDocument: () => RubyExportOptions['document'] | undefined;
  /** ページのルビの置き場所を出す部品 */
  readonly layouts: RubyExportOptions['layouts'];
  /**
   * もとの PDF の名前を引く
   * @returns 名前。分からなければ undefined
   */
  readonly sourceName: () => string | undefined;
  /**
   * 文字が画像になっていて、ルビを付けられない PDF かを調べる
   * @returns ルビを付けられないなら true
   */
  readonly isImageOnly: () => boolean;
}

/** ルビ付き PDF を作る画面の流れ */
export interface RubyExportUi {
  /** 作り始める。作っている間・PDF を開いていないときは何もしない */
  start(): void;
  /** 置き場所が変わるかもしれないときに呼ぶ。作っている途中なら、初めから作り直す */
  handleLayoutChange(): void;
  /** 別の PDF を開くときに呼ぶ。作っている途中なら止め、案内・窓を閉じ、作った PDF を捨てる */
  reset(): void;
}

/** できたときの窓 */
interface DoneDialog {
  /**
   * 窓を開く。
   * @param url 作った PDF の blob の URL
   * @param name ルビ付き PDF の名前
   * @param failedPages ルビを付けずに作ったページ
   */
  open(url: string, name: RubyPdfName, failedPages: readonly number[]): void;
  /** 開いていれば閉じる */
  close(): void;
}

/**
 * ルビ付き PDF を作る画面の流れを作る。
 * @param options 作り方
 * @returns 画面の流れ
 */
export function createRubyExportUi(options: RubyExportUiOptions): RubyExportUi {
  const { button, notice, noticeText, live, stop, close } = options;
  const text = (name: MessageName, substitutions?: string | string[]): string =>
    browser.i18n.getMessage(name, substitutions);
  const dialog = createDoneDialog(text, button);
  /** 作っている途中のもの。止める・作り直すときは、これを入れかえて、古い結果を捨てる */
  let running: AbortController | undefined;
  let madeUrl: string | undefined;

  const showNotice = (message: string, isRunning: boolean): void => {
    const focused = document.activeElement;
    noticeText.textContent = message;
    stop.hidden = !isRunning;
    close.hidden = isRunning;
    notice.hidden = false;
    // 焦点のあるボタンが隠れるときは、代わりに出るボタンへ移す
    if ((focused === stop && !isRunning) || (focused === close && isRunning)) {
      (isRunning ? stop : close).focus();
    }
  };
  const hideNotice = (): void => {
    const hasFocus = notice.contains(document.activeElement);
    notice.hidden = true;
    noticeText.textContent = '';
    if (hasFocus) button.focus();
  };
  const showMessage = (message: string): void => {
    showNotice(message, false);
    live.textContent = message;
  };
  const finish = (): void => {
    running = undefined;
    button.disabled = false;
  };
  const revoke = (): void => {
    if (madeUrl !== undefined) URL.revokeObjectURL(madeUrl);
    madeUrl = undefined;
  };

  const run = async (isRestart: boolean): Promise<void> => {
    const pdf = options.getDocument();
    if (pdf === undefined) return;
    const controller = new AbortController();
    running = controller;
    const isFocused = document.activeElement === button;
    button.disabled = true;
    const total = pdf.numPages;
    let announced = -1;
    const progress = (done: number): void => {
      if (running !== controller) return;
      const message = text(isRestart ? 'viewer_export_restarting' : 'viewer_export_progress', [
        String(done),
        String(total),
      ]);
      showNotice(message, true);
      const step = Math.floor((done / Math.max(total, 1)) * ANNOUNCE_STEPS);
      if (step !== announced) {
        announced = step;
        live.textContent = message;
      }
    };
    progress(0);
    if (isFocused) stop.focus();
    const name = rubyPdfName(options.sourceName(), {
      withName: (base) => text('viewer_export_nameWith', base),
      fallback: text('viewer_export_nameFallback'),
    });
    let result: Result<RubyExport, ShownError | 'aborted'>;
    try {
      result = await exportRubyPdf({
        document: pdf,
        layouts: options.layouts,
        signal: controller.signal,
        title: name.title,
        onProgress: progress,
      });
    } catch (error) {
      log.error('ルビ付き PDF を作る途中で予想外の失敗がありました', error);
      result = { ok: false, error: 'failed' };
    }
    // 止めた・作り直した・別の PDF に移ったときは、古い結果を出さない
    if (running !== controller) return;
    finish();
    if (!result.ok) {
      if (result.error === 'aborted') hideNotice();
      else showMessage(text(ERROR_MESSAGES[result.error]));
      return;
    }
    hideNotice();
    live.textContent = '';
    revoke();
    // pdf-lib の結果は ArrayBuffer の上にあるが、型は SharedArrayBuffer も含むので写して渡す
    const blob = new Blob([result.value.bytes.slice()], { type: 'application/pdf' });
    madeUrl = URL.createObjectURL(blob);
    dialog.open(madeUrl, name, result.value.failedPages);
  };
  const begin = (isRestart: boolean): void => {
    run(isRestart).catch((error: unknown) => {
      log.error('ルビ付き PDF を作る画面の途中で予想外の失敗がありました', error);
    });
  };

  stop.addEventListener('click', () => {
    running?.abort();
    finish();
    hideNotice();
    live.textContent = '';
  });
  close.addEventListener('click', hideNotice);

  return {
    start() {
      if (running !== undefined || options.getDocument() === undefined) return;
      if (options.isImageOnly()) {
        showMessage(text('viewer_export_imageOnly'));
        return;
      }
      begin(false);
    },
    handleLayoutChange() {
      if (running === undefined) return;
      running.abort();
      begin(true);
    },
    reset() {
      running?.abort();
      finish();
      hideNotice();
      live.textContent = '';
      dialog.close();
      revoke();
    },
  };
}

/**
 * できたときの窓を作り、画面に入れる。窓は showModal で開き、Esc で閉じ、閉じたら「ルビ付き PDF」のボタンへ焦点を戻す。
 * @param text 文言を引く関数
 * @param returnFocus 閉じたときに焦点を戻す所
 * @returns 窓
 */
function createDoneDialog(
  text: (name: MessageName, substitutions?: string | string[]) => string,
  returnFocus: HTMLElement,
): DoneDialog {
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    content = '',
  ): HTMLElementTagNameMap[K] => {
    const created = document.createElement(tag);
    created.className = className;
    created.textContent = content;
    return created;
  };
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
  const blocked = element('p', 'print-text export-blocked', text('viewer_export_popupBlocked'));
  blocked.setAttribute('role', 'alert');
  // ボタンの形は、印刷の案内と同じものを使う
  const button = (name: MessageName, className = ''): HTMLButtonElement => {
    const created = element('button', `bar-button notice-button ${className}`.trim(), text(name));
    created.type = 'button';
    return created;
  };
  const open = button('viewer_export_open', 'export-primary');
  open.title = text('viewer_export_openTitle');
  const save = button('viewer_export_save');
  save.title = text('viewer_export_saveTitle');
  const closeButton = button('viewer_export_dialogClose');
  const actions = element('div', 'print-actions');
  actions.append(open, save, closeButton);
  form.append(title, fileName, body, failed, blocked, actions);
  dialog.append(form);
  document.body.append(dialog);

  let current: { url: string; name: RubyPdfName } | undefined;

  open.addEventListener('click', () => {
    if (current === undefined) return;
    // 開いた先は自分で作った PDF を Chrome の標準の表示で出すだけなので、noopener は付けない
    //（付けると、ポップアップを止められたかが分からない）。止められたときは、押し直してもらう
    blocked.hidden = window.open(current.url, '_blank') !== null;
  });
  save.addEventListener('click', () => {
    if (current === undefined) return;
    const link = document.createElement('a');
    link.href = current.url;
    link.download = current.name.fileName;
    link.click();
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
    open(url, name, failedPages) {
      current = { url, name };
      fileName.textContent = name.fileName;
      const pages = pageListText(failedPages);
      failed.textContent =
        failedPages.length === 0
          ? ''
          : pages.isTruncated
            ? text('viewer_export_failedPagesMany', [pages.list, String(failedPages.length)])
            : text('viewer_export_failedPages', pages.list);
      failed.hidden = failedPages.length === 0;
      blocked.hidden = true;
      if (!dialog.open) dialog.showModal();
      open.focus();
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
