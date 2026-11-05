// pdf.js がページを描くたびに、そのページにルビの層を重ねる。
// pdf.js は見えているページと、その前後のページだけを描くので、描いたページだけを扱えば足りる。
// ページの文・読み・字の位置・ルビの置き場所はページごとに取っておき、拡大・回転で描き直しても問い合わせ直さない。
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';

import { RUBY_COLOR, RUBY_SIZE_RATIO } from '@/config';
import { createLogger } from '@/log';
import type { ReadingResult } from '@/messaging/messages';
import { requestReadings } from '@/messaging/reading-client';
import { isDirectionUncertain } from '@/pdf/direction';
import { extractPageText } from '@/pdf/page-text';
import { type BlockRebuilder, createBlockRebuilder } from '@/pdf/rebuild-block';
import { isSerifFont } from '@/pdf/typeface';
import type { Direction, Glyph, PageText, PdfTextContent, Rect, TextBlock } from '@/pdf/types';
import type { RubySpan } from '@/text/annotate';

import type { DrawRecorder } from './draw-recorder';
import { type DrawnBox, snapGlyphs, toDrawnBoxes } from './glyph-snap';
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
  readonly pdfPage: Pick<PDFPageProxy, 'getTextContent' | 'commonObjs'>;
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
  /**
   * ページのルビの層を出したとき（出し直したとき）に呼ぶ
   * @param pageNumber ページ番号（1 から）
   */
  readonly onPageShown?: (pageNumber: number) => void;
  /**
   * 向きの自信がないかたまりのあるページがあるか（なしからあり、ありからなし）が変わったときに呼ぶ
   * @param hasUncertain 自信がないかたまりが1つでもあれば true
   */
  readonly onUncertainChange?: (hasUncertain: boolean) => void;
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
  /**
   * ページのかたまりを引く。
   * @param pageNumber ページ番号（1 から）
   * @returns 読む順のかたまり。文をまだ取り出していないページは空
   */
  blocksOf(pageNumber: number): readonly TextBlock[];
  /**
   * ルビの層を出しているページを挙げる。
   * @returns ページ番号（小さい順）
   */
  shownPages(): number[];
  /**
   * 1つのかたまりの向きを決め直し、そのかたまりだけ読み直してルビを置き直す。
   * @param pageNumber ページ番号（1 から）
   * @param index ページの中のかたまりの位置
   * @param direction 決める向き
   */
  setBlockDirection(pageNumber: number, index: number, direction: Direction): Promise<void>;
  /**
   * すべてのかたまりの向きを決める。まだ開いていないページも、開くときにこの向きにする。
   * @param direction 決める向き
   */
  setAllDirection(direction: Direction): Promise<void>;
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
  /** 描いた字の箱（向きを決め直したかたまりの字を合わせ直すために取っておく） */
  drawn: readonly DrawnBox[] | undefined;
  /** 層に出した文と読み */
  resolved: PageData | undefined;
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
  /** 利用者がすべてのかたまりに決めた向き。あとから開くページにも使う */
  let forced: Direction | undefined;
  /** 向きの自信がないかたまりのあるページ */
  const uncertainPages = new Set<number>();
  const markUncertain = (pageNumber: number, page: PageText): void => {
    const before = uncertainPages.size;
    if (page.blocks.some(isDirectionUncertain)) uncertainPages.add(pageNumber);
    else uncertainPages.delete(pageNumber);
    if ((before === 0) !== (uncertainPages.size === 0)) {
      options.onUncertainChange?.(uncertainPages.size > 0);
    }
  };
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
        drawn: undefined,
        resolved: undefined,
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
    const content = await view.pdfPage.getTextContent();
    const page = redirected(extractPageText(content), content, forced);
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

  const showLayer = (view: RubyPageView, entry: PageEntry, data: PageData): void => {
    const { exact } = entry;
    const { styles } = data.page;
    entry.boxes ??= layoutRubies(data.page.blocks, data.spans, frameOf(view.viewport), {
      sizeRatio: RUBY_SIZE_RATIO,
      rectOf: (glyph) => exact?.get(glyph) ?? glyph.rect,
      isSerif: (glyph) =>
        isSerifFont(styles[glyph.fontName], realFontName(view.pdfPage, glyph.fontName)),
    });
    entry.layer = showRubyLayer(view.div, view.viewport, entry.boxes, entry.layer);
  };

  // 向きを決め直したかたまりだけ読み直し、ルビの層を置き直す。読めなかったときは、今のままにする
  const redirect = async (
    pageNumber: number,
    wanted: (block: TextBlock) => Direction | undefined,
  ): Promise<void> => {
    const view = options.getPageView(pageNumber);
    const entry = entries.get(pageNumber);
    const data = entry?.resolved;
    if (view === undefined || entry === undefined || data === undefined) return;
    const current = entries;
    const rebuild = createBlockRebuilder(await view.pdfPage.getTextContent());
    const changes = rebuiltBlocks(data.page, rebuild, wanted);
    if (changes.length === 0) return;
    const result = await readTexts(changes.map(({ block }) => block.text));
    if (!result.ok) {
      log.error('向きを決め直したかたまりの読みを出せませんでした', result.error);
      return;
    }
    if (current !== entries || entry.resolved !== data) return;
    const blocks = [...data.page.blocks];
    const spans = [...data.spans];
    for (const [order, { index, block }] of changes.entries()) {
      blocks[index] = block;
      spans[index] = result.value[order] ?? [];
    }
    const updated = { page: { ...data.page, blocks }, spans };
    entry.resolved = updated;
    entry.data = Promise.resolve(updated);
    if (entry.exact !== undefined && entry.drawn !== undefined) {
      const exact = new Map(entry.exact);
      for (const { index } of changes) {
        for (const glyph of data.page.blocks[index]?.glyphs ?? []) exact.delete(glyph);
      }
      const snapped = snapGlyphs(
        changes.map(({ block }) => block),
        entry.drawn,
      );
      entry.exact = new Map([...exact, ...snapped]);
    }
    markUncertain(pageNumber, updated.page);
    entry.boxes = undefined;
    entry.layer?.remove();
    entry.layer = undefined;
    showLayer(view, entry, updated);
    options.onPageShown?.(pageNumber);
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
        entry.drawn = toDrawnBoxes(draws, watching.canvasToPdf);
        entry.exact = snapGlyphs(data.page.blocks, entry.drawn);
        entry.boxes = undefined;
      }
      if (entry.resolved === undefined) {
        entry.resolved = data;
        markUncertain(event.pageNumber, data.page);
      }
      showLayer(view, entry, entry.resolved);
      performance.measure(RUBY_LAYER_MEASURE, {
        start: renderedAt,
        detail: { pageNumber: event.pageNumber },
      });
      options.onPageShown?.(event.pageNumber);
    },

    blocksOf(pageNumber) {
      return entries.get(pageNumber)?.resolved?.page.blocks ?? [];
    },

    shownPages() {
      return [...entries]
        .filter(([, entry]) => entry.layer !== undefined)
        .map(([pageNumber]) => pageNumber)
        .toSorted((p, q) => p - q);
    },

    async setBlockDirection(pageNumber, index, direction) {
      const target = entries.get(pageNumber)?.resolved?.page.blocks[index];
      await redirect(pageNumber, (block) => (block === target ? direction : undefined));
    },

    async setAllDirection(direction) {
      forced = direction;
      await Promise.all(
        [...entries.keys()].map((pageNumber) =>
          redirect(pageNumber, (block) => forcedDirection(block, direction)),
        ),
      );
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
      forced = undefined;
      uncertainPages.clear();
      options.onUncertainChange?.(false);
      failed.clear();
      options.onReadingFailureChange?.(false);
    },
  };
}

/**
 * フォント自身の名前を引く。描き終えたあとなら、pdf.js が読み込んだフォントの名前が取れる。
 * @param pdfPage ページ
 * @param fontName getTextContent() の styles の鍵
 * @returns フォントの名前。まだ読み込めていないときは undefined
 */
function realFontName(
  pdfPage: Pick<PDFPageProxy, 'commonObjs'>,
  fontName: string,
): string | undefined {
  if (!pdfPage.commonObjs.has(fontName)) return undefined;
  const font = pdfPage.commonObjs.get(fontName) as { name?: unknown } | undefined;
  return typeof font?.name === 'string' ? font.name : undefined;
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

/**
 * かたまりに、すべてのかたまりに決めた向きを当てるか。向きが違うか、向きの自信がないかたまりに当てる。
 * @param block かたまり
 * @param direction すべてのかたまりに決めた向き
 * @returns 組み直す向き。そのままでよいかたまりは undefined
 */
function forcedDirection(block: TextBlock, direction: Direction): Direction | undefined {
  return block.direction !== direction || isDirectionUncertain(block) ? direction : undefined;
}

/**
 * 決めた向きで組み直すかたまりを、組み直して挙げる。
 * @param page ページの文
 * @param rebuild かたまりを組み直す関数
 * @param wanted かたまりに決める向き（組み直さないかたまりは undefined）
 * @returns 組み直したかたまりと、ページの中の位置
 */
function rebuiltBlocks(
  page: PageText,
  rebuild: BlockRebuilder,
  wanted: (block: TextBlock) => Direction | undefined,
): { index: number; block: TextBlock }[] {
  return page.blocks.flatMap((block, index) => {
    const direction = wanted(block);
    const rebuilt = direction === undefined ? undefined : rebuild(block, direction);
    return rebuilt === undefined ? [] : [{ index, block: rebuilt }];
  });
}

/**
 * すべてのかたまりに向きを決めているときは、その向きで組み直す。
 * @param page ページの文
 * @param content そのページの getTextContent() の結果
 * @param direction すべてのかたまりに決めた向き（決めていなければ undefined）
 * @returns 組み直したページの文
 */
function redirected(
  page: PageText,
  content: PdfTextContent,
  direction: Direction | undefined,
): PageText {
  if (direction === undefined) return page;
  const blocks = [...page.blocks];
  const changes = rebuiltBlocks(page, createBlockRebuilder(content), (block) =>
    forcedDirection(block, direction),
  );
  for (const { index, block } of changes) blocks[index] = block;
  return { ...page, blocks };
}
