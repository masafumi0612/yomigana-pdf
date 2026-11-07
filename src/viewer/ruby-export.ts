// 開いている PDF の全部のページにルビを書き込んだ、新しい PDF を作る（画面の入口は ruby-export-ui.ts）。
// ページごとの置き場所は page-layout.ts の layoutPage で出すので、画面に出していないページも
// 画面と同じ設定・同じ直した読み・同じ向きで置く。書き込み（pdf-lib・fontkit）は、使うときだけ読む。
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

import sansUrl from '@/assets/fonts/ruby-sans.woff2?url';
import serifUrl from '@/assets/fonts/ruby-serif.woff2?url';
import type { RubyFonts } from '@/pdf-export/write';
import type { Result } from '@/result';
import { RUBY_COLORS } from '@/settings/model';

import type { PageLayouts } from './page-layout';
import type { PageFrame } from './ruby-layout';

/** 作れなかった理由。encrypted は暗号化した PDF、unreadable は書き込むために読めない PDF、aborted は止めたとき */
export type RubyExportError = 'encrypted' | 'unreadable' | 'aborted';

/** 作った PDF */
export interface RubyExport {
  /** 新しい PDF */
  readonly bytes: Uint8Array;
  /** 読みを出せず、ルビを付けずに作ったページ（ページ番号。小さい順） */
  readonly failedPages: readonly number[];
}

/** PDF の作り方 */
export interface RubyExportOptions {
  /** 開いている PDF */
  readonly document: Pick<PDFDocumentProxy, 'numPages' | 'getData'> & {
    getPage(pageNumber: number): Promise<Pick<PDFPageProxy, 'view'>>;
  };
  /** ページのルビの置き場所を出す部品（画面と同じもの） */
  readonly layouts: Pick<PageLayouts, 'layoutPage' | 'settings'>;
  /**
   * 1ページ済むごとに呼ぶ
   * @param done 済んだページの数
   * @param total ページの数
   */
  readonly onProgress?: (done: number, total: number) => void;
  /** 止めるときに知らせるもの */
  readonly signal?: AbortSignal;
  /** 新しい PDF の題名（/Title）。渡さなければ、もとの PDF の題名のまま */
  readonly title?: string;
  /**
   * ルビのフォントを読む（テストで差しかえるため）。既定は拡張に入れたフォント
   * @returns フォント
   */
  readonly loadFonts?: () => Promise<RubyFonts>;
}

/**
 * 開いている PDF の全部のページに、画面と同じルビを書き込んだ新しい PDF を作る。
 * 読みを出せなかったページは、ルビを付けずに作り、そのページを結果で返す。
 * @param options 作り方
 * @returns 作った PDF。作れなかったときはその理由
 */
export async function exportRubyPdf(
  options: RubyExportOptions,
): Promise<Result<RubyExport, RubyExportError>> {
  const { document, layouts, signal } = options;
  const isAborted = (): boolean => signal?.aborted === true;
  if (isAborted()) return { ok: false, error: 'aborted' };
  const { rubyStyle } = layouts.settings;
  // 置き場所を出す前に開いて、暗号化した PDF は待たせずに断る
  const [source, { openRubyPdf }, fonts] = await Promise.all([
    document.getData(),
    import('@/pdf-export/write'),
    (options.loadFonts ?? loadRubyFonts)(),
  ]);
  const opened = await openRubyPdf(
    source,
    { color: RUBY_COLORS[rubyStyle.color], hasBand: rubyStyle.hasBand },
    fonts,
  );
  if (!opened.ok) return opened;
  const writer = opened.value;
  const failedPages: number[] = [];
  const total = document.numPages;
  for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
    if (isAborted()) return { ok: false, error: 'aborted' };
    const boxes = await layouts.layoutPage(pageNumber);
    if (boxes === undefined) {
      failedPages.push(pageNumber);
    } else {
      const { view } = await document.getPage(pageNumber);
      writer.addPage({ pageIndex: pageNumber - 1, frame: frameOf(view), boxes });
    }
    options.onProgress?.(pageNumber, total);
  }
  if (isAborted()) return { ok: false, error: 'aborted' };
  return { ok: true, value: { bytes: await writer.save(options.title), failedPages } };
}

/**
 * 拡張に入れたルビのフォントを読む。
 * @returns フォント
 */
async function loadRubyFonts(): Promise<RubyFonts> {
  const [serif, sans] = await Promise.all([fetchBytes(serifUrl), fetchBytes(sansUrl)]);
  return { serif, sans };
}

/**
 * 拡張の中のファイルを読む。
 * @param url URL
 * @returns 中身
 */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`ルビのフォントを読めませんでした（${String(response.status)}）`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * ページの箱（pdf.js の view）を、RubyBox の基準の箱にする。
 * @param view ページの箱（PDF の座標）
 * @returns ページの箱
 */
function frameOf(view: readonly number[]): PageFrame {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = view;
  return { pageX: x1, pageY: y1, pageWidth: x2 - x1, pageHeight: y2 - y1 };
}
