// pdf.js がページを描くたびに、そのページにルビの層を重ねる。
// pdf.js は見えているページと、その前後のページだけを描くので、描いたページだけを扱えば足りる。
// ページの文・読み・字の位置・ルビの置き場所はページごとに取っておき、拡大・回転で描き直しても問い合わせ直さない。
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';

import { RUBY_COLOR, RUBY_SIZE_RATIO } from '@/config';
import { createLogger } from '@/log';
import type { ReadingResult } from '@/messaging/messages';
import { requestReadings } from '@/messaging/reading-client';
import { extractPageText } from '@/pdf/page-text';
import type { Glyph, PageText, Rect } from '@/pdf/types';
import type { RubySpan } from '@/text/annotate';

import type { DrawRecorder } from './draw-recorder';
import { snapGlyphs, toDrawnBoxes } from './glyph-snap';
import { showRubyLayer } from './ruby-layer';
import { layoutRubies, type PageFrame, type RubyBox } from './ruby-layout';
import { createFailedPages } from './special-cases';
import { invertMatrix, type Matrix, multiplyMatrix, toMatrix } from './transform';

/** 読みの問い合わせにかかった時間を測る名前（performance.measure） */
export const READINGS_MEASURE = 'yomigana-pdf:readings';
/** ページを描き終えてから、ルビの層を出すまでの時間を測る名前（performance.measure） */
export const RUBY_LAYER_MEASURE = 'yomigana-pdf:ruby-layer';

/** pdf.js のページの表示（PDFPageView）のうち、使うところ */
export interface RubyPageView {
  /** ページの div */
  readonly div: HTMLDivElement;
  /** 描いている Canvas（まだなければ別の値） */
  readonly canvas: unknown;
  /** 今の表示の大きさと向き */
  readonly viewport: PageViewport;
  /** Canvas の画素と CSS の画素の比 */
  readonly outputScale?: { readonly sx: number; readonly sy: number } | undefined;
  /** ページ */
  readonly pdfPage: Pick<PDFPageProxy, 'getTextContent'>;
}

/** pdf.js の pagerender・pagerendered の知らせのうち、使うところ */
export interface PageRenderEvent {
  /** 知らせを出した表示（ページの表示か、拡大したときの一部だけの表示） */
  readonly source: unknown;
  /** ページ番号（1 から） */
  readonly pageNumber: number;
  /** 拡大したときの一部だけの表示なら true（pagerendered だけ） */
  readonly isDetailView?: boolean;
}

/** ルビの層の作り方 */
export interface RubyPagesOptions {
  /**
   * ページの表示を引く
   * @param pageNumber ページ番号（1 から）
   * @returns ページの表示。なければ undefined
   */
  readonly getPageView: (pageNumber: number) => RubyPageView | undefined;
  /** 描いた字の位置を書き留める道具 */
  readonly recorder: DrawRecorder;
  /** ルビの見た目（CSS 変数）を置く要素 */
  readonly root: HTMLElement;
  /**
   * 読みを問い合わせる（テストで差しかえるため）
   * @param texts 文
   * @returns 文ごとのルビを付ける所
   */
  readonly readTexts?: (texts: readonly string[]) => Promise<ReadingResult>;
  /**
   * ページの文を取り出せたときに呼ぶ（文字が画像になっているかの判定に使う）
   * @param pageNumber ページ番号（1 から）
   * @param hasText 文があるか
   */
  readonly onPageText?: (pageNumber: number, hasText: boolean) => void;
  /**
   * 読みを出せなかったページがあるかが変わったときに呼ぶ
   * @param hasFailed 読みを出せなかったページが1つでもあれば true
   */
  readonly onReadingFailureChange?: (hasFailed: boolean) => void;
}

/** ページごとにルビの層を重ねる部品 */
export interface RubyPages {
  /**
   * pdf.js がページを描き始めたときに呼ぶ。文と読みの用意を始め、描く字の位置を書き留め始める。
   * @param event pagerender の知らせ
   */
  handlePageRender(event: PageRenderEvent): void;
  /**
   * pdf.js がページを描き終えたときに呼ぶ。ルビの層を出す（出し直す）。
   * @param event pagerendered の知らせ
   */
  handlePageRendered(event: PageRenderEvent): Promise<void>;
  /** 読みを出せなかったページの読みを、問い合わせ直してルビの層を出す */
  retryFailed(): Promise<void>;
  /** 別の PDF を開くときに呼ぶ。取っておいたものを捨てる */
  reset(): void;
}

/** ページの文と、文ごとのルビを付ける所 */
interface PageData {
  readonly page: PageText;
  readonly spans: readonly (readonly RubySpan[])[];
}

/** ページごとに取っておくもの */
interface PageEntry {
  /** 文と読み。読みを出せなかったときは undefined にして、次に描いたときに問い合わせ直す */
  data: Promise<PageData | undefined> | undefined;
  /** 字の位置を書き留めている Canvas と、その画素から PDF の座標への変換 */
  watching: { readonly canvas: HTMLCanvasElement; readonly canvasToPdf: Matrix } | undefined;
  /** 描いた位置に合わせた字の箱 */
  exact: ReadonlyMap<Glyph, Rect> | undefined;
  boxes: readonly RubyBox[] | undefined;
  layer: HTMLDivElement | undefined;
  /** 描き終えた回数。待っている間に描き直されたら、古いほうは出さない */
  renders: number;
}

const log = createLogger('ruby-layer');

/**
 * ページごとにルビの層を重ねる部品を作る。
 * @param options 作り方
 * @returns ルビの層の部品
 */
export function createRubyPages(options: RubyPagesOptions): RubyPages {
  const readTexts = options.readTexts ?? requestReadings;
  options.root.style.setProperty('--ruby-size', String(RUBY_SIZE_RATIO));
  options.root.style.setProperty('--ruby-color', RUBY_COLOR);
  let entries = new Map<number, PageEntry>();
  const failed = createFailedPages<RubyPageView>();
  const markFailure = (pageNumber: number, view: RubyPageView | undefined): void => {
    const before = failed.size;
    if (view === undefined) failed.remove(pageNumber);
    else failed.add(pageNumber, view);
    if ((before === 0) !== (failed.size === 0)) options.onReadingFailureChange?.(failed.size > 0);
  };

  const entryOf = (pageNumber: number): PageEntry => {
    let entry = entries.get(pageNumber);
    if (entry === undefined) {
      entry = {
        data: undefined,
        watching: undefined,
        exact: undefined,
        boxes: undefined,
        layer: undefined,
        renders: 0,
      };
      entries.set(pageNumber, entry);
    }
    return entry;
  };

  const load = async (
    pageNumber: number,
    view: RubyPageView,
    entry: PageEntry,
  ): Promise<PageData | undefined> => {
    const current = entries;
    const page = extractPageText(await view.pdfPage.getTextContent());
    options.onPageText?.(pageNumber, page.blocks.length > 0);
    if (page.blocks.length === 0) return { page, spans: [] };
    const startedAt = performance.now();
    const result = await readTexts(page.blocks.map((block) => block.text));
    performance.measure(READINGS_MEASURE, { start: startedAt });
    if (!result.ok) {
      log.error('読みを出せなかったので、ルビを付けずに出します', result.error);
      entry.data = undefined;
      // 別の PDF に移った後の失敗は、新しい PDF の記録に入れない
      if (current === entries) markFailure(pageNumber, view);
      return undefined;
    }
    if (current === entries) markFailure(pageNumber, undefined);
    return { page, spans: result.value };
  };

  // 文と読みは取っておき、描き終えたときに待つ。待つ前に失敗しても、ここでログに残して undefined にする
  const prepare = (
    pageNumber: number,
    view: RubyPageView,
    entry: PageEntry,
  ): Promise<PageData | undefined> => {
    const current = entries;
    entry.data ??= load(pageNumber, view, entry).catch((error: unknown) => {
      entry.data = undefined;
      if (current === entries) markFailure(pageNumber, view);
      // 別の PDF に移って、前の PDF のページが読めなくなったときは知らせない
      if (current === entries) log.error('ページの文字を読み出せませんでした', error);
      return undefined;
    });
    return entry.data;
  };

  return {
    handlePageRender(event) {
      const view = options.getPageView(event.pageNumber);
      if (view === undefined || view !== event.source) return;
      const entry = entryOf(event.pageNumber);
      entry.data = prepare(event.pageNumber, view, entry);
      if (entry.exact !== undefined || !(view.canvas instanceof HTMLCanvasElement)) return;
      const canvasToPdf = canvasToPdfOf(view);
      if (canvasToPdf === undefined) return;
      options.recorder.watch(view.canvas);
      entry.watching = { canvas: view.canvas, canvasToPdf };
    },

    async handlePageRendered(event) {
      const view = options.getPageView(event.pageNumber);
      if (event.isDetailView === true || view === undefined || view !== event.source) return;
      const renderedAt = performance.now();
      const current = entries;
      const entry = entryOf(event.pageNumber);
      const renders = ++entry.renders;
      const { watching } = entry;
      entry.watching = undefined;
      const draws = watching === undefined ? [] : options.recorder.take(watching.canvas);
      const data = await prepare(event.pageNumber, view, entry);
      if (data === undefined || current !== entries || renders !== entry.renders) return;
      if (watching !== undefined && draws.length > 0 && entry.exact === undefined) {
        entry.exact = snapGlyphs(data.page.blocks, toDrawnBoxes(draws, watching.canvasToPdf));
        entry.boxes = undefined;
      }
      const { exact } = entry;
      entry.boxes ??= layoutRubies(data.page.blocks, data.spans, frameOf(view.viewport), {
        sizeRatio: RUBY_SIZE_RATIO,
        rectOf: (glyph) => exact?.get(glyph) ?? glyph.rect,
      });
      entry.layer = showRubyLayer(view.div, view.viewport, entry.boxes, entry.layer);
      performance.measure(RUBY_LAYER_MEASURE, {
        start: renderedAt,
        detail: { pageNumber: event.pageNumber },
      });
    },

    async retryFailed() {
      await Promise.all(
        failed
          .list()
          .map(([pageNumber, view]) => this.handlePageRendered({ source: view, pageNumber })),
      );
    },

    reset() {
      entries = new Map();
      failed.clear();
      options.onReadingFailureChange?.(false);
    },
  };
}

/**
 * ページの Canvas の画素から PDF の座標への変換を作る。
 * @param view ページの表示
 * @returns 変換。作れないときは undefined
 */
function canvasToPdfOf(view: RubyPageView): Matrix | undefined {
  const { sx, sy } = view.outputScale ?? { sx: 1, sy: 1 };
  return invertMatrix(multiplyMatrix([sx, 0, 0, sy, 0, 0], toMatrix(view.viewport.transform)));
}

/**
 * ページの箱（PDF の座標）を引く。
 * @param viewport ページの表示の大きさと向き
 * @returns ページの箱（viewBox）
 */
function frameOf(viewport: PageViewport): PageFrame {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = viewport.viewBox;
  return { pageX: x1, pageY: y1, pageWidth: x2 - x1, pageHeight: y2 - y1 };
}
