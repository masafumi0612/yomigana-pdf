import 'pdfjs-dist/web/pdf_viewer.css';
import './style.css';

import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import { formatZoom, MAX_ZOOM, MIN_ZOOM, nextZoomStep, parsePageNumber } from '@/viewer/navigation';
import { fileNameFromUrl, isPdfFile, readViewerParams } from '@/viewer/source';

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

/** 開く PDF。URL から読むか、選ばれたファイルを読む */
type PdfSource = { kind: 'url'; url: string } | { kind: 'file'; file: File };

/** PDF の中のリンクに付ける rel。開いた先から、このリーダーを触れないようにする */
const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow';

/** pdf.js が読む同梱のデータの置き場所（ビルドで node_modules から写す） */
const ASSET_BASE = location.origin;

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
const zoomGroup = requireElement('zoom-group', HTMLDivElement);
const zoomOut = requireElement('zoom-out', HTMLButtonElement);
const zoomLevel = requireElement('zoom-level', HTMLOutputElement);
const zoomIn = requireElement('zoom-in', HTMLButtonElement);
const openFile = requireElement('open-file', HTMLButtonElement);
const openNative = requireElement('open-native', HTMLButtonElement);
const fileInput = requireElement('file-input', HTMLInputElement);
const status = requireElement('status', HTMLParagraphElement);
const container = requireElement('viewer-container', HTMLDivElement);
const viewerElement = requireElement('viewer', HTMLDivElement);

const message = (name: MessageName, substitutions?: string): string =>
  browser.i18n.getMessage(name, substitutions);

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

// 押しても動かないボタンを見せないよう、表示の部品の読み込みが済んでから文言を入れる
document.title = message('viewer_page_title');
pageInput.setAttribute('aria-label', message('viewer_bar_pageNumber'));
zoomOut.setAttribute('aria-label', message('viewer_bar_zoomOut'));
zoomIn.setAttribute('aria-label', message('viewer_bar_zoomIn'));
zoomLevel.setAttribute('aria-label', message('viewer_bar_zoomLevel'));
openFile.textContent = message('viewer_bar_openFile');
openFile.hidden = false;
openNative.textContent = message('viewer_bar_openNative');
container.setAttribute('aria-label', message('viewer_main_document'));

let currentTask: PDFDocumentLoadingTask | undefined;
let nativeUrl: string | undefined;

function showStatus(name: MessageName | undefined): void {
  status.textContent = name === undefined ? '' : message(name);
  status.hidden = name === undefined;
}

function setDocumentShown(isShown: boolean): void {
  container.hidden = !isShown;
  pageGroup.hidden = !isShown;
  zoomGroup.hidden = !isShown;
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
  fileName.textContent = name;
  document.title = name;
  setNativeUrl(source);
  showStatus('viewer_main_loading');

  // URL は pdf.js が少しずつ読みに行く。ファイルは中身を渡す
  const input = source.kind === 'url' ? { url: source.url } : await readFile(source.file);
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
  });
  currentTask = task;
  try {
    const pdfDocument = await task.promise;
    // 読み込みの間に別の PDF が開かれたら、こちらは出さない
    if (currentTask === task) {
      setDocumentShown(true);
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
    await previous?.destroy();
  }
}

function showFailure(): void {
  setDocumentShown(false);
  showStatus('viewer_main_openFailed');
  openNative.focus();
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
  pageTotal.textContent = message('viewer_bar_pageTotal', String(viewer.pagesCount));
  pageInput.value = String(viewer.currentPageNumber);
});
eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
  pageInput.value = String(pageNumber);
});
eventBus.on('scalechanging', ({ scale }: { scale: number }) => {
  updateZoom(scale);
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
openFile.addEventListener('click', () => {
  fileInput.click();
});
fileInput.addEventListener('change', () => {
  openFiles(fileInput.files ?? undefined);
  // 同じファイルを選び直しても change が来るようにする
  fileInput.value = '';
});
openNative.addEventListener('click', () => {
  if (nativeUrl !== undefined) {
    location.assign(nativeUrl);
  }
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
  await openSource({ kind: 'url', url: params.value.pdfUrl });
} else {
  // 開いてはいけない URL を渡されたときも、ファイルを選んで開けるようにしておく
  showStatus('viewer_main_empty');
}
