// ページを読んで、ルビの置き場所を出す。画面は触らない（画面に重ねるのは ruby-pages.ts）。
// ページの文・読み・字の位置・ルビの置き場所はページ番号ごとに取っておき、拡大・回転で描き直しても問い合わせ直さない。
// 利用者が決めた向き・直した読み・段階・大きさもここで持ち、画面に出していないページの置き場所も同じ決まりで出す。
import type { PDFPageProxy } from 'pdfjs-dist';

import { createLogger } from '@/log';
import type { ReadingError, ReadingResult } from '@/messaging/messages';
import { requestReadings } from '@/messaging/reading-client';
import { isDirectionUncertain } from '@/pdf/direction';
import { extractPageText } from '@/pdf/page-text';
import { type BlockRebuilder, createBlockRebuilder } from '@/pdf/rebuild-block';
import { isSerifFont } from '@/pdf/typeface';
import type { Direction, Glyph, PageText, PdfTextContent, Rect, TextBlock } from '@/pdf/types';
import type { Result } from '@/result';
import { DEFAULT_SETTINGS, RUBY_SIZE_RATIOS, type Settings } from '@/settings/model';
import type { RubySpan } from '@/text/annotate';
import type { Level, UserDictionary } from '@/text/types';

import type { DrawRecorder } from './draw-recorder';
import { type DrawnBox, type DrawnGlyph, snapGlyphs, toDrawnBoxes } from './glyph-snap';
import { layoutRubies, type PageFrame, type RubyBox } from './ruby-layout';
import { type SettingsChange, settingsChange } from './settings-change';
import { createFailedPages } from './special-cases';
import { invertMatrix, type Matrix, toMatrix } from './transform';
import { storedUserDictionary, type UserDictionaryFeed } from './user-dictionary-feed';

/** 読みの問い合わせにかかった時間を測る名前（performance.measure） */
export const READINGS_MEASURE = 'yomigana-pdf:readings';

/** 画面に出していないページを、字の位置を取るために描く倍率。小さくしても字の位置は変わらない */
const OFFSCREEN_SCALE = 0.5;

/** ページのうち、文と字の位置を読むのに使うところ */
export type LayoutPdfPage = Pick<PDFPageProxy, 'getTextContent' | 'commonObjs'>;

/** ページのうち、画面に出していないページを自分で描いて置き場所を出すのに使うところ */
export type DrawablePdfPage = LayoutPdfPage & Pick<PDFPageProxy, 'view' | 'getViewport' | 'render'>;

/** ページの文と、文ごとのルビを付ける所 */
export interface PageData {
  /** ページの文 */
  readonly page: PageText;
  /** かたまりごとのルビを付ける所 */
  readonly spans: readonly (readonly RubySpan[])[];
  /** 読みを問い合わせたときの段階 */
  readonly level: Level;
  /** 読みを問い合わせたときの直した読み */
  readonly dictionary: UserDictionary;
}

/** 描いた字の位置と、Canvas の画素から PDF の座標への変換 */
export interface DrawnPage {
  /** 描いた字（Canvas の画素） */
  readonly draws: readonly DrawnGlyph[];
  /** Canvas の画素から PDF の座標への変換 */
  readonly canvasToPdf: Matrix;
}

/** 置き場所を出す部品の作り方 */
export interface PageLayoutsOptions {
  /**
   * ページを引く（画面に出していないページを読むときに使う）
   * @param pageNumber ページ番号（1 から）
   * @returns ページ。PDF を開いていないときは undefined
   */
  readonly getPage: (pageNumber: number) => Promise<DrawablePdfPage | undefined>;
  /** 描いた字の位置を書き留める道具 */
  readonly recorder: DrawRecorder;
  /** 始めの設定。既定は DEFAULT_SETTINGS */
  readonly settings?: Settings;
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
}

/** ページごとにルビの置き場所を出して取っておく部品 */
export interface PageLayouts {
  /** 今の設定 */
  readonly settings: Settings;
  /**
   * ページの文と読みの用意を始める。取ってあれば、それを返す。画面に重ねる側が呼ぶ。
   * 読みを出せなかったときは、そのページを読みを出せなかったページ（画面の「もう一度」）に入れる。
   * @param pageNumber ページ番号（1 から）
   * @param pdfPage ページ
   * @returns 文と読み。読みを出せなかったときは undefined（次に呼んだときに問い合わせ直す）
   */
  prepare(pageNumber: number, pdfPage: LayoutPdfPage): Promise<PageData | undefined>;
  /**
   * 用意した文と読みを、ページの文と読みに決める。描いた字の位置があれば字の箱を合わせ、
   * 前の段階・直した読みで読んだページは、文と字の位置はそのままに、読みだけ問い合わせ直す。
   * @param pageNumber ページ番号（1 から）
   * @param data prepare で用意した文と読み
   * @param drawn 描いた字の位置（なければ undefined）
   * @param isWanted 問い合わせ直す間に、結果がいらなくなったら false を返す
   * @returns 決めた文と読み。待つ間に別の PDF に移ったか、いらなくなったときは undefined
   */
  resolve(
    pageNumber: number,
    data: PageData,
    drawn: DrawnPage | undefined,
    isWanted: () => boolean,
  ): Promise<PageData | undefined>;
  /**
   * ページのルビの置き場所を出す（出してあれば、それを返す）。
   * @param pageNumber ページ番号（1 から）
   * @param frame ページの箱
   * @param pdfPage ページ（フォントの名前を引くのに使う）
   * @returns 置き場所。文と読みをまだ決めていないページは undefined
   */
  placeRubies(
    pageNumber: number,
    frame: PageFrame,
    pdfPage: LayoutPdfPage,
  ): readonly RubyBox[] | undefined;
  /**
   * 画面に出していないページも含めて、ページのルビの置き場所を出す。描いた字の位置を取ってあればそれを使い、
   * なければ小さな Canvas に描いて字の位置を取る。画面に出していないページで読みを出せなかったときは、
   * 画面の「もう一度」に入れない（画面の「もう一度」は、画面に出したページだけを読み直すため）。
   * @param pageNumber ページ番号（1 から）
   * @returns 置き場所。読みを出せなかったとき・待つ間に別の PDF に移ったときは undefined
   */
  layoutPage(pageNumber: number): Promise<readonly RubyBox[] | undefined>;
  /**
   * 描いた字の位置に合わせてあるかを調べる。
   * @param pageNumber ページ番号（1 から）
   * @returns 合わせてあれば true（もう描いた字の位置を取らなくてよい）
   */
  hasDrawn(pageNumber: number): boolean;
  /**
   * 取ってある置き場所を引く。出し直す前なら undefined。
   * @param pageNumber ページ番号（1 から）
   * @returns 置き場所
   */
  rubiesOf(pageNumber: number): readonly RubyBox[] | undefined;
  /**
   * ページのかたまりを引く。
   * @param pageNumber ページ番号（1 から）
   * @returns 読む順のかたまり。文と読みをまだ決めていないページは空
   */
  blocksOf(pageNumber: number): readonly TextBlock[];
  /**
   * 読みを出せなかったページを挙げる。
   * @returns ページ番号（小さい順）
   */
  failedPages(): number[];
  /**
   * 1つのかたまりの向きを決め直し、そのかたまりだけ読み直す。
   * @param pageNumber ページ番号（1 から）
   * @param index ページの中のかたまりの位置
   * @param direction 決める向き
   * @param onRedirected 読み直して置き場所が変わったときに呼ぶ
   */
  setBlockDirection(
    pageNumber: number,
    index: number,
    direction: Direction,
    onRedirected: (pageNumber: number) => void,
  ): Promise<void>;
  /**
   * すべてのかたまりの向きを決める。まだ読んでいないページも、読むときにこの向きにする。
   * @param direction 決める向き
   * @param onRedirected ページを読み直して置き場所が変わるたびに呼ぶ
   */
  setAllDirection(direction: Direction, onRedirected: (pageNumber: number) => void): Promise<void>;
  /**
   * 設定を変える。大きさが変われば、取ってある置き場所を捨てる。
   * @param settings 変わったあとの設定
   * @returns やり直すこと
   */
  applySettings(settings: Settings): SettingsChange;
  /**
   * 直した読みを変える。読み直すのは、次に resolve したとき。
   * @param userDictionary 変わったあとの直した読み
   */
  applyUserDictionary(userDictionary: UserDictionary): void;
  /** 別の PDF を開くときに呼ぶ。取っておいたものを捨てる */
  reset(): void;
}

/** 読み直しが役に立たなかった理由。outdated は、待つ間にほかの読み直しや段階・直した読みの変更があったとき */
type RereadError = ReadingError | 'outdated';

/** ページごとに取っておくもの */
interface LayoutEntry {
  /** 文と読み。読みを出せなかったときは undefined にして、次に用意するときに問い合わせ直す */
  data: Promise<PageData | undefined> | undefined;
  /** 描いた位置に合わせた字の箱 */
  exact: ReadonlyMap<Glyph, Rect> | undefined;
  /** 描いた字の箱（向きを決め直したかたまりの字を合わせ直すために取っておく） */
  drawn: readonly DrawnBox[] | undefined;
  /** 決めた文と読み */
  resolved: PageData | undefined;
  /** 文を読んだページ（向きを決め直すときに読み直す） */
  pdfPage: LayoutPdfPage | undefined;
  boxes: readonly RubyBox[] | undefined;
}

const log = createLogger('ruby-layer');

/**
 * ページごとにルビの置き場所を出して取っておく部品を作る。
 * @param options 作り方
 * @returns 置き場所を出す部品
 */
export function createPageLayouts(options: PageLayoutsOptions): PageLayouts {
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
  let entries = new Map<number, LayoutEntry>();
  /** 利用者がすべてのかたまりに決めた向き。あとから読むページにも使う */
  let forced: Direction | undefined;
  // 問い合わせ直すときは、画面に重ねる側がページ番号から表示を引くので、ページ番号だけ覚える
  const failed = createFailedPages<true>();
  /** 画面に重ねる側が用意を頼んだページ。読みを出せなかったことを画面に知らせるのは、このページだけ */
  let shownPages = new Set<number>();
  const markFailure = (pageNumber: number, hasFailed: boolean): void => {
    const before = failed.size;
    if (hasFailed && !shownPages.has(pageNumber)) return;
    if (hasFailed) failed.add(pageNumber, true);
    else failed.remove(pageNumber);
    if ((before === 0) !== (failed.size === 0)) options.onReadingFailureChange?.(failed.size > 0);
  };

  const entryOf = (pageNumber: number): LayoutEntry => {
    let entry = entries.get(pageNumber);
    if (entry === undefined) {
      entry = {
        data: undefined,
        exact: undefined,
        drawn: undefined,
        resolved: undefined,
        pdfPage: undefined,
        boxes: undefined,
      };
      entries.set(pageNumber, entry);
    }
    return entry;
  };

  const load = async (
    pageNumber: number,
    pdfPage: LayoutPdfPage,
    entry: LayoutEntry,
  ): Promise<PageData | undefined> => {
    const current = entries;
    const [content] = await Promise.all([pdfPage.getTextContent(), loadingDictionary]);
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
      if (current === entries) markFailure(pageNumber, true);
      return undefined;
    }
    if (current === entries) markFailure(pageNumber, false);
    return { page, spans: result.value, level, dictionary: used };
  };

  // 文と読みは取っておき、決めるときに待つ。待つ前に失敗しても、ここでログに残して undefined にする
  const prepare = (pageNumber: number, pdfPage: LayoutPdfPage): Promise<PageData | undefined> => {
    const current = entries;
    const entry = entryOf(pageNumber);
    entry.pdfPage ??= pdfPage;
    entry.data ??= load(pageNumber, pdfPage, entry).catch((error: unknown) => {
      entry.data = undefined;
      if (current === entries) markFailure(pageNumber, true);
      // 別の PDF に移って、前の PDF のページが読めなくなったときは知らせない
      if (current === entries) log.error('ページの文字を読み出せませんでした', error);
      return undefined;
    });
    return entry.data;
  };

  // かたまりを blocks に置きかえ、変わったかたまりを今の段階で読み直す。段階か直した読みが変わっていれば、すべて読み直す。
  // 読めたら取っておいた文と読みを置きかえ、置き場所は次に出すときに出し直す
  const reread = async (
    pageNumber: number,
    entry: LayoutEntry,
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

  // 向きを決め直したかたまりだけ読み直す。読めなかったときは、今のままにする。
  // 待つ間に段階が変わったり、ほかの読み直しが先に済んだりしたら、その新しい文に同じ向きを当てて読み直す。
  // 利用者が決めた向きを、段階の読み直しで捨てないため
  const redirect = async (
    pageNumber: number,
    wanted: (block: TextBlock) => Direction | undefined,
    onRedirected: (pageNumber: number) => void,
  ): Promise<void> => {
    const entry = entries.get(pageNumber);
    if (entry?.resolved === undefined || entry.pdfPage === undefined) return;
    const rebuild = createBlockRebuilder(await entry.pdfPage.getTextContent());
    for (;;) {
      const data = entry.resolved;
      if (entries.get(pageNumber) !== entry) return;
      const changes = rebuiltBlocks(data.page, rebuild, wanted);
      if (changes.length === 0) return;
      const blocks = [...data.page.blocks];
      for (const { index, block } of changes) blocks[index] = block;
      const result = await reread(pageNumber, entry, data, blocks);
      if (result.ok) {
        onRedirected(pageNumber);
        return;
      }
      if (result.error !== 'outdated') {
        log.error('向きを決め直したかたまりの読みを出せませんでした', result.error);
        return;
      }
    }
  };

  const layouts: PageLayouts = {
    get settings() {
      return settings;
    },

    prepare(pageNumber, pdfPage) {
      shownPages.add(pageNumber);
      return prepare(pageNumber, pdfPage);
    },

    async resolve(pageNumber, data, drawn, isWanted) {
      const current = entries;
      const entry = entryOf(pageNumber);
      if (drawn !== undefined && drawn.draws.length > 0 && entry.exact === undefined) {
        entry.drawn = toDrawnBoxes(drawn.draws, drawn.canvasToPdf);
        entry.exact = snapGlyphs(data.page.blocks, entry.drawn);
        entry.boxes = undefined;
      }
      entry.resolved ??= data;
      const { resolved } = entry;
      if (isOutdated(resolved)) {
        const result = await reread(pageNumber, entry, resolved, resolved.page.blocks);
        if (current !== entries || !isWanted()) return undefined;
        if (result.ok) {
          markFailure(pageNumber, false);
        } else if (result.error !== 'outdated') {
          // 今のルビは残し、「もう一度」で読み直せるようにする
          log.error('段階か直した読みを変えたページの読みを出せませんでした', result.error);
          markFailure(pageNumber, true);
        }
      }
      // 待つ間にほかの読み直しが先に済んでいたら、そちらを返す
      return entry.resolved;
    },

    placeRubies(pageNumber, frame, pdfPage) {
      const entry = entries.get(pageNumber);
      const data = entry?.resolved;
      if (entry === undefined || data === undefined) return undefined;
      if (entry.boxes === undefined) {
        const { exact } = entry;
        const { styles } = data.page;
        entry.boxes = layoutRubies(data.page.blocks, data.spans, frame, {
          sizeRatio: RUBY_SIZE_RATIOS[settings.rubyStyle.size],
          rectOf: (glyph) => exact?.get(glyph) ?? glyph.rect,
          isSerif: (glyph) =>
            isSerifFont(styles[glyph.fontName], realFontName(pdfPage, glyph.fontName)),
        });
      }
      return entry.boxes;
    },

    async layoutPage(pageNumber) {
      const current = entries;
      const pdfPage = await options.getPage(pageNumber);
      if (pdfPage === undefined || current !== entries) return undefined;
      const data = await prepare(pageNumber, pdfPage);
      if (data === undefined || current !== entries) return undefined;
      const isDrawNeeded = entryOf(pageNumber).exact === undefined && data.page.blocks.length > 0;
      const drawn = isDrawNeeded ? await drawOffscreen(pdfPage, options.recorder) : undefined;
      if (current !== entries) return undefined;
      const resolved = await layouts.resolve(pageNumber, data, drawn, () => current === entries);
      if (resolved === undefined) return undefined;
      return layouts.placeRubies(pageNumber, frameOfPage(pdfPage), pdfPage);
    },

    hasDrawn(pageNumber) {
      return entries.get(pageNumber)?.exact !== undefined;
    },

    rubiesOf(pageNumber) {
      return entries.get(pageNumber)?.boxes;
    },

    blocksOf(pageNumber) {
      return entries.get(pageNumber)?.resolved?.page.blocks ?? [];
    },

    failedPages() {
      return failed.list().map(([pageNumber]) => pageNumber);
    },

    async setBlockDirection(pageNumber, index, direction, onRedirected) {
      const target = entries.get(pageNumber)?.resolved?.page.blocks[index];
      await redirect(
        pageNumber,
        (block) => (block === target ? direction : undefined),
        onRedirected,
      );
    },

    async setAllDirection(direction, onRedirected) {
      forced = direction;
      await Promise.all(
        [...entries.keys()].map((pageNumber) =>
          redirect(pageNumber, (block) => forcedDirection(block, direction), onRedirected),
        ),
      );
    },

    applySettings(next) {
      const change = settingsChange(settings, next);
      settings = next;
      if (change.isSizeChanged) {
        for (const entry of entries.values()) entry.boxes = undefined;
      }
      return change;
    },

    applyUserDictionary(next) {
      isDictionaryChanged = true;
      dictionary = next;
    },

    reset() {
      entries = new Map();
      forced = undefined;
      shownPages = new Set();
      failed.clear();
      options.onReadingFailureChange?.(false);
    },
  };
  return layouts;
}

/**
 * 画面に出していないページを小さな Canvas に描き、描いた字の位置を取る。
 * @param pdfPage ページ
 * @param recorder 描いた字の位置を書き留める道具
 * @returns 描いた字の位置。変換を作れないときは undefined
 */
async function drawOffscreen(
  pdfPage: DrawablePdfPage,
  recorder: DrawRecorder,
): Promise<DrawnPage | undefined> {
  const viewport = pdfPage.getViewport({ scale: OFFSCREEN_SCALE, rotation: 0 });
  const canvasToPdf = invertMatrix(toMatrix(viewport.transform));
  if (canvasToPdf === undefined) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  let draws: readonly DrawnGlyph[];
  recorder.watch(canvas);
  try {
    await pdfPage.render({ canvas, viewport }).promise;
  } finally {
    draws = recorder.take(canvas);
    // 描いた絵はいらないので、すぐにメモリを返す
    canvas.width = 0;
    canvas.height = 0;
  }
  return { draws, canvasToPdf };
}

/**
 * フォント自身の名前を引く。描き終えたあとなら、pdf.js が読み込んだフォントの名前が取れる。
 * @param pdfPage ページ
 * @param fontName getTextContent() の styles の鍵
 * @returns フォントの名前。まだ読み込めていないときは undefined
 */
function realFontName(pdfPage: LayoutPdfPage, fontName: string): string | undefined {
  if (!pdfPage.commonObjs.has(fontName)) return undefined;
  const font = pdfPage.commonObjs.get(fontName) as { name?: unknown } | undefined;
  return typeof font?.name === 'string' ? font.name : undefined;
}

/**
 * ページの箱（PDF の座標）を引く。
 * @param pdfPage ページ
 * @returns ページの箱（pdf.js の view）
 */
function frameOfPage(pdfPage: Pick<PDFPageProxy, 'view'>): PageFrame {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = pdfPage.view;
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
