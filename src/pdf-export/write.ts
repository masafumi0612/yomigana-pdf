// ルビを書き込んだ新しい PDF を作る。pdf-lib と fontkit はこのファイルだけで使う（呼ぶ側は動的 import で読む）。
// ルビは字ではなく字の形（線）で描く。コピーや読み上げにルビが混ざらないようにするため。
// 同じ字の形は Form XObject として1回だけ PDF に入れ、置くたびに大きさと位置だけ変えて使い回す。
// RubyBox の長さはページの箱（pdf.js の view）の左上からの PDF の単位で、回す前の向きなので、
// ページの /Rotate に関わらず、そのページのもとの座標にそのまま書けばよい。
// pdf-lib は、もとのページの中身を q … Q で囲んでから書き足すので、もとの中身が座標を変えたままでもずれない。
import type { Font, Glyph } from '@pdf-lib/fontkit';
import fontkit from '@pdf-lib/fontkit';
import {
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  drawObject,
  fill,
  lineTo,
  moveTo,
  PDFDocument,
  type PDFName,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
} from 'pdf-lib';

import type { Result } from '@/result';
import type { PageFrame, RubyBox } from '@/viewer/ruby-layout';

import { type GlyphAdvance, type GlyphFrame, lineBaseline, placeGlyphs } from './glyph-placement';

/** 書き込む1つのルビ（RubyBox のうち、字を並べるのに使うところ） */
export type RubyGlyphBox = Pick<
  RubyBox,
  'ruby' | 'isVertical' | 'isSpread' | 'isSerif' | 'left' | 'top' | 'width' | 'height' | 'fontSize'
>;

/** 書き込む1ページ分 */
export interface RubyPageInput {
  /** ページの位置（0 から） */
  readonly pageIndex: number;
  /** ページの箱（pdf.js の page.view と同じ。PDF の座標） */
  readonly frame: PageFrame;
  /** 置くルビ */
  readonly boxes: readonly RubyGlyphBox[];
}

/** ルビの見た目 */
export interface RubyPdfStyle {
  /** ルビの色（#rrggbb） */
  readonly color: string;
  /** ルビの下に白い帯を敷くなら true */
  readonly hasBand: boolean;
}

/** ルビのフォント（woff2 か TTF・OTF のファイルの中身） */
export interface RubyFonts {
  /** 明朝 */
  readonly serif: Uint8Array;
  /** ゴシック */
  readonly sans: Uint8Array;
}

/** PDF を開けなかった理由。encrypted はパスワードや権限の制限（暗号化）がある PDF */
export type RubyPdfOpenError = 'encrypted' | 'unreadable';

/** ルビを書き込む途中の PDF */
export interface RubyPdfWriter {
  /** ページの数 */
  readonly pageCount: number;
  /**
   * 1ページにルビを書き込む。
   * @param input ページとルビ
   */
  addPage(input: RubyPageInput): void;
  /**
   * 書き込んだ PDF をバイト列にする。
   * @param title PDF の題名（/Title）。渡さなければ、もとの PDF の題名のまま
   * @returns 新しい PDF
   */
  save(title?: string): Promise<Uint8Array>;
}

/** 帯の色（白） */
const BAND_RGB = [1, 1, 1] as const;
/** 縦書きの字の原点（字の枠の上の端からの長さ。字の大きさに対する割合）。scripts/build-ruby-fonts.ts と同じ */
const VERTICAL_ORIGIN_EM = 0.88;
/** 字の形の座標を丸める桁（フォントの単位で 0.1） */
const OUTLINE_PRECISION = 10;
/** 置く位置を丸める桁（PDF の単位で 0.001） */
const POSITION_PRECISION = 1000;
/** 大きさの倍率を丸める桁 */
const SCALE_PRECISION = 1_000_000;
/** 2次のベジエ曲線を3次にするときの、制御点の位置の割合 */
const QUADRATIC_TO_CUBIC = 2 / 3;
/** ページの XObject の名前の頭 */
const XOBJECT_TAG = 'Ruby';
/** 色の1つの成分の最大 */
const CHANNEL_MAX = 0xff;

/** 1つのフォントの、字の形を引く道具 */
interface FontEntry {
  readonly kit: Font;
  readonly frame: GlyphFrame;
  /** 字と向きごとの字形（なければ undefined） */
  readonly glyphs: Map<string, Glyph | undefined>;
}

/** fontkit の字の形を受け取る道具（Path.toFunction が呼ぶ） */
interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
}

/**
 * ルビを書き込むために PDF を開く。暗号化した PDF は、pdf-lib が復号も暗号化もしないので開かない。
 * @param source もとの PDF
 * @param style ルビの見た目
 * @param fonts ルビのフォント
 * @returns 書き込む途中の PDF。開けないときはその理由
 */
export async function openRubyPdf(
  source: Uint8Array,
  style: RubyPdfStyle,
  fonts: RubyFonts,
): Promise<Result<RubyPdfWriter, RubyPdfOpenError>> {
  let document: PDFDocument;
  try {
    // 暗号化を確かめるため、読むときは止めずに読み、あとで isEncrypted を見る
    document = await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  if (document.isEncrypted) return { ok: false, error: 'encrypted' };
  const pages = document.getPages();
  const color = hexToRgb(style.color);
  const entries = new Map<boolean, FontEntry>();
  const fontOf = (isSerif: boolean): FontEntry => {
    let entry = entries.get(isSerif);
    if (entry === undefined) {
      entry = openFont(isSerif ? fonts.serif : fonts.sans);
      entries.set(isSerif, entry);
    }
    return entry;
  };
  /** 字の形ごとに入れた Form XObject（フォントと字形の番号ごと。縦書きの字形は番号が違うので別になる） */
  const shapes = new Map<string, PDFRef | undefined>();
  const shapeOf = (isSerif: boolean, glyph: Glyph): PDFRef | undefined => {
    const key = `${String(isSerif)}:${String(glyph.id)}`;
    if (!shapes.has(key)) shapes.set(key, registerShape(document, glyph));
    return shapes.get(key);
  };

  return {
    ok: true,
    value: {
      pageCount: pages.length,
      addPage(input) {
        const page = pages[input.pageIndex];
        if (page === undefined || input.boxes.length === 0) return;
        const operators: PDFOperator[] = [pushGraphicsState()];
        if (style.hasBand) operators.push(...bandOperators(input));
        operators.push(setFillingRgbColor(...color));
        const names = new Map<PDFRef, PDFName>();
        for (const box of input.boxes) {
          const font = fontOf(box.isSerif);
          const chars = Array.from(box.ruby);
          const glyphs = chars.map((ch) => glyphOf(font, ch, box.isVertical));
          const advances = glyphs.map((glyph) => advanceOf(font.kit, glyph));
          const placements = placeGlyphs(box, advances, font.frame);
          const scale = round(box.fontSize / font.kit.unitsPerEm, SCALE_PRECISION);
          for (const [index, glyph] of glyphs.entries()) {
            const placement = placements[index];
            const ref = glyph === undefined ? undefined : shapeOf(box.isSerif, glyph);
            if (placement === undefined || ref === undefined) continue;
            const name = nameOf(page, names, ref);
            const x = round(input.frame.pageX + placement.x, POSITION_PRECISION);
            const y = round(
              input.frame.pageY + input.frame.pageHeight - placement.y,
              POSITION_PRECISION,
            );
            operators.push(
              pushGraphicsState(),
              concatTransformationMatrix(scale, 0, 0, scale, x, y),
              drawObject(name),
              popGraphicsState(),
            );
          }
        }
        operators.push(popGraphicsState());
        page.pushOperators(...operators);
      },
      save: (title) => {
        // 標準の表示がタブの名前に題名を出すよう、ViewerPreferences の DisplayDocTitle も付ける
        if (title !== undefined) document.setTitle(title, { showInWindowTitleBar: true });
        return document.save();
      },
    },
  };
}

/**
 * フォントを開き、基準の位置を出す。
 * @param data フォントのファイル
 * @returns 字の形を引く道具
 */
function openFont(data: Uint8Array): FontEntry {
  const kit = fontkit.create(data);
  // fontkit の ascent・descent は hhea の値（ルビの2つのフォントは OS/2 も同じ値）
  const ascent = kit.ascent / kit.unitsPerEm;
  const descent = -kit.descent / kit.unitsPerEm;
  return {
    kit,
    frame: { baseline: lineBaseline(ascent, descent), verticalOrigin: VERTICAL_ORIGIN_EM },
    glyphs: new Map(),
  };
}

/**
 * 字の字形を引く。縦書きは、フォントの縦書きの字形（GSUB の vert）にする。
 * @param font フォント
 * @param ch 字
 * @param isVertical 縦書きなら true
 * @returns 字形。フォントにない字は undefined
 */
function glyphOf(font: FontEntry, ch: string, isVertical: boolean): Glyph | undefined {
  const key = `${String(isVertical)}:${ch}`;
  if (!font.glyphs.has(key)) {
    const [glyph] = font.kit.layout(ch, isVertical ? ['vert'] : []).glyphs;
    font.glyphs.set(key, glyph === undefined || glyph.id === 0 ? undefined : glyph);
  }
  return font.glyphs.get(key);
}

/**
 * 字の送り（字の大きさに対する割合）。フォントにない字は1字分とする。
 * @param kit フォント
 * @param glyph 字形
 * @returns 横と縦の送り
 */
function advanceOf(kit: Font, glyph: Glyph | undefined): GlyphAdvance {
  if (glyph === undefined) return { horizontal: 1, vertical: 1 };
  // ルビのフォントは、縦書きの送りの表（vmtx）でどの字も1字の送り
  return { horizontal: glyph.advanceWidth / kit.unitsPerEm, vertical: 1 };
}

/**
 * 字の形を Form XObject として PDF に入れる。座標はフォントの単位のままにし、置くときに縮める。
 * 色は置く側の色を使う（Form XObject は呼んだ側の描き方を受け継ぐ）。
 * @param document PDF
 * @param glyph 字形
 * @returns 入れた Form XObject。形のない字は undefined
 */
function registerShape(document: PDFDocument, glyph: Glyph): PDFRef | undefined {
  const operators = outlineOperators(glyph);
  if (operators.length === 0) return undefined;
  const box = glyph.path.cbox;
  const stream = document.context.formXObject([...operators, fill()], {
    BBox: [Math.floor(box.minX), Math.floor(box.minY), Math.ceil(box.maxX), Math.ceil(box.maxY)],
  });
  return document.context.register(stream);
}

/**
 * 字の形を、PDF の線の命令にする。
 * @param glyph 字形
 * @returns 線の命令（フォントの単位）
 */
function outlineOperators(glyph: Glyph): PDFOperator[] {
  const operators: PDFOperator[] = [];
  const at = (value: number): number => round(value, OUTLINE_PRECISION);
  let last = { x: 0, y: 0 };
  const sink: PathSink = {
    moveTo(x, y) {
      operators.push(moveTo(at(x), at(y)));
      last = { x, y };
    },
    lineTo(x, y) {
      operators.push(lineTo(at(x), at(y)));
      last = { x, y };
    },
    // PDF には2次のベジエ曲線がないので、同じ形の3次にする
    quadraticCurveTo(cx, cy, x, y) {
      operators.push(
        appendBezierCurve(
          at(last.x + QUADRATIC_TO_CUBIC * (cx - last.x)),
          at(last.y + QUADRATIC_TO_CUBIC * (cy - last.y)),
          at(x + QUADRATIC_TO_CUBIC * (cx - x)),
          at(y + QUADRATIC_TO_CUBIC * (cy - y)),
          at(x),
          at(y),
        ),
      );
      last = { x, y };
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      operators.push(appendBezierCurve(at(c1x), at(c1y), at(c2x), at(c2y), at(x), at(y)));
      last = { x, y };
    },
    closePath() {
      operators.push(closePath());
    },
  };
  // fontkit の型は toFunction の戻り値を Function としか書いていない
  const trace = glyph.path.toFunction() as (sink: PathSink) => void;
  trace(sink);
  return operators;
}

/**
 * ルビの箱に白い帯を塗る命令を作る。帯は字より先に塗る。
 * @param input ページとルビ
 * @returns 命令
 */
function bandOperators(input: RubyPageInput): PDFOperator[] {
  const { frame } = input;
  const operators: PDFOperator[] = [setFillingRgbColor(...BAND_RGB)];
  for (const box of input.boxes) {
    operators.push(
      rectangle(
        round(frame.pageX + box.left, POSITION_PRECISION),
        round(frame.pageY + frame.pageHeight - box.top - box.height, POSITION_PRECISION),
        round(box.width, POSITION_PRECISION),
        round(box.height, POSITION_PRECISION),
      ),
    );
  }
  operators.push(fill());
  return operators;
}

/**
 * ページの中での Form XObject の名前を引く。まだなければ、ページの資源に足す。
 * @param page ページ
 * @param names このページで付けた名前
 * @param ref Form XObject
 * @returns 名前
 */
function nameOf(page: PDFPage, names: Map<PDFRef, PDFName>, ref: PDFRef): PDFName {
  let name = names.get(ref);
  if (name === undefined) {
    name = page.node.newXObject(XOBJECT_TAG, ref);
    names.set(ref, name);
  }
  return name;
}

/**
 * #rrggbb を 0〜1 の3つの成分にする。
 * @param hex 色
 * @returns 赤・緑・青
 */
function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => ((value >> shift) & CHANNEL_MAX) / CHANNEL_MAX;
  return [channel(16), channel(8), channel(0)];
}

/**
 * 数を丸める（PDF を小さくするため）。
 * @param value 数
 * @param precision 1 をいくつに分けるか
 * @returns 丸めた数
 */
function round(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}
