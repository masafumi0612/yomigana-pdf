// pdf.js がページを描くたびに、そのページにルビの層を重ねる。
// pdf.js は見えているページと、その前後のページだけを描くので、描いたページだけを扱えば足りる。
// ページの文・読み・字の位置・ルビの置き場所はページごとに取っておき、拡大・回転で描き直しても問い合わせ直さない。
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';

import { createLogger } from '@/log';
import type { ReadingError, ReadingResult } from '@/messaging/messages';
import { requestReadings } from '@/messaging/reading-client';
import { isDirectionUncertain } from '@/pdf/direction';
import { extractPageText } from '@/pdf/page-text';
import { type BlockRebuilder, createBlockRebuilder } from '@/pdf/rebuild-block';
import { isSerifFont } from '@/pdf/typeface';
import type { Direction, Glyph, PageText, PdfTextContent, Rect, TextBlock } from '@/pdf/types';
import type { Result } from '@/result';
import {
  DEFAULT_SETTINGS,
  RUBY_COLORS,
  RUBY_SIZE_RATIOS,
  type RubyStyle,
  type Settings,
} from '@/settings/model';
import type { RubySpan } from '@/text/annotate';
import type { Level, UserDictionary } from '@/text/types';

import type { DrawRecorder } from './draw-recorder';
import { type DrawnBox, snapGlyphs, toDrawnBoxes } from './glyph-snap';
import { RUBY_BAND_CLASS, showRubyLayer } from './ruby-layer';
import { layoutRubies, type PageFrame, type RubyBox } from './ruby-layout';
import { nearestFirst, settingsChange } from './settings-change';
import { createFailedPages } from './special-cases';
import { invertMatrix, type Matrix, multiplyMatrix, toMatrix } from './transform';
import { storedUserDictionary, type UserDictionaryFeed } from './user-dictionary-feed';

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
  /** ルビの見た目（CSS 変数と class）を置く要素 */
  readonly root: HTMLElement;
  /** 始めの設定。既定は DEFAULT_SETTINGS */
  readonly settings?: Settings;
  /**
   * 今のページ番号を引く。設定が変わったとき、近いページから付け直すのに使う
   * @returns ページ番号（1 から）
   */
  readonly currentPageNumber?: () => number;
  /**
   * 読みを問い合わせる（テストで差しかえるため）
   * @param texts 文
   * @param level 段階
   * @param userDictionary 直した読み
   * @returns 文ごとのルビを付ける所
   */
  readonly readTexts?: (
    texts: readonly string[],
    level: Level,
    userDictionary: UserDictionary,
  ) => Promise<ReadingResult>;
  /** 直した読みを渡すもの（テストで差しかえるため）。既定は保存してある直した読み */
  readonly userDictionary?: UserDictionaryFeed;
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

/** ページの文と、文ごとのルビを付ける所 */
interface PageData {
  readonly page: PageText;
  readonly spans: readonly (readonly RubySpan[])[];
  /** 読みを問い合わせたときの段階 */
  readonly level: Level;
  /** 読みを問い合わせたときの直した読み */
  readonly dictionary: UserDictionary;
}

/** 読み直しが役に立たなかった理由。outdated は、待つ間にほかの読み直しや段階・直した読みの変更があったとき */
type RereadError = ReadingError | 'outdated';

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
  const readTexts =
    options.readTexts ??
    ((texts, level, userDictionary) => requestReadings(texts, { level, userDictionary }));
  const dictionaryFeed = options.userDictionary ?? storedUserDictionary;
  let settings = options.settings ?? DEFAULT_SETTINGS;
  let dictionary: UserDictionary = new Map();
  let isDictionaryChanged = false;
  // 最初の読みの問い合わせより前に、保存してある直した読みを読み終えておく（load は throw しない）
  const loadingDictionary = dictionaryFeed.load().then((loaded) => {
    if (!isDictionaryChanged) dictionary = loaded;
  });
  const isOutdated = (data: PageData): boolean =>
    data.level !== settings.level || data.dictionary !== dictionary;
  const applyStyle = (style: RubyStyle): void => {
    options.root.style.setProperty('--ruby-size', String(RUBY_SIZE_RATIOS[style.size]));
    options.root.style.setProperty('--ruby-color', RUBY_COLORS[style.color]);
    options.root.classList.toggle(RUBY_BAND_CLASS, style.hasBand);
  };
  applyStyle(settings.rubyStyle);
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
    const [content] = await Promise.all([view.pdfPage.getTextContent(), loadingDictionary]);
    const page = redirected(extractPageText(content), content, forced);
    options.onPageText?.(pageNumber, page.blocks.length > 0);
    const { level } = settings;
    const used = dictionary;
    if (page.blocks.length === 0) return { page, spans: [], level, dictionary: used };
    const startedAt = performance.now();
    const result = await readTexts(
      page.blocks.map((block) => block.text),
      level,
      used,
    );
    performance.measure(READINGS_MEASURE, { start: startedAt });
    if (!result.ok) {
      log.error('読みを出せなかったので、ルビを付けずに出します', result.error);
      entry.data = undefined;
      // 別の PDF に移った後の失敗は、新しい PDF の記録に入れない
      if (current === entries) markFailure(pageNumber, view);
      return undefined;
    }
    if (current === entries) markFailure(pageNumber, undefined);
    return { page, spans: result.value, level, dictionary: used };
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

  // 置き場所を出し直したときは、前の層の要素が古いので、層を作り直す
  const showLayer = (view: RubyPageView, entry: PageEntry, data: PageData): void => {
    if (entry.boxes === undefined) {
      const { exact } = entry;
      const { styles } = data.page;
      entry.boxes = layoutRubies(data.page.blocks, data.spans, frameOf(view.viewport), {
        sizeRatio: RUBY_SIZE_RATIOS[settings.rubyStyle.size],
        rectOf: (glyph) => exact?.get(glyph) ?? glyph.rect,
        isSerif: (glyph) =>
          isSerifFont(styles[glyph.fontName], realFontName(view.pdfPage, glyph.fontName)),
      });
      entry.layer?.remove();
      entry.layer = undefined;
    }
    entry.layer = showRubyLayer(view.div, view.viewport, entry.boxes, entry.layer);
  };

  // かたまりを blocks に置きかえ、変わったかたまりを今の段階で読み直す。段階か直した読みが変わっていれば、すべて読み直す。
  // 読めたら取っておいた文と読みを置きかえ、置き場所は次に出すときに出し直す
  const reread = async (
    pageNumber: number,
    entry: PageEntry,
    data: PageData,
    blocks: readonly TextBlock[],
  ): Promise<Result<PageData, RereadError>> => {
    const { level } = settings;
    const used = dictionary;
    const isAllOutdated = isOutdated(data);
    const targets = blocks.flatMap((block, index) =>
      isAllOutdated || block !== data.page.blocks[index] ? [{ index, block }] : [],
    );
    const result: ReadingResult =
      targets.length === 0
        ? { ok: true, value: [] }
        : await readTexts(
            targets.map(({ block }) => block.text),
            level,
            used,
          );
    if (!result.ok) return result;
    // 別の PDF に移ったとき・ほかの読み直しが先に済んだとき・段階や直した読みがまた変わったときは、古い読みで上書きしない
    if (
      entries.get(pageNumber) !== entry ||
      entry.resolved !== data ||
      level !== settings.level ||
      used !== dictionary
    ) {
      return { ok: false, error: 'outdated' };
    }
    const spans = [...data.spans];
    for (const [order, { index }] of targets.entries()) spans[index] = result.value[order] ?? [];
    const updated: PageData = {
      page: { ...data.page, blocks: [...blocks] },
      spans,
      level,
      dictionary: used,
    };
    const rebuilt = targets.filter(({ index, block }) => block !== data.page.blocks[index]);
    if (rebuilt.length > 0 && entry.exact !== undefined && entry.drawn !== undefined) {
      const exact = new Map(entry.exact);
      for (const { index } of rebuilt) {
        for (const glyph of data.page.blocks[index]?.glyphs ?? []) exact.delete(glyph);
      }
      const snapped = snapGlyphs(
        rebuilt.map(({ block }) => block),
        entry.drawn,
      );
      entry.exact = new Map([...exact, ...snapped]);
    }
    entry.resolved = updated;
    entry.data = Promise.resolve(updated);
    entry.boxes = undefined;
    return { ok: true, value: updated };
  };

  // 向きを決め直したかたまりだけ読み直し、ルビの層を置き直す。読めなかったときは、今のままにする。
  // 待つ間に段階が変わったり、ほかの読み直しが先に済んだりしたら、その新しい文に同じ向きを当てて読み直す。
  // 利用者が決めた向きを、段階の読み直しで捨てないため
  const redirect = async (
    pageNumber: number,
    wanted: (block: TextBlock) => Direction | undefined,
  ): Promise<void> => {
    const view = options.getPageView(pageNumber);
    const entry = entries.get(pageNumber);
    if (view === undefined || entry?.resolved === undefined) return;
    const rebuild = createBlockRebuilder(await view.pdfPage.getTextContent());
    for (;;) {
      const data = entry.resolved;
      if (entries.get(pageNumber) !== entry) return;
      const changes = rebuiltBlocks(data.page, rebuild, wanted);
      if (changes.length === 0) return;
      const blocks = [...data.page.blocks];
      for (const { index, block } of changes) blocks[index] = block;
      const result = await reread(pageNumber, entry, data, blocks);
      if (result.ok) {
        markUncertain(pageNumber, result.value.page);
        showLayer(view, entry, result.value);
        options.onPageShown?.(pageNumber);
        return;
      }
      if (result.error !== 'outdated') {
        log.error('向きを決め直したかたまりの読みを出せませんでした', result.error);
        return;
      }
    }
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
      // 前の段階・直した読みで読んだページは、文と字の位置はそのままに、読みだけ問い合わせ直す
      const { resolved } = entry;
      if (isOutdated(resolved)) {
        const result = await reread(event.pageNumber, entry, resolved, resolved.page.blocks);
        if (current !== entries || renders !== entry.renders) return;
        if (result.ok) {
          markFailure(event.pageNumber, undefined);
        } else if (result.error !== 'outdated') {
          // 今のルビは残し、「もう一度」で読み直せるようにする
          log.error('段階か直した読みを変えたページの読みを出せませんでした', result.error);
          markFailure(event.pageNumber, view);
        }
      }
      // 待つ間にほかの読み直しが先に済んでいたら、そちらを出す
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

    rubiesOf(pageNumber) {
      const entry = entries.get(pageNumber);
      return entry?.layer?.isConnected === true ? (entry.boxes ?? []) : [];
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

    async applySettings(next) {
      const change = settingsChange(settings, next);
      settings = next;
      applyStyle(next.rubyStyle);
      if (change.isSizeChanged) {
        for (const entry of entries.values()) entry.boxes = undefined;
      }
      if (change.isLevelChanged || change.isSizeChanged) await refreshShown();
    },

    async applyUserDictionary(next) {
      isDictionaryChanged = true;
      dictionary = next;
      await refreshShown();
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
  // 設定の画面やほかの Chrome で直した読みを変えたら、開き直さずに反映する
  dictionaryFeed.watch((next) => {
    rubyPages.applyUserDictionary(next).catch((error: unknown) => {
      log.error('変わった直した読みをルビに反映する途中で予想外の失敗がありました', error);
    });
  });
  return rubyPages;
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
