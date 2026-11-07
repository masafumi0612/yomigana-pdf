// ルビ付きの PDF を作る画面の流れ。バーの「印刷・保存」と Ctrl+P（Cmd+P）から始め、バーの下に進み具合と［止める］を出す。
// 「印刷・保存」は、できたら窓（ruby-export-dialog.ts）で［印刷］［保存］［開く］を選んでもらう。
// Ctrl+P は、できたらそのまま印刷の画面を出す（呼べなければ窓を出して［開く］へ案内する）。作れないときは印刷の案内の窓に回す。
// 作っている間に向き・読み・設定が変わったら、途中のものを捨てて初めから作り直す（ページごとに設定が混ざらないように）。
// 作った PDF の blob の URL は、開いたタブ・印刷が読んでいる間に消さないよう、窓を閉じても持っておき、
// 次の PDF ができたときと別の PDF を開いたときに捨てる（リーダーのタブを閉じたときは Chrome が捨てる）。
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import type { Result } from '@/result';

import { createPdfPrinter } from './pdf-print';
import { exportRubyPdf, type RubyExport, type RubyExportOptions } from './ruby-export';
import { createRubyExportDialog, failedPagesMessage, type MessageText } from './ruby-export-dialog';
import { type RubyPdfName, rubyPdfName } from './ruby-export-name';

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

/** 作れなかった理由のうち、案内を出すもの。failed は思いがけない失敗、imageOnly は文字が画像の PDF */
type ShownError = 'encrypted' | 'unreadable' | 'failed' | 'imageOnly';

/** 進み具合を読み上げる回数（全体を何回に分けて知らせるか）。毎ページ読み上げるとうるさいため */
const ANNOUNCE_STEPS = 10;

const ERROR_MESSAGES: Record<ShownError, MessageName> = {
  encrypted: 'viewer_export_encrypted',
  unreadable: 'viewer_export_unreadable',
  failed: 'viewer_export_failed',
  imageOnly: 'viewer_export_imageOnly',
};

const log = createLogger('viewer');

/** 画面の流れの作り方 */
export interface RubyExportUiOptions {
  /** バーの「印刷・保存」のボタン */
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
  /**
   * Ctrl+P から始めて、ルビ付きで印刷できないときに、印刷の案内の窓を出す
   * @param message 印刷できない理由
   */
  readonly showPrintNotice: (message: string) => void;
}

/** ルビ付きの PDF を作る画面の流れ */
export interface RubyExportUi {
  /** 「印刷・保存」から作り始める。作っている間・PDF を開いていないときは何もしない */
  start(): void;
  /**
   * Ctrl+P から作り始め、できたら印刷の画面を出す。窓が開いていれば、窓の［印刷］と同じことをする。
   * 作っている途中なら、できたときに印刷する
   */
  print(): void;
  /** 置き場所が変わるかもしれないときに呼ぶ。作っている途中なら、初めから作り直す */
  handleLayoutChange(): void;
  /** 別の PDF を開くときに呼ぶ。作っている途中なら止め、案内・窓を閉じ、作った PDF を捨てる */
  reset(): void;
}

/**
 * ルビ付きの PDF を作る画面の流れを作る。
 * @param options 作り方
 * @returns 画面の流れ
 */
export function createRubyExportUi(options: RubyExportUiOptions): RubyExportUi {
  const { button, notice, noticeText, live, stop, close } = options;
  const text: MessageText = (name, substitutions) => browser.i18n.getMessage(name, substitutions);
  const printer = createPdfPrinter();
  const dialog = createRubyExportDialog(text, printer, button);
  /** 作っている途中のもの。止める・作り直すときは、これを入れかえて、古い結果を捨てる */
  let running: AbortController | undefined;
  /** できたら、窓を出さずに印刷の画面を出すなら true（Ctrl+P から始めたとき） */
  let isPrintWanted = false;
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
  const showError = (error: ShownError): void => {
    if (isPrintWanted) {
      hideNotice();
      options.showPrintNotice(text(ERROR_MESSAGES[error]));
    } else {
      showMessage(text(ERROR_MESSAGES[error]));
    }
  };
  const finish = (): void => {
    running = undefined;
    button.disabled = false;
  };
  const revoke = (): void => {
    if (madeUrl !== undefined) URL.revokeObjectURL(madeUrl);
    madeUrl = undefined;
  };

  const printMade = async (url: string, made: RubyExport, name: RubyPdfName): Promise<void> => {
    const isPrinted = await printer.print(url);
    if (madeUrl !== url) return;
    if (!isPrinted) {
      // 印刷を呼べなかったときは、窓を出して、新しいタブに開いて印刷してもらう
      dialog.open(url, name, made.failedPages, 'viewer_export_printFailed');
    } else if (made.failedPages.length > 0) {
      showMessage(failedPagesMessage(text, made.failedPages));
    }
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
      log.error('ルビ付きの PDF を作る途中で予想外の失敗がありました', error);
      result = { ok: false, error: 'failed' };
    }
    // 止めた・作り直した・別の PDF に移ったときは、古い結果を出さない
    if (running !== controller) return;
    finish();
    const isPrinting = isPrintWanted;
    if (!result.ok) {
      if (result.error === 'aborted') hideNotice();
      else showError(result.error);
      isPrintWanted = false;
      return;
    }
    isPrintWanted = false;
    hideNotice();
    live.textContent = '';
    revoke();
    printer.dispose();
    // pdf-lib の結果は ArrayBuffer の上にあるが、型は SharedArrayBuffer も含むので写して渡す
    const blob = new Blob([result.value.bytes.slice()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    madeUrl = url;
    if (isPrinting) await printMade(url, result.value, name);
    else dialog.open(url, name, result.value.failedPages);
  };
  const begin = (isRestart: boolean): void => {
    run(isRestart).catch((error: unknown) => {
      log.error('ルビ付きの PDF を作る画面の途中で予想外の失敗がありました', error);
    });
  };
  const startOrRefuse = (): void => {
    if (options.isImageOnly()) {
      showError('imageOnly');
      isPrintWanted = false;
      return;
    }
    begin(false);
  };

  stop.addEventListener('click', () => {
    running?.abort();
    isPrintWanted = false;
    finish();
    hideNotice();
    live.textContent = '';
  });
  close.addEventListener('click', hideNotice);

  return {
    start() {
      if (running !== undefined || options.getDocument() === undefined) return;
      isPrintWanted = false;
      startOrRefuse();
    },
    print() {
      if (dialog.isOpen) {
        dialog.print();
        return;
      }
      isPrintWanted = true;
      if (running !== undefined) return;
      if (options.getDocument() === undefined) {
        isPrintWanted = false;
        options.showPrintNotice(text('viewer_print_noDocument'));
        return;
      }
      startOrRefuse();
    },
    handleLayoutChange() {
      if (running === undefined) return;
      running.abort();
      begin(true);
    },
    reset() {
      running?.abort();
      isPrintWanted = false;
      finish();
      hideNotice();
      live.textContent = '';
      dialog.close();
      printer.dispose();
      revoke();
    },
  };
}
