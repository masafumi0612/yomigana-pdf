// 設定の画面から、PDF をリーダーで開くときの URL を作る
import type { Result } from '@/result';

/** Web の PDF として開いてよい URL の種類 */
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/** リーダーに開く PDF の URL を渡す引数の名前。src/viewer/source.ts と合わせる */
const FILE_PARAM = 'file';

/** 入れた URL を開けない理由。空（empty）か、http・https の URL でない（invalid） */
export type WebPdfUrlError = 'empty' | 'invalid';

/**
 * 入れた文字を、Web の PDF の URL として読む。前後の空白は除く。
 * @param input 欄に入れた文字
 * @returns http・https の URL か、開けない理由
 */
export function parseWebPdfUrl(input: string): Result<URL, WebPdfUrlError> {
  const text = input.trim();
  if (text === '') {
    return { ok: false, error: 'empty' };
  }
  if (!URL.canParse(text)) {
    return { ok: false, error: 'invalid' };
  }
  const url = new URL(text);
  if (!WEB_PROTOCOLS.has(url.protocol) || url.hostname === '') {
    return { ok: false, error: 'invalid' };
  }
  return { ok: true, value: url };
}

/**
 * URL のサイトを読む権限を求めるときの、サイトの指定（match pattern）を作る。
 * @param url PDF の URL
 * @returns `https://example.com/*` の形。ポートは区別しない
 */
export function hostPatternOf(url: URL): string {
  return `${url.protocol}//${url.hostname}/*`;
}

/**
 * PDF をリーダーで開く URL を作る。
 * @param readerUrl リーダーの URL（`chrome-extension://<ID>/viewer.html`）
 * @param pdfUrl 開く PDF の URL
 * @returns `viewer.html?file=<URL>` の形の URL
 */
export function readerUrlFor(readerUrl: string, pdfUrl: string): string {
  return `${readerUrl}?${new URLSearchParams({ [FILE_PARAM]: pdfUrl }).toString()}`;
}

/**
 * 選んだファイルの blob: の URL に、ファイル名を付ける。
 * blob: の URL は名前を持たないので、リーダーは `#` の後ろをファイル名として出す（src/viewer/source.ts）。
 * @param blobUrl `URL.createObjectURL` で作った URL
 * @param fileName ファイル名
 * @returns `blob:…#<ファイル名>` の形の URL
 */
export function namedBlobUrl(blobUrl: string, fileName: string): string {
  return `${blobUrl}#${encodeURIComponent(fileName)}`;
}
