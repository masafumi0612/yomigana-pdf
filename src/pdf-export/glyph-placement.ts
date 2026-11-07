// ルビの箱の中に、字をどう並べるかを出す。画面のルビの層（style.css の .ruby-layer）と同じ並べ方にする。
//   箱は flex で、字は行の向きに中寄せ（justify-content: center）、均等のときは space-around。
//   行の高さは line-height: 1 なので、字の枠（1字）は箱の太さの真ん中に来る。
// DOM は使わず、字の送りと基準線の位置（フォントから出したもの）だけで計算する。

/** 字を並べる箱。長さはページの左上からの PDF の単位（RubyBox と同じ） */
export interface GlyphBox {
  /** 縦書き（上から下へ並べる）なら true */
  readonly isVertical: boolean;
  /** 字を箱の長さに均等に並べるなら true（CSS の space-around） */
  readonly isSpread: boolean;
  /** 左の端 */
  readonly left: number;
  /** 上の端 */
  readonly top: number;
  /** 幅 */
  readonly width: number;
  /** 高さ */
  readonly height: number;
  /** 字の大きさ */
  readonly fontSize: number;
}

/** 1字の送り（字の大きさに対する割合） */
export interface GlyphAdvance {
  /** 横の送り（横書きで並べる長さ。縦書きでは、列の真ん中に字を置くのに使う） */
  readonly horizontal: number;
  /** 縦の送り（縦書きで並べる長さ） */
  readonly vertical: number;
}

/** フォントの、字の枠の中の基準の位置（字の大きさに対する割合） */
export interface GlyphFrame {
  /** 横書き：line-height: 1 の行の上の端から、基準線までの長さ */
  readonly baseline: number;
  /** 縦書き：字の枠の上の端から、字の原点（縦書きの送りの始まり）までの長さ */
  readonly verticalOrigin: number;
}

/** 1字を置く所。ページの左上からの PDF の単位（下へ向かって増える） */
export interface GlyphPlacement {
  /** 字の原点（横の送りの始まり）の x */
  readonly x: number;
  /** 字の基準線の y */
  readonly y: number;
}

/**
 * 字を、行の向きに並べる。CSS の flex の justify-content（center か space-around）と同じ並べ方。
 * flex の決まりでは、space-around は、はみ出すときと字が1つのときに center と同じになる。
 * center は、はみ出すときも両側へ等しくはみ出す。
 * @param advances 字ごとの送り（行の向きの長さ）
 * @param length 箱の、行の向きの長さ
 * @param isSpread 均等に並べるなら true
 * @returns 字ごとの、箱の頭から字の頭までの長さ
 */
export function alongOffsets(
  advances: readonly number[],
  length: number,
  isSpread: boolean,
): number[] {
  const total = advances.reduce((sum, advance) => sum + advance, 0);
  const free = length - total;
  const gap = isSpread && free > 0 && advances.length > 1 ? free / advances.length : 0;
  let at = gap > 0 ? gap / 2 : free / 2;
  return advances.map((advance) => {
    const start = at;
    at += advance + gap;
    return start;
  });
}

/**
 * 箱の中の字ごとの置き場所を出す。
 * @param box 字を並べる箱
 * @param advances 字ごとの送り（字の大きさに対する割合）
 * @param frame フォントの基準の位置
 * @returns 字ごとの置き場所（advances と同じ順）
 */
export function placeGlyphs(
  box: GlyphBox,
  advances: readonly GlyphAdvance[],
  frame: GlyphFrame,
): GlyphPlacement[] {
  const size = box.fontSize;
  if (box.isVertical) {
    const offsets = alongOffsets(
      advances.map((advance) => advance.vertical * size),
      box.height,
      box.isSpread,
    );
    // 列の幅は1字（line-height: 1）で、箱の幅の真ん中に来る。字は列の真ん中に、横の送りの真ん中を合わせる
    const center = box.left + box.width / 2;
    return advances.map((advance, index) => ({
      x: center - (advance.horizontal * size) / 2,
      y: box.top + (offsets[index] ?? 0) + frame.verticalOrigin * size,
    }));
  }
  const offsets = alongOffsets(
    advances.map((advance) => advance.horizontal * size),
    box.width,
    box.isSpread,
  );
  // 行の高さは1字で、箱の高さの真ん中に来る
  const lineTop = box.top + (box.height - size) / 2;
  return advances.map((_, index) => ({
    x: box.left + (offsets[index] ?? 0),
    y: lineTop + frame.baseline * size,
  }));
}

/**
 * line-height: 1 の行の上の端から基準線までの長さを出す。CSS は、字の上下の高さ（ascent + descent）と
 * 行の高さ（1字）の差を、上下に等しく分ける。
 * @param ascent 字の上の高さ（字の大きさに対する割合）
 * @param descent 字の下の高さ（字の大きさに対する割合。正の数）
 * @returns 行の上の端から基準線までの長さ（字の大きさに対する割合）
 */
export function lineBaseline(ascent: number, descent: number): number {
  return (1 + ascent - descent) / 2;
}
