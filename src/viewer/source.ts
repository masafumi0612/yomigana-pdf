/** リーダーの URL で、開く PDF の URL を渡す引数の名前（`viewer.html?file=<URL>`） */
const FILE_PARAM = 'file';

/** 自動で移されたときに元の URL を渡す印（`viewer.html?DNR:<URL>`）。移す側のルールと合わせる */
const REDIRECTED_PREFIX = '?DNR:';

/** リーダーが読みに行ってよい URL の種類。ほかの種類（javascript: や data: など）は開かない */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

/** URL の引数を読み取った結果 */
export type ViewerParamsResult =
  | { ok: true; value: { pdfUrl: string | undefined; hasCredentials: boolean } }
  | { ok: false; error: 'invalid-url' | 'unsupported-protocol' };

/**
 * リーダーの URL の引数から、開く PDF の URL を読み取る。
 *
 * @param search - リーダーの URL の `?` から後ろ（`location.search`）
 * @param extensionOrigin - この拡張の起点（`chrome-extension://<ID>`）。拡張の中の PDF は開いてよい
 * @returns 開く URL。引数がなければ `pdfUrl` は undefined。読めない・開いてはいけない URL は失敗。
 *   自動で移されたとき（`?DNR:`）は、ログイン中の PDF も取り直せるよう `hasCredentials` が true
 */
export function readViewerParams(search: string, extensionOrigin: string): ViewerParamsResult {
  const isRedirected = search.startsWith(REDIRECTED_PREFIX);
  // 移されたときの URL は符号化されていないので、そのまま後ろを読む
  const raw = isRedirected
    ? search.slice(REDIRECTED_PREFIX.length)
    : new URLSearchParams(search).get(FILE_PARAM);
  if (raw === null || raw === '') {
    return { ok: true, value: { pdfUrl: undefined, hasCredentials: false } };
  }
  if (!URL.canParse(raw)) {
    return { ok: false, error: 'invalid-url' };
  }
  const url = new URL(raw);
  // chrome-extension: は標準の種類でないので、環境によっては origin が "null" になる。自分で組み立てる
  const isOwnExtension = `${url.protocol}//${url.host}` === extensionOrigin;
  if (!ALLOWED_PROTOCOLS.has(url.protocol) && !isOwnExtension) {
    return { ok: false, error: 'unsupported-protocol' };
  }
  return { ok: true, value: { pdfUrl: url.href, hasCredentials: isRedirected } };
}

/**
 * 開くときにページ・倍率などを決める、URL の `#` から後ろを取り出す。
 *
 * @param pdfUrl - 開く PDF の URL
 * @param hasCredentials - 自動で移されて開くとき true。このとき元の URL の `#` から後ろは、リーダーの URL に残っている
 * @param viewerHash - リーダーの URL の `#` から後ろ（`location.hash`、`#` つき）
 * @returns `#` を除いた文字。なければ空の文字列
 */
export function readInitialHash(
  pdfUrl: string,
  hasCredentials: boolean,
  viewerHash: string,
): string {
  const hash = hasCredentials ? viewerHash : new URL(pdfUrl).hash;
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

/**
 * PDF の URL から、バーに出すファイル名を取り出す。
 *
 * @param url - PDF の URL
 * @returns パスの最後の部分（`%` の符号は戻す）。取り出せなければ URL のホスト名か URL そのもの
 */
export function fileNameFromUrl(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  const { pathname, hostname } = new URL(url);
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (last === '') {
    return hostname === '' ? url : hostname;
  }
  try {
    return decodeURIComponent(last);
  } catch {
    // 壊れた % の並びは、戻さずにそのまま見せる
    return last;
  }
}

/** PDF かどうかを見分けるのに使う、ファイルの情報 */
export interface FileLike {
  /** ファイル名 */
  name: string;
  /** MIME の種類。わからないときは空の文字列 */
  type: string;
}

/**
 * 選ばれた・ドラッグされたファイルが PDF かを調べる。
 *
 * @param file - ファイルの名前と種類
 * @returns 種類が PDF か、名前が `.pdf` で終わるなら true（OS によっては種類が付かないため）
 */
export function isPdfFile(file: FileLike): boolean {
  return file.type === 'application/pdf' || /\.pdf$/iu.test(file.name);
}
