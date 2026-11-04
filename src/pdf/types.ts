// PDF の文字の片から、読む順の文を組み立てるときに受け渡す形。
// 座標は PDF の座標（左下が原点、y は上向き）。

/** pdf.js の TextItem のうち、使うところ */
export interface PdfTextItem {
  /** 片の文字 */
  readonly str: string;
  /** 書く向き。縦書きのフォントの片は 'ttb' */
  readonly dir: string;
  /** 変換の行列 [a, b, c, d, x, y]。字の大きさを含む */
  readonly transform: readonly number[];
  /** 片の幅 */
  readonly width: number;
  /** 片の高さ */
  readonly height: number;
  /** フォントの名前（styles の鍵） */
  readonly fontName: string;
}

/** pdf.js の TextMarkedContent（文字のない印）のうち、使うところ */
export interface PdfMarkedContent {
  readonly type: string;
}

/** pdf.js の TextStyle のうち、使うところ */
export interface PdfTextStyle {
  /** 縦書きのフォントか */
  readonly vertical?: boolean;
}

/** pdf.js の getTextContent() の結果のうち、使うところ */
export interface PdfTextContent {
  /** 文字の片。文字のない印も混じる */
  readonly items: readonly (PdfTextItem | PdfMarkedContent)[];
  /** フォントの名前ごとの書き方 */
  readonly styles: Readonly<Record<string, PdfTextStyle>>;
}

/** 長方形 */
export interface Rect {
  /** 左の端 */
  readonly x1: number;
  /** 下の端 */
  readonly y1: number;
  /** 右の端 */
  readonly x2: number;
  /** 上の端 */
  readonly y2: number;
}

/** 字の並ぶ向き */
export type Direction = 'vertical' | 'horizontal';

/** 1つの字 */
export interface Glyph {
  /** PDF の中の字 */
  readonly ch: string;
  /** 判定に使う NFKC の形。NFKC で1字にならないときは ch のまま */
  readonly norm: string;
  /** 字の箱 */
  readonly rect: Rect;
  /** 字の大きさ */
  readonly size: number;
  /** PDF の中に、この字のルビがもとからあるか */
  readonly hasRuby: boolean;
}

/** PDF の中にもとからあるルビ */
export interface ExistingRuby {
  /** 親字の始まり（かたまりの glyphs の位置） */
  readonly start: number;
  /** 親字の終わりの次（かたまりの glyphs の位置） */
  readonly end: number;
  /** ルビの文字（空白を除く） */
  readonly reading: string;
}

/** 1つのかたまり（段落・見出し・表の欄・囲みなど） */
export interface TextBlock {
  /** 行をつないだ文（もとからあるルビと空白を除く） */
  readonly text: string;
  /** 読む順の字 */
  readonly glyphs: readonly Glyph[];
  /** text の各字（UTF-16 の1単位ごと）が当たる glyphs の位置 */
  readonly glyphIndexOfChar: readonly number[];
  /** 字の並ぶ向き */
  readonly direction: Direction;
  /** 向きの推定の自信（0〜1）。縦書きの印や、横に並ぶ字の片から分かるときは 1 */
  readonly confidence: number;
  /** もとからあるルビ */
  readonly rubies: readonly ExistingRuby[];
  /** かたまりの箱 */
  readonly rect: Rect;
}

/** 1ページを組み立てた結果 */
export interface PageText {
  /** 読む順のかたまり */
  readonly blocks: readonly TextBlock[];
}
