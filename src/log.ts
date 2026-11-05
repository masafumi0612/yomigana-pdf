// ログはすべてここを通す（console を直接使ってよいのはこのファイルだけ）。
// PDF の本文や URL は、ログにも直近のエラーにも入れない。呼ぶ側は、決まった文と、エラーの名前・文だけを渡す。
// エラーの文に URL が混じっていても（pdf.js のエラーなど）、残す前に消す
import { browser } from 'wxt/browser';

/** 残しておく直近のエラーの数。「報告用の情報をコピー」で貼る量を絞るため */
const MAX_RECENT_ERRORS = 20;

/** 部品をまたいで直近のエラーを残す、storage.local のキー */
const RECENT_ERRORS_KEY = 'recentErrors';

/** URL（`https://…` や `blob:`・`data:`・`file:` など）。エラーの文から消す */
const URL_PATTERN = /\b(?:[a-z][\d+.a-z-]*:\/\/|(?:blob|data|file|javascript):)\S*/giu;

/** URL を消したところに入れる印 */
const URL_MARK = '（URL）';

/** 残しておく1件のエラー */
export interface ErrorRecord {
  /** 起きた時刻（ISO 8601） */
  readonly time: string;
  /** どの部品で起きたか（例：offscreen） */
  readonly scope: string;
  /** 何が起きたか。detail を渡したときは、その名前と文を後ろに付ける */
  readonly message: string;
}

/** 部品ごとのログの出し口 */
export interface Logger {
  /**
   * 開発のときだけ出す。公開するビルドでは出さない。
   * @param message 決まった文（PDF の本文を入れない）
   */
  debug(message: string): void;
  /**
   * 知らせておきたいことを出す。
   * @param message 決まった文（PDF の本文を入れない）
   */
  info(message: string): void;
  /**
   * 気になるが、動き続けられることを出す。
   * @param message 決まった文（PDF の本文を入れない）
   */
  warn(message: string): void;
  /**
   * エラーを出し、直近のエラーとして残す。
   * @param message 決まった文（PDF の本文を入れない）
   * @param detail 起きたエラー。名前と文だけを使う
   */
  error(message: string, detail?: unknown): void;
}

/** ロガーの作り方 */
export interface LoggerOptions {
  /** debug を出すなら true。既定は開発のビルドのときだけ true */
  readonly isDebugEnabled?: boolean;
}

const recentErrors: ErrorRecord[] = [];

/** 続けて出たエラーの書き込みが重ならないよう、順に動かすための鎖 */
let storeQueue: Promise<unknown> = Promise.resolve();

/**
 * 部品ごとのロガーを作る。
 * @param scope どの部品のログか（例：offscreen）。ログの頭に付ける
 * @param options 作り方
 * @returns ロガー
 */
export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
  const isDebugEnabled = options.isDebugEnabled ?? import.meta.env.DEV;
  const prefix = `[yomigana-pdf:${scope}]`;
  return {
    debug(message) {
      if (isDebugEnabled) {
        console.debug(prefix, message);
      }
    },
    info(message) {
      console.info(prefix, message);
    },
    warn(message) {
      console.warn(prefix, message);
    },
    error(message, detail) {
      const full = stripUrls(
        detail === undefined ? message : `${message}：${describeError(detail)}`,
      );
      console.error(prefix, full);
      const record = { time: new Date().toISOString(), scope, message: full };
      recentErrors.push(record);
      if (recentErrors.length > MAX_RECENT_ERRORS) {
        recentErrors.shift();
      }
      storeError(record, prefix);
    },
  };
}

/**
 * この部品（ページ・Worker）で残した直近のエラーを返す（古い順、最大 20 件）。
 * @returns 直近のエラーの写し
 */
export function getRecentErrors(): readonly ErrorRecord[] {
  return [...recentErrors];
}

/**
 * どの部品（画面・background）で残したものも合わせた、直近のエラーを読む（古い順、最大 20 件）。
 * offscreen document と Worker には storage がないので、そこで出たエラーは入らない。
 * @returns 直近のエラー。storage が使えないときは、この部品で残したものだけ
 */
export async function getStoredErrors(): Promise<readonly ErrorRecord[]> {
  const area = localArea();
  if (area === undefined) {
    return getRecentErrors();
  }
  const stored = await area.get(RECENT_ERRORS_KEY);
  return parseErrorRecords(stored[RECENT_ERRORS_KEY]);
}

/**
 * 文の中の URL を印に置きかえる。
 * @param text もとの文
 * @returns URL を「（URL）」にした文
 */
export function stripUrls(text: string): string {
  return text.replaceAll(URL_PATTERN, URL_MARK);
}

/**
 * 残した直近のエラーを消す。
 */
export function clearRecentErrors(): void {
  recentErrors.length = 0;
}

/**
 * エラーを storage.local にも足す。古いものから捨てて、上限の数だけ残す。
 * 残せなくても、ログのほかの動きは止めない（ここで error を出すと繰り返すので warn だけ）。
 * @param record 足すエラー
 * @param prefix ログの頭に付ける部品の名前
 */
function storeError(record: ErrorRecord, prefix: string): void {
  const area = localArea();
  if (area === undefined) {
    return;
  }
  storeQueue = storeQueue
    .then(async () => {
      const stored = await area.get(RECENT_ERRORS_KEY);
      const records = [...parseErrorRecords(stored[RECENT_ERRORS_KEY]), record];
      await area.set({ [RECENT_ERRORS_KEY]: records.slice(-MAX_RECENT_ERRORS) });
    })
    .catch((error: unknown) => {
      console.warn(prefix, `直近のエラーを残せませんでした：${describeError(error)}`);
    });
}

/**
 * 直近のエラーを残せる storage.local を取り出す。
 * @returns storage.local。offscreen document と Worker では storage がないので undefined
 */
function localArea(): typeof browser.storage.local | undefined {
  // Worker では拡張の API そのものがなく、offscreen document には storage がない
  const api = browser as Partial<typeof browser> | undefined;
  return api?.storage?.local;
}

/**
 * 保存してある値から、形の合うエラーだけを取り出す。
 * @param value storage.local の値
 * @returns 形の合うエラー（古い順）
 */
function parseErrorRecords(value: unknown): ErrorRecord[] {
  return Array.isArray(value) ? value.filter(isErrorRecord) : [];
}

/**
 * 残しておく1件のエラーの形かを調べる。
 * @param item 調べる値
 * @returns 時刻・部品・文がどれも文字列なら true
 */
function isErrorRecord(item: unknown): item is ErrorRecord {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const { time, scope, message } = item as Partial<Record<keyof ErrorRecord, unknown>>;
  return typeof time === 'string' && typeof scope === 'string' && typeof message === 'string';
}

/**
 * エラーを短い文にする。エラーの中身（スタックや、エラーに付いたデータ）は入れない。
 * @param detail 起きたエラー
 * @returns エラーの名前と文。Error でなければ、その種類だけ
 */
function describeError(detail: unknown): string {
  if (detail instanceof Error) {
    return `${detail.name}: ${detail.message}`;
  }
  return typeof detail === 'string' ? detail : `（${typeof detail}）`;
}
