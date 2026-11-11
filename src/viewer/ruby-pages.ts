// pdf.js がページを描くたびに、そのページにルビの層を重ねる。
// pdf.js は見えているページと、その前後のページだけを描くので、描いたページだけを扱えば足りる。
// ページの文・読み・置き場所は page-layout.ts が取っておくので、ここでは描いた字の位置を渡し、層を出す（出し直す）だけにする。
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';

import { createLogger } from '@/log';
import type { Direction } from '@/pdf/types';
import { RUBY_COLORS, type RubyStyle, type Settings } from '@/settings/model';
import type { UserDictionary } from '@/text/types';

import type { DrawRecorder } from './draw-recorder';
import type { DrawnPage, PageLayouts } from './page-layout';
import { RUBY_BAND_CLASS, showRubyLayer } from './ruby-layer';
import type { RubyBox } from './ruby-layout';
import { nearestFirst } from './settings-change';
import { invertMatrix, type Matrix, multiplyMatrix, toMatrix } from './transform';
import { textPage, uprightFrame } from './upright';
import { storedUserDictionary, type UserDictionaryFeed } from './user-dictionary-feed';

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
  readonly pdfPage: Pick<PDFPageProxy, 'getTextContent' | 'commonObjs' | 'rotate' | 'view'>;
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
  /** ページを読んでルビの置き場所を出す部品 */
  readonly layouts: PageLayouts;
  /**
   * ページの表示を引く
   * @param pageNumber ページ番号（1 から）
   * @returns ページの表示。なければ undefined
   */
  readonly getPageView: (pageNumber: number) => RubyPageView | undefined;
  /** 描いた字の位置を書き留める道具 */
  readonly recorder: DrawRecorder;
  /** ルビの見た目（CSS 変数と class）を置く要素 */
  readonly root: HTMLElement;
  /**
   * 今のページ番号を引く。設定が変わったとき、近いページから付け直すのに使う
   * @returns ページ番号（1 から）
   */
  readonly currentPageNumber?: () => number;
  /** 直した読みが変わるのを見張るもの（テストで差しかえるため）。既定は保存してある直した読み */
  readonly userDictionary?: UserDictionaryFeed;
  /**
   * ページのルビの層を出したとき（出し直したとき）に呼ぶ
   * @param pageNumber ページ番号（1 から）
   */
  readonly onPageShown?: (pageNumber: number) => void;
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
   * ページに出しているルビを引く。
   * @param pageNumber ページ番号（1 から）
   * @returns 出しているルビ。層を出していないページ・置き直す途中のページは空
   */
  rubiesOf(pageNumber: number): readonly RubyBox[];
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
  /**
   * 設定が変わったときに呼ぶ。色と帯はすぐ変え、大きさが変わればルビを置き直し、
   * 段階が変わればルビの層を出しているページを（近いページから）読み直す。ほかのページは次に描いたときに読み直す。
   * @param settings 変わったあとの設定
   */
  applySettings(settings: Settings): Promise<void>;
  /**
   * 直した読みが変わったときに呼ぶ。段階が変わったときと同じく、ルビの層を出しているページを読み直す。
   * @param userDictionary 変わったあとの直した読み
   */
  applyUserDictionary(userDictionary: UserDictionary): Promise<void>;
  /** 別の PDF を開くときに呼ぶ。取っておいたものを捨てる */
  reset(): void;
}

/** ページごとに取っておくもの */
interface PageEntry {
  /** 字の位置を書き留めている Canvas と、その画素から PDF の座標への変換 */
  watching: { readonly canvas: HTMLCanvasElement; readonly canvasToPdf: Matrix } | undefined;
  /** 層に出した置き場所 */
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
  const { layouts } = options;
  const dictionaryFeed = options.userDictionary ?? storedUserDictionary;
  // 字の大きさは置き場所を決めるときに入れる（大きさを変えたら置き直す）ので、ここでは色と帯だけ
  const applyStyle = (style: RubyStyle): void => {
    options.root.style.setProperty('--ruby-color', RUBY_COLORS[style.color]);
    options.root.classList.toggle(RUBY_BAND_CLASS, style.hasBand);
  };
  applyStyle(layouts.settings.rubyStyle);
  let entries = new Map<number, PageEntry>();

  const entryOf = (pageNumber: number): PageEntry => {
    let entry = entries.get(pageNumber);
    if (entry === undefined) {
      entry = { watching: undefined, boxes: undefined, layer: undefined, renders: 0 };
      entries.set(pageNumber, entry);
    }
    return entry;
  };

  // 置き場所を出し直したときは、前の層の要素が古いので、層を作り直す
  const showLayer = (pageNumber: number, view: RubyPageView, entry: PageEntry): void => {
    const boxes = layouts.placeRubies(
      pageNumber,
      uprightFrame(textPage(view.pdfPage)),
      view.pdfPage,
    );
    if (boxes === undefined) return;
    if (boxes !== entry.boxes) {
      entry.boxes = boxes;
      entry.layer?.remove();
      entry.layer = undefined;
    }
    entry.layer = showRubyLayer(
      view.div,
      view.viewport,
      boxes,
      entry.layer,
      textPage(view.pdfPage).rotate,
    );
  };

  // 向きを決め直して読み直したページの層を出し直す。描いたことのないページには出さない
  const showRedirected = (pageNumber: number): void => {
    const view = options.getPageView(pageNumber);
    const entry = entries.get(pageNumber);
    if (view === undefined || entry === undefined) return;
    showLayer(pageNumber, view, entry);
    options.onPageShown?.(pageNumber);
  };

  // ルビの層を出しているページを、今のページに近い順に出し直す。描いている途中のページは、描き終えたときに今の設定で出す
  const refreshShown = async (): Promise<void> => {
    const pages = [...entries]
      .filter(([, entry]) => entry.layer?.isConnected === true && entry.watching === undefined)
      .map(([pageNumber]) => pageNumber);
    await Promise.all(
      nearestFirst(pages, options.currentPageNumber?.() ?? 1).map(async (pageNumber) => {
        const view = options.getPageView(pageNumber);
        if (view !== undefined) await rubyPages.handlePageRendered({ source: view, pageNumber });
      }),
    );
  };

  const rubyPages: RubyPages = {
    handlePageRender(event) {
      const view = options.getPageView(event.pageNumber);
      if (view === undefined || view !== event.source) return;
      const entry = entryOf(event.pageNumber);
      // 描き終えたときに待つ。読めなかったときは中でログに残すので、ここでは予想外の失敗だけを残す
      layouts.prepare(event.pageNumber, view.pdfPage).catch((error: unknown) => {
        log.error('ページの文と読みを用意する途中で予想外の失敗がありました', error);
      });
      if (layouts.hasDrawn(event.pageNumber) || !(view.canvas instanceof HTMLCanvasElement)) {
        return;
      }
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
      const drawn: DrawnPage | undefined =
        watching === undefined
          ? undefined
          : { draws: options.recorder.take(watching.canvas), canvasToPdf: watching.canvasToPdf };
      const isWanted = (): boolean => current === entries && renders === entry.renders;
      const data = await layouts.prepare(event.pageNumber, view.pdfPage);
      if (data === undefined || !isWanted()) return;
      const resolved = await layouts.resolve(event.pageNumber, data, drawn, isWanted);
      if (resolved === undefined || !isWanted()) return;
      showLayer(event.pageNumber, view, entry);
      performance.measure(RUBY_LAYER_MEASURE, {
        start: renderedAt,
        detail: { pageNumber: event.pageNumber },
      });
      options.onPageShown?.(event.pageNumber);
    },

    rubiesOf(pageNumber) {
      const entry = entries.get(pageNumber);
      // 置き場所を出し直す前（大きさを変えた直後など）は、出している層が古いので空にする
      const isCurrent = entry?.boxes !== undefined && layouts.rubiesOf(pageNumber) === entry.boxes;
      return entry?.layer?.isConnected === true && isCurrent ? (entry.boxes ?? []) : [];
    },

    shownPages() {
      return [...entries]
        .filter(([, entry]) => entry.layer !== undefined)
        .map(([pageNumber]) => pageNumber)
        .toSorted((p, q) => p - q);
    },

    async setBlockDirection(pageNumber, index, direction) {
      if (options.getPageView(pageNumber) === undefined) return;
      await layouts.setBlockDirection(pageNumber, index, direction, showRedirected);
    },

    async setAllDirection(direction) {
      await layouts.setAllDirection(direction, showRedirected);
    },

    async applySettings(next) {
      const change = layouts.applySettings(next);
      applyStyle(next.rubyStyle);
      if (change.isLevelChanged || change.isSizeChanged) await refreshShown();
    },

    async applyUserDictionary(next) {
      layouts.applyUserDictionary(next);
      await refreshShown();
    },

    async retryFailed() {
      await Promise.all(
        layouts.failedPages().map(async (pageNumber) => {
          const view = options.getPageView(pageNumber);
          if (view !== undefined) await this.handlePageRendered({ source: view, pageNumber });
        }),
      );
    },

    reset() {
      entries = new Map();
      layouts.reset();
    },
  };
  // 設定の画面やほかの Chrome で直した読みを変えたら、開き直さずに反映する
  dictionaryFeed.watch((next) => {
    rubyPages.applyUserDictionary(next).catch((error: unknown) => {
      log.error('変わった直した読みをルビに反映する途中で予想外の失敗がありました', error);
    });
  });
  return rubyPages;
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
