// ログはすべてここを通す（console を直接使ってよいのはこのファイルだけ）。
// PDF の本文や URL は、ログにも直近のエラーにも入れない。呼ぶ側は、決まった文と、エラーの名前・文だけを渡す

/** 残しておく直近のエラーの数。「報告用の情報をコピー」で貼る量を絞るため */
const MAX_RECENT_ERRORS = 20;

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
      const full = detail === undefined ? message : `${message}：${describeError(detail)}`;
      console.error(prefix, full);
      recentErrors.push({ time: new Date().toISOString(), scope, message: full });
      if (recentErrors.length > MAX_RECENT_ERRORS) {
        recentErrors.shift();
      }
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
 * 残した直近のエラーを消す。
 */
export function clearRecentErrors(): void {
  recentErrors.length = 0;
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
