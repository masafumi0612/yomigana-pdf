import 'pdfjs-dist/web/pdf_viewer.css';
import './style.css';

import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import { withTimeout } from '@/messaging/timeout';
import { allowNativeView } from '@/redirect/skip';
import { DEFAULT_SETTINGS, type Settings } from '@/settings/model';
import { getSettings, watchSettings } from '@/settings/storage';
import type { Level } from '@/text/types';
import { createDirectionEditor } from '@/viewer/direction-editor';
import { installDrawRecorder } from '@/viewer/draw-recorder';
import {
  formatZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  nextRotation,
  nextZoomStep,
  parsePageNumber,
} from '@/viewer/navigation';
import { createPageLayouts } from '@/viewer/page-layout';
import { createPageMenu } from '@/viewer/page-menu';
import { createPrintNotice, isPrintShortcut } from '@/viewer/print-notice';
import { createReadingFixDialog } from '@/viewer/reading-fix-dialog';
import { rubyAmountLabel } from '@/viewer/ruby-amount';
import { createRubyExportUi } from '@/viewer/ruby-export-ui';
import { findRuby, type RubyFinderOptions } from '@/viewer/ruby-hit';
import { createRubyPages, type PageRenderEvent, type RubyPageView } from '@/viewer/ruby-pages';
import {
  fileNameFromUrl,
  isPdfFile,
  pdfNameFromUrl,
  readInitialHash,
  readViewerParams,
} from '@/viewer/source';
import { isImageOnlyDocument } from '@/viewer/special-cases';

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

/** 開く PDF。URL から読むか、選ばれたファイルを読む */
type PdfSource =
  | { kind: 'url'; url: string; hasCredentials: boolean; hash: string }
  | { kind: 'file'; file: File };

/** PDF の中のリンクに付ける rel。開いた先から、このリーダーを触れないようにする */
const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow';

/** pdf.js が読む同梱のデータの置き場所（ビルドで node_modules から写す） */
const ASSET_BASE = location.origin;

/** 始めに設定を読むのを待つ時間の上限（ミリ秒）。過ぎたら既定で始め、PDF を出すのを止めない */
const SETTINGS_TIMEOUT_MS = 1000;

const log = createLogger('viewer');

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new TypeError(`リーダーの画面に #${id} がない`);
  }
  return element;
}

const fileName = requireElement('file-name', HTMLHeadingElement);
const pageGroup = requireElement('page-group', HTMLDivElement);
const pageInput = requireElement('page-input', HTMLInputElement);
const pageTotal = requireElement('page-total', HTMLSpanElement);
const directionEntry = requireElement('direction-entry', HTMLButtonElement);
const directionEntryLabel = requireElement('direction-entry-label', HTMLSpanElement);
const zoomGroup = requireElement('zoom-group', HTMLDivElement);
const zoomOut = requireElement('zoom-out', HTMLButtonElement);
const zoomLevel = requireElement('zoom-level', HTMLOutputElement);
const zoomIn = requireElement('zoom-in', HTMLButtonElement);
const rotate = requireElement('rotate', HTMLButtonElement);
const rotateLabel = requireElement('rotate-label', HTMLSpanElement);
const rubyAmount = requireElement('ruby-amount', HTMLButtonElement);
const rubyAmountText = requireElement('ruby-amount-text', HTMLSpanElement);
const exportPdf = requireElement('export-pdf', HTMLButtonElement);
const exportPdfLabel = requireElement('export-pdf-label', HTMLSpanElement);
const exportNotice = requireElement('export-notice', HTMLDivElement);
const exportText = requireElement('export-text', HTMLParagraphElement);
const exportStop = requireElement('export-stop', HTMLButtonElement);
const exportClose = requireElement('export-close', HTMLButtonElement);
const exportLive = requireElement('export-live', HTMLParagraphElement);
const openFile = requireElement('open-file', HTMLButtonElement);
const openNative = requireElement('open-native', HTMLButtonElement);
const printNoticeText = requireElement('print-notice', HTMLParagraphElement);
const fileInput = requireElement('file-input', HTMLInputElement);
const status = requireElement('status', HTMLParagraphElement);
const failureActions = requireElement('failure-actions', HTMLDivElement);
const failureChoose = requireElement('failure-choose', HTMLButtonElement);
const failureNative = requireElement('failure-native', HTMLButtonElement);
const rubyFailed = requireElement('ruby-failed', HTMLDivElement);
const rubyFailedText = requireElement('ruby-failed-text', HTMLSpanElement);
const rubyRetry = requireElement('ruby-retry', HTMLButtonElement);
const passwordForm = requireElement('password-form', HTMLFormElement);
const passwordLabel = requireElement('password-label', HTMLLabelElement);
const passwordInput = requireElement('password-input', HTMLInputElement);
const passwordSubmit = requireElement('password-submit', HTMLButtonElement);
const passwordError = requireElement('password-error', HTMLParagraphElement);
const noTextNotice = requireElement('no-text-notice', HTMLDivElement);
const noTextText = requireElement('no-text-text', HTMLParagraphElement);
const noTextClose = requireElement('no-text-close', HTMLButtonElement);
const bar = requireElement('bar', HTMLElement);
const directionBar = requireElement('direction-bar', HTMLDivElement);
const directionBarText = requireElement('direction-bar-text', HTMLParagraphElement);
const directionAllVertical = requireElement('direction-all-vertical', HTMLButtonElement);
const directionAllHorizontal = requireElement('direction-all-horizontal', HTMLButtonElement);
const directionDone = requireElement('direction-done', HTMLButtonElement);
const pageMenuElement = requireElement('page-menu', HTMLDivElement);
const rubyMenuGroup = requireElement('ruby-menu-group', HTMLDivElement);
const rubyMenuTitle = requireElement('ruby-menu-title', HTMLDivElement);
const fixMenuItem = requireElement('fix-menu-item', HTMLButtonElement);
const directionMenuItem = requireElement('direction-menu-item', HTMLButtonElement);
const settingsMenuItem = requireElement('settings-menu-item', HTMLButtonElement);
const container = requireElement('viewer-container', HTMLDivElement);
const viewerElement = requireElement('viewer', HTMLDivElement);

const message = (name: MessageName, substitutions?: string): string =>
  browser.i18n.getMessage(name, substitutions);

/**
 * 保存した設定を読む。読めないとき・時間がかかるときは、ログに残して既定を使う。
 * @returns 設定
 */
async function loadSettings(): Promise<Settings> {
  try {
    const result = await withTimeout(getSettings(), SETTINGS_TIMEOUT_MS);
    if (result.ok) {
      return result.value;
    }
    log.warn('設定を読むのに時間がかかったので、既定を使います');
  } catch (error) {
    log.error('設定を読めなかったので、既定を使います', error);
  }
  return DEFAULT_SETTINGS;
}

/**
 * バーのルビの量のボタンを、段階に合わせる。
 * @param level 段階
 */
function showRubyAmount(level: Level): void {
  const label = rubyAmountLabel(level, message);
  rubyAmountText.textContent = label.text;
  rubyAmount.setAttribute('aria-label', label.name);
}

// pdf.js が字を描くより前に、字を描いた位置を書き留める用意をする
const drawRecorder = installDrawRecorder();
// 表示の部品を読み込む間に、設定も読んでおく
const loadingSettings = loadSettings();

// 部品の表示（pdf_viewer.mjs）は、読み込むときに pdf.js の本体を globalThis から引く
Object.assign(globalThis, { pdfjsLib });
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const pdfjsViewer = await import('pdfjs-dist/web/pdf_viewer.mjs');

const eventBus = new pdfjsViewer.EventBus();
const linkService = new pdfjsViewer.PDFLinkService({
  eventBus,
  externalLinkTarget: pdfjsViewer.LinkTarget.BLANK,
  externalLinkRel: EXTERNAL_LINK_REL,
});
// PDF の中のスクリプトを動かさないため、scriptingManager は渡さない
const viewer = new pdfjsViewer.PDFViewer({
  container,
  viewer: viewerElement,
  eventBus,
  linkService,
});
linkService.setViewer(viewer);
// 描いたページごとの、文があるか。文字が画像になっている PDF の案内に使う
const hasTextByPage = new Map<number, boolean>();
// 案内を閉じたら、同じ PDF では出し直さない
let isNoTextDismissed = false;
// 開くときに URL の # から後ろで指されたページ・倍率。ページの数がわかる pagesinit で一度だけ使う
let initialHash = '';
// 向きを直すモードの間か
let isDirectionEditing = false;
// 開いている PDF のもとの名前（ルビ付き PDF の名前に使う）。分からなければ undefined
let sourceName: string | undefined;

function updateNoTextNotice(): void {
  noTextNotice.hidden = isNoTextDismissed || !isImageOnlyDocument(hasTextByPage);
}

const initialSettings = await loadingSettings;
const pageLayouts = createPageLayouts({
  getPage: async (pageNumber) => viewer.pdfDocument?.getPage(pageNumber),
  recorder: drawRecorder,
  // 最初の読みの問い合わせより前に、保存した設定を読み終えておく
  settings: initialSettings,
  onPageText: (pageNumber, hasText) => {
    hasTextByPage.set(pageNumber, hasText);
    updateNoTextNotice();
  },
  onReadingFailureChange: (hasFailed) => {
    rubyFailed.hidden = !hasFailed;
  },
  onLayoutChange: () => {
    rubyExport.handleLayoutChange();
  },
});
const rubyPages = createRubyPages({
  layouts: pageLayouts,
  // pdf.js の型ではページの表示が any なので、使うところだけの形として受け取る
  getPageView: (pageNumber) => viewer.getPageView(pageNumber - 1) as RubyPageView | undefined,
  recorder: drawRecorder,
  root: container,
  currentPageNumber: () => viewer.currentPageNumber,
  onPageShown: (pageNumber) => {
    directionEditor.refreshPage(pageNumber);
  },
});
const directionEditor = createDirectionEditor({
  layouts: pageLayouts,
  pages: rubyPages,
  getPageView: (pageNumber) => viewer.getPageView(pageNumber - 1) as RubyPageView | undefined,
});
const rubyFinder: RubyFinderOptions = {
  pages: rubyPages,
  getPageView: (pageNumber) => viewer.getPageView(pageNumber - 1) as RubyPageView | undefined,
};
const readingFixDialog = createReadingFixDialog(() => {
  container.focus();
});
const rubyExport = createRubyExportUi({
  button: exportPdf,
  notice: exportNotice,
  noticeText: exportText,
  live: exportLive,
  stop: exportStop,
  close: exportClose,
  getDocument: () => viewer.pdfDocument ?? undefined,
  layouts: pageLayouts,
  sourceName: () => sourceName,
  isImageOnly: () => isImageOnlyDocument(hasTextByPage),
});
const printNotice = createPrintNotice({
  onExport: () => {
    rubyExport.start();
  },
  canExport: () => !exportPdf.hidden,
  onOpenNative: goNative,
});
const pageMenu = createPageMenu({
  menu: pageMenuElement,
  rubyGroup: rubyMenuGroup,
  rubyTitle: rubyMenuTitle,
  fixItem: fixMenuItem,
  onFix: (ruby) => {
    readingFixDialog.open(ruby);
  },
});

// 設定の画面やほかの Chrome で変えた設定を、開き直さずに反映する
watchSettings((settings) => {
  showRubyAmount(settings.level);
  rubyPages.applySettings(settings).catch((error: unknown) => {
    log.error('変わった設定をルビに反映する途中で予想外の失敗がありました', error);
  });
});

// 押しても動かないボタンを見せないよう、表示の部品の読み込みが済んでから文言を入れる
document.title = message('viewer_page_title');
pageInput.setAttribute('aria-label', message('viewer_bar_pageNumber'));
zoomOut.setAttribute('aria-label', message('viewer_bar_zoomOut'));
zoomIn.setAttribute('aria-label', message('viewer_bar_zoomIn'));
zoomLevel.setAttribute('aria-label', message('viewer_bar_zoomLevel'));
// 更新のボタンと見分けられるよう、紙と矢印の絵に「右に回す」の文字を添える
rotateLabel.textContent = message('viewer_bar_rotate');
rotate.title = message('viewer_bar_rotateTitle');
showRubyAmount(initialSettings.level);
rubyAmount.title = message('viewer_bar_rubyAmountTitle');
rubyAmount.hidden = false;
exportPdfLabel.textContent = message('viewer_bar_exportPdf');
exportPdf.title = message('viewer_bar_exportPdfTitle');
exportStop.textContent = message('viewer_export_stop');
exportClose.textContent = message('viewer_export_close');
openFile.textContent = message('viewer_bar_openFile');
openFile.hidden = false;
openNative.textContent = message('viewer_bar_openNative');
printNoticeText.textContent = message('viewer_print_notice');
container.setAttribute('aria-label', message('viewer_main_document'));
failureChoose.textContent = message('viewer_main_chooseFile');
failureNative.textContent = message('viewer_main_openNative');
rubyFailedText.textContent = message('viewer_bar_rubyFailed');
rubyRetry.textContent = message('viewer_bar_rubyRetry');
passwordLabel.textContent = message('viewer_password_label');
passwordSubmit.textContent = message('viewer_password_open');
passwordError.textContent = message('viewer_password_incorrect');
noTextText.textContent = message('viewer_notice_noText');
noTextClose.textContent = message('viewer_notice_close');
directionEntryLabel.textContent = message('viewer_bar_directionFix');
directionEntry.title = message('viewer_bar_directionFixTitle');
fixMenuItem.textContent = message('viewer_menu_fixReading');
directionMenuItem.textContent = message('viewer_menu_directionFix');
settingsMenuItem.textContent = message('viewer_menu_openSettings');
directionAllVertical.textContent = message('viewer_direction_allVertical');
directionAllHorizontal.textContent = message('viewer_direction_allHorizontal');
directionDone.textContent = message('viewer_direction_done');

let currentTask: PDFDocumentLoadingTask | undefined;
let nativeUrl: string | undefined;
/** パスワードの入力を待っている間の、pdf.js へ渡す関数 */
let pendingPassword: ((password: string) => void) | undefined;

function showStatus(name: MessageName | undefined): void {
  status.textContent = name === undefined ? '' : message(name);
  status.hidden = name === undefined;
  failureActions.hidden = name !== 'viewer_main_openFailed';
}

function hidePasswordForm(): void {
  passwordForm.hidden = true;
  passwordError.hidden = true;
  passwordInput.value = '';
}

/** 向きを直すモードに入る（入っている間だけ、バーを青にして案内を出す） */
function enterDirectionEditing(): void {
  isDirectionEditing = true;
  bar.classList.add('bar--editing');
  directionBar.hidden = false;
  directionBarText.textContent = message('viewer_direction_barText');
  directionEditor.enter();
}

/** 向きを直すモードを終える */
function exitDirectionEditing(): void {
  if (!isDirectionEditing) return;
  isDirectionEditing = false;
  directionEditor.exit();
  bar.classList.remove('bar--editing');
  directionBar.hidden = true;
  directionBarText.textContent = '';
  container.focus();
}

/** 別の PDF を開くときに、前の PDF の案内を片づける */
function resetNotices(): void {
  exitDirectionEditing();
  rubyExport.reset();
  hidePasswordForm();
  hasTextByPage.clear();
  isNoTextDismissed = false;
  updateNoTextNotice();
}

function setDocumentShown(isShown: boolean): void {
  container.hidden = !isShown;
  pageGroup.hidden = !isShown;
  zoomGroup.hidden = !isShown;
  exportPdf.hidden = !isShown;
}

function setNativeUrl(source: PdfSource): void {
  if (nativeUrl?.startsWith('blob:') === true) {
    URL.revokeObjectURL(nativeUrl);
  }
  nativeUrl = source.kind === 'url' ? source.url : URL.createObjectURL(source.file);
  openNative.hidden = false;
}

async function readFile(file: File): Promise<{ data: Uint8Array } | undefined> {
  try {
    return { data: new Uint8Array(await file.arrayBuffer()) };
  } catch {
    // 選んだ後にファイルが消された・動かされたときは読めない
    return undefined;
  }
}

async function openSource(source: PdfSource): Promise<void> {
  const name = source.kind === 'url' ? fileNameFromUrl(source.url) : source.file.name;
  sourceName = source.kind === 'url' ? pdfNameFromUrl(source.url) : source.file.name;
  fileName.textContent = name;
  document.title = name;
  setNativeUrl(source);
  initialHash = source.kind === 'url' ? source.hash : '';
  resetNotices();
  showStatus('viewer_main_loading');

  // URL は pdf.js が少しずつ読みに行く。ファイルは中身を渡す
  const input =
    source.kind === 'url'
      ? { url: source.url, withCredentials: source.hasCredentials }
      : await readFile(source.file);
  if (input === undefined) {
    showFailure();
    return;
  }
  const previous = currentTask;
  const task = pdfjsLib.getDocument({
    ...input,
    cMapUrl: `${ASSET_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}/standard_fonts/`,
    wasmUrl: `${ASSET_BASE}/wasm/`,
    iccUrl: `${ASSET_BASE}/iccs/`,
    // 拡張の外のフォントを読まない
    useSystemFonts: false,
    // フォントの名前（Mincho・Gothic など）を取れるようにする。ルビを明朝・ゴシックに合わせるのに使う
    fontExtraProperties: true,
  });
  currentTask = task;
  // パスワードは入力欄から pdf.js へ渡すだけで、変数・ログ・保存先には残さない
  task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    if (currentTask !== task) {
      return;
    }
    showStatus(undefined);
    passwordError.hidden = reason !== pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
    passwordForm.hidden = false;
    pendingPassword = updatePassword;
    passwordInput.value = '';
    passwordInput.focus();
  };
  try {
    const pdfDocument = await task.promise;
    // 読み込みの間に別の PDF が開かれたら、こちらは出さない
    if (currentTask === task) {
      setDocumentShown(true);
      // 読み込みの間に古い PDF で作り始めていても、新しい PDF に移る前に止める
      rubyExport.reset();
      rubyPages.reset();
      viewer.setDocument(pdfDocument);
      linkService.setDocument(pdfDocument);
      showStatus(undefined);
    }
  } catch {
    // 壊れた PDF・パスワード付き・読みに行けない URL は、Chrome の標準の表示に任せる
    if (currentTask === task) {
      showFailure();
    }
  } finally {
    if (currentTask === task) {
      pendingPassword = undefined;
      hidePasswordForm();
    }
    await previous?.destroy();
  }
}

function showFailure(): void {
  setDocumentShown(false);
  showStatus('viewer_main_openFailed');
  failureNative.focus();
}

function goNative(): void {
  const url = nativeUrl;
  if (url === undefined) {
    return;
  }
  // 自動で移す決まりに、標準の表示からまたリーダーへ戻されないよう、先にこのタブ・この URL を除く
  allowNativeView(url)
    .catch((error: unknown) => {
      log.error('標準の表示のルールを入れるのに失敗しました', error);
    })
    .finally(() => {
      location.assign(url);
    });
}

function openFiles(files: FileList | undefined): void {
  const file = files?.[0];
  if (file === undefined) {
    return;
  }
  if (!isPdfFile(file)) {
    showStatus('viewer_main_notPdf');
    return;
  }
  // 画面のイベントからは待てない。開けなかったことは openSource が画面に出すので、ここでは予想外の失敗だけを残す
  openSource({ kind: 'file', file }).catch((error: unknown) => {
    log.error('PDF を開く途中で予想外の失敗がありました', error);
  });
}

function updateZoom(scale: number): void {
  zoomLevel.value = formatZoom(scale);
  zoomOut.disabled = scale <= MIN_ZOOM;
  zoomIn.disabled = scale >= MAX_ZOOM;
}

eventBus.on('pagesinit', () => {
  viewer.currentScaleValue = 'auto';
  if (initialHash !== '') {
    linkService.setHash(initialHash);
    initialHash = '';
  }
  pageTotal.textContent = message('viewer_bar_pageTotal', String(viewer.pagesCount));
  pageInput.value = String(viewer.currentPageNumber);
});
eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
  pageInput.value = String(pageNumber);
});
eventBus.on('scalechanging', ({ scale }: { scale: number }) => {
  updateZoom(scale);
});
eventBus.on('pagerender', (event: PageRenderEvent) => {
  rubyPages.handlePageRender(event);
});
// 拡大・回転で描き直したときも来るので、そのたびにルビの層を合わせ直す
eventBus.on('pagerendered', (event: PageRenderEvent) => {
  // 読みを出せなかったときは中でログに残すので、ここでは予想外の失敗だけを残す
  rubyPages.handlePageRendered(event).catch((error: unknown) => {
    log.error('ルビの層を出す途中で予想外の失敗がありました', error);
  });
});

pageInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  const result = parsePageNumber(pageInput.value, viewer.pagesCount);
  if (result.ok) {
    viewer.currentPageNumber = result.value;
  }
  pageInput.value = String(viewer.currentPageNumber);
  pageInput.select();
});
pageInput.addEventListener('blur', () => {
  pageInput.value = String(viewer.currentPageNumber);
});
zoomOut.addEventListener('click', () => {
  viewer.currentScale = nextZoomStep(viewer.currentScale, 'out');
});
zoomIn.addEventListener('click', () => {
  viewer.currentScale = nextZoomStep(viewer.currentScale, 'in');
});
rotate.addEventListener('click', () => {
  // 描き直しのあとの pagerendered で、ルビの層も新しい向きに置き直される
  viewer.pagesRotation = nextRotation(viewer.pagesRotation);
});
function openOptions(): void {
  browser.runtime.openOptionsPage().catch((error: unknown) => {
    log.error('設定の画面を開くのに失敗しました', error);
  });
}
rubyAmount.addEventListener('click', openOptions);
openFile.addEventListener('click', () => {
  fileInput.click();
});
fileInput.addEventListener('change', () => {
  openFiles(fileInput.files ?? undefined);
  // 同じファイルを選び直しても change が来るようにする
  fileInput.value = '';
});
exportPdf.addEventListener('click', () => {
  rubyExport.start();
});
openNative.addEventListener('click', goNative);
failureNative.addEventListener('click', goNative);
failureChoose.addEventListener('click', () => {
  fileInput.click();
});
rubyRetry.addEventListener('click', () => {
  rubyRetry.disabled = true;
  rubyPages
    .retryFailed()
    .catch((error: unknown) => {
      log.error('ルビの付け直しの途中で予想外の失敗がありました', error);
    })
    .finally(() => {
      rubyRetry.disabled = false;
    });
});
directionEntry.addEventListener('click', enterDirectionEditing);
directionDone.addEventListener('click', exitDirectionEditing);
for (const [button, direction] of [
  [directionAllVertical, 'vertical'],
  [directionAllHorizontal, 'horizontal'],
] as const) {
  button.addEventListener('click', () => {
    rubyPages.setAllDirection(direction).catch((error: unknown) => {
      log.error('すべてのかたまりの向きを決める途中で予想外の失敗がありました', error);
    });
  });
}
const canOpenMenu = (): boolean =>
  !isDirectionEditing && document.getSelection()?.isCollapsed !== false;
// 紙面を右クリックしたら、紙面のメニューを出す。文字を選んでいるときは、標準のメニュー（コピーなど）に任せる
container.addEventListener('contextmenu', (event) => {
  if (!canOpenMenu()) return;
  event.preventDefault();
  const point = { x: event.clientX, y: event.clientY };
  pageMenu.open(point, findRuby(rubyFinder, point, { maxDistance: 0 }));
});
// メニューのキーは、離したときにも（焦点のあるメニューの項目に）contextmenu が来るので、標準のメニューを出さない
pageMenuElement.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});
// メニューのキー・Shift+F10 では、見えている所の真ん中にいちばん近いルビのメニューを、そのルビの下に出す
container.addEventListener('keydown', (event) => {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  if (!canOpenMenu()) return;
  event.preventDefault();
  const area = container.getBoundingClientRect();
  const center = { x: area.left + area.width / 2, y: area.top + area.height / 2 };
  const ruby = findRuby(rubyFinder, center, { maxDistance: Infinity, within: area });
  pageMenu.open(
    ruby === undefined ? center : { x: ruby.rect.left, y: ruby.rect.top + ruby.rect.height },
    ruby,
  );
});
directionMenuItem.addEventListener('click', () => {
  pageMenu.close();
  enterDirectionEditing();
});
settingsMenuItem.addEventListener('click', () => {
  pageMenu.close();
  container.focus();
  openOptions();
});
document.addEventListener('pointerdown', (event) => {
  if (event.target instanceof Node && !pageMenuElement.contains(event.target)) {
    pageMenu.close();
  }
});
// ブラウザーの印刷は紙面の見えている範囲しか出せないので、止めて案内を出す。
// Chrome のメニューからの印刷は止められないので、印刷用の CSS で同じ案内を出す
document.addEventListener(
  'keydown',
  (event) => {
    if (!isPrintShortcut(event)) return;
    event.preventDefault();
    pageMenu.close();
    printNotice.open();
  },
  { capture: true },
);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!pageMenuElement.hidden) {
    pageMenu.close();
    container.focus();
  } else {
    exitDirectionEditing();
  }
});
noTextClose.addEventListener('click', () => {
  isNoTextDismissed = true;
  updateNoTextNotice();
  container.focus();
});
passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const update = pendingPassword;
  if (update === undefined || passwordInput.value === '') {
    return;
  }
  pendingPassword = undefined;
  passwordForm.hidden = true;
  passwordError.hidden = true;
  showStatus('viewer_main_loading');
  update(passwordInput.value);
  passwordInput.value = '';
});
document.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = 'copy';
  }
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  openFiles(event.dataTransfer?.files);
});

setDocumentShown(false);
const params = readViewerParams(location.search, location.origin);
if (params.ok && params.value.pdfUrl !== undefined) {
  await openSource({
    kind: 'url',
    url: params.value.pdfUrl,
    hasCredentials: params.value.hasCredentials,
    hash: readInitialHash(params.value.pdfUrl, params.value.hasCredentials, location.hash),
  });
} else {
  // 開いてはいけない URL を渡されたときも、ファイルを選んで開けるようにしておく
  showStatus('viewer_main_empty');
}
