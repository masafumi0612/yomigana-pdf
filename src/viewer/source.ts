/** リーダーの URL で、開く PDF の URL を渡す引数の名前（`viewer.html?file=<URL>`） */
const FILE_PARAM = 'file';

/** 自動で移されたときに元の URL を渡す印（`viewer.html?DNR:<URL>`）。移す側のルールと合わせる */
const REDIRECTED_PREFIX = '?DNR:';

/** リーダーが読みに行ってよい URL の種類。ほかの種類（javascript: や data: など）は開かない */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

/** 設定の画面で選んだファイルを渡す URL の種類。名前を持たないので、渡す側が `#` の後ろにファイル名を付ける */
const BLOB_PROTOCOL = 'blob:';

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
  // blob: の URL は、後ろに作った側の URL を持つ。この拡張の画面が作ったものだけ開く
  const owner =
    url.protocol === BLOB_PROTOCOL && URL.canParse(url.pathname) ? new URL(url.pathname) : url;
  // chrome-extension: は標準の種類でないので、環境によっては origin が "null" になる。自分で組み立てる
  const isOwnExtension = `${owner.protocol}//${owner.host}` === extensionOrigin;
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
  const url = new URL(pdfUrl);
  // blob: の URL の `#` から後ろは、ページの指定ではなくファイル名
  if (!hasCredentials && url.protocol === BLOB_PROTOCOL) {
    return '';
  }
  const hash = hasCredentials ? viewerHash : url.hash;
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

/**
 * PDF の URL から、バーに出すファイル名を取り出す。
 *
 * @param url - PDF の URL
 * @returns パスの最後の部分（`%` の符号は戻す）。blob: の URL は `#` の後ろ。
 *   取り出せなければ URL のホスト名か URL そのもの
 */
export function fileNameFromUrl(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  const { pathname, hostname, protocol, hash } = new URL(url);
  if (protocol === BLOB_PROTOCOL && hash.length > 1) {
    return decodeOrKeep(hash.slice(1));
  }
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (last === '') {
    return hostname === '' ? url : hostname;
  }
  return decodeOrKeep(last);
}

/**
 * PDF の URL から、もとのファイル名を取り出す（ルビ付き PDF の名前のもとにする）。
 *
 * @param url - PDF の URL
 * @returns パスの最後の部分（`%` の符号は戻す）。blob: の URL は `#` の後ろ。
 *   取り出せない（パスが `/` で終わる・名前のない blob: の URL・URL として読めない）ときは undefined
 */
export function pdfNameFromUrl(url: string): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const { pathname, protocol, hash } = new URL(url);
  if (protocol === BLOB_PROTOCOL) {
    // 名前のない blob: の URL のパスは、意味のない番号
    return hash.length > 1 ? decodeOrKeep(hash.slice(1)) : undefined;
  }
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return last === '' ? undefined : decodeOrKeep(last);
}

/**
 * `%` の符号を戻す。
 *
 * @param text - 戻す文字
 * @returns 戻した文字。壊れた `%` の並びは、戻さずにそのまま見せる
 */
function decodeOrKeep(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
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
