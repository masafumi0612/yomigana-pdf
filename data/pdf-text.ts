import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** PDF の文字の1かたまり（座標は PDF の点。y は下から上へ増える） */
export interface PdfTextItem {
  /** NFKC で正規化した文字 */
  str: string;
  x: number;
  y: number;
  /** かたまりの横の長さ */
  w: number;
  /** 文字の大きさ */
  size: number;
}

const pdfjsDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/**
 * PDF のファイルを開く。
 * @param file PDF のファイルの場所
 * @returns 開いた PDF
 */
export async function openPdf(file: string): Promise<PDFDocumentProxy> {
  return getDocument({
    data: new Uint8Array(readFileSync(file)),
    // 文字の対応表は、日本語の PDF の文字を取り出すのに要る
    cMapUrl: join(pdfjsDir, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(pdfjsDir, 'standard_fonts') + '/',
  }).promise;
}

/**
 * 1ページの文字のかたまりを取り出す。空白だけのかたまりは捨てる。
 * @param doc 開いた PDF
 * @param pageNumber ページの番号（1から）
 * @returns 文字のかたまりの一覧（PDF の中の順）
 */
export async function readPageItems(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfTextItem[]> {
  const { items } = await (await doc.getPage(pageNumber)).getTextContent();
  const result: PdfTextItem[] = [];
  for (const item of items) {
    if (!('str' in item) || item.str.trim() === '') continue;
    const [a = 0, b = 0, , , x = 0, y = 0] = item.transform as number[];
    result.push({ str: item.str.normalize('NFKC'), x, y, w: item.width, size: Math.hypot(a, b) });
  }
  return result;
}
