// pdf.js の文字のかたまりを、読む順の行（縦書きの列・横書きの行）と段落に組み直す。
// 作った PDF を確かめるためだけの、簡単なもの（試作のビューアの処理を移した）。
// 座標は PDF の座標（左下が原点、y は上向き）。

/** pdf.js の TextItem のうち、ここで使うところ */
export interface TextItemLike {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
}

/** 長方形（PDF の座標） */
export interface Rect {
  x1: number;
  /** 下の端 */
  y1: number;
  x2: number;
  /** 上の端 */
  y2: number;
}

/** 1つの字 */
export interface Glyph {
  ch: string;
  /** 調べるときに使う NFKC の形（NFKC で長さが変わるときは ch のまま） */
  norm: string;
  rect: Rect;
  /** PDF の中ですでにルビが付いているか */
  hasRuby: boolean;
}

/** 1つの行（縦書きなら列） */
export interface Line {
  vertical: boolean;
  size: number;
  glyphs: Glyph[];
  /** 縦書きは列の中心、横書きは左の端 */
  x: number;
  top: number;
  bottom: number;
  right: number;
}

/** pdf.js の1つのかたまり（同じ向き・同じ大きさの字の並び） */
export interface TextRun {
  vertical: boolean;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
}

/** 1ページを組み直した結果 */
export interface PageLayout {
  lines: Line[];
  /** PDF の中にもとからあるルビ */
  existingRuby: TextRun[];
}

/** 段落（同じ向きの行をつないだもの） */
export interface Paragraph {
  vertical: boolean;
  glyphs: Glyph[];
}

const SPACE = /[ \u3000]/;
const KANA_ONLY = /^[ぁ-ゖァ-ヺー・ \u3000]+$/;
// 回っているかを見る、変換の行列の傾きの下限
const ROTATION_EPSILON = 0.01;
// 横書きの字の箱：基準線から下に 0.12 em、上に 0.88 em
const DESCENT_EM = 0.12;
const ASCENT_EM = 0.88;
// ルビの字は親字の 1/1.6 以下の大きさ
const RUBY_SIZE_RATIO = 1.6;
// ルビの位置の許し（em）
const RUBY_SIDE_TOLERANCE_EM = 0.4;
const RUBY_ABOVE_MIN_EM = 0.5;
const RUBY_ABOVE_MAX_EM = 1.4;
// 横書きのルビが親字からはみ出してよい長さ（ルビの字の em）
const RUBY_OVERHANG_EM = 0.5;
// 同じ列・同じ行と見なす位置のずれ（em）
const SAME_COLUMN_EM = 0.3;
const COLUMN_GAP_EM = 2;
const SAME_ROW_EM = 0.3;
const ROW_GAP_EM = 2;
// 縦中横と見なす、横書きのかたまりの長さの上限と位置のずれ
const TCY_MAX_LENGTH = 3;
const TCY_CENTER_EM = 0.5;
// 横の区切りを縦の区切りより先に使う、すきまの比
const HORIZONTAL_CUT_RATIO = 2;
// これより短い列は段落の終わりと見なす（いちばん長い列に対する比）
const SHORT_LINE_RATIO = 0.6;
const PARAGRAPH_END = /[。」）]/;

const normalize = (c: string): string => {
  const n = c.normalize('NFKC');
  return n.length === 1 ? n : c;
};

/** かたまりを1字ずつに分け、それぞれの箱を見積もる */
function glyphsOf(run: TextRun): Glyph[] {
  const chars = Array.from(run.str).filter((c) => !SPACE.test(c));
  if (!chars.length) return [];
  if (run.vertical) {
    const pitch = run.h / chars.length;
    return chars.map((ch, k) => ({
      ch,
      norm: normalize(ch),
      hasRuby: false,
      rect: {
        x1: run.x - run.size / 2,
        x2: run.x + run.size / 2,
        y2: run.y - k * pitch,
        y1: run.y - (k + 1) * pitch,
      },
    }));
  }
  const pitch = run.w / chars.length;
  return chars.map((ch, k) => ({
    ch,
    norm: normalize(ch),
    hasRuby: false,
    rect: {
      x1: run.x + k * pitch,
      x2: run.x + (k + 1) * pitch,
      y1: run.y - run.size * DESCENT_EM,
      y2: run.y + run.size * ASCENT_EM,
    },
  }));
}

/**
 * もとからあるルビか。かなだけのかたまりが、1.6 倍以上大きい字の右（縦書き）か上（横書き）に
 * すぐ並んでいれば、ルビと見なす。となりの字と比べるので、大きいルビの付いた見出しでも見つかる
 */
function isRuby(r: TextRun, runs: TextRun[]): boolean {
  if (!KANA_ONLY.test(r.str)) return false;
  return runs.some((q) => {
    if (q === r || q.vertical !== r.vertical || q.size < r.size * RUBY_SIZE_RATIO) return false;
    if (r.vertical) {
      return (
        Math.abs(q.x + q.size / 2 + r.size / 2 - r.x) < q.size * RUBY_SIDE_TOLERANCE_EM &&
        r.y - r.h < q.y &&
        r.y > q.y - q.h
      );
    }
    return (
      r.y > q.y + q.size * RUBY_ABOVE_MIN_EM &&
      r.y < q.y + q.size * RUBY_ABOVE_MAX_EM &&
      r.x < q.x + q.w &&
      r.x + r.w > q.x
    );
  });
}

/** pdf.js の TextItem を、読む順の行と、もとからあるルビに分ける */
export function layoutPage(items: TextItemLike[]): PageLayout {
  const runs: TextRun[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const [a = 0, b = 0, , , x = 0, y = 0] = it.transform;
    // 回した横書き（横倒しの字）は扱わない
    if (Math.abs(b) > ROTATION_EPSILON && it.dir !== 'ttb') continue;
    runs.push({
      vertical: it.dir === 'ttb',
      str: it.str,
      x,
      y,
      w: it.width,
      h: it.height,
      size: Math.hypot(a, b),
    });
  }
  const existingRuby = runs.filter((r) => isRuby(r, runs));
  const body = runs.filter((r) => !existingRuby.includes(r));

  // 縦書きの列：中心がそろい、すきまが2字より小さいかたまりをつなぐ
  const cols: Line[] = [];
  for (const r of body.filter((run) => run.vertical).sort((p, q) => q.y - p.y)) {
    const col = cols.find(
      (c) =>
        Math.abs(c.x - r.x) < c.size * SAME_COLUMN_EM &&
        Math.max(c.bottom - r.y, r.y - r.h - c.top, 0) < c.size * COLUMN_GAP_EM,
    );
    const glyphs = glyphsOf(r);
    if (col) {
      col.glyphs.push(...glyphs);
      col.top = Math.max(col.top, r.y);
      col.bottom = Math.min(col.bottom, r.y - r.h);
    } else {
      cols.push({
        vertical: true,
        size: r.size,
        glyphs,
        x: r.x,
        top: r.y,
        bottom: r.y - r.h,
        right: r.x + r.size / 2,
      });
    }
  }

  // 横書きの行。列の中心にある短いかたまりは縦中横なので、その列に入れる
  const rows: Line[] = [];
  const horizontal = body.filter((run) => !run.vertical).sort((p, q) => q.y - p.y || p.x - q.x);
  for (const r of horizontal) {
    const cx = r.x + r.w / 2;
    const text = r.str.trim();
    const col =
      text.length <= TCY_MAX_LENGTH
        ? cols.find(
            (c) =>
              Math.abs(c.x - cx) < c.size * TCY_CENTER_EM &&
              r.y <= c.top + c.size &&
              r.y >= c.bottom - c.size,
          )
        : undefined;
    if (col) {
      // 縦中横は、まとめて1字として扱う
      col.glyphs.push({
        ch: text,
        norm: text.normalize('NFKC'),
        hasRuby: false,
        rect: { x1: r.x, x2: r.x + r.w, y1: r.y, y2: r.y + r.size },
      });
      continue;
    }
    const row = rows.find(
      (l) =>
        Math.abs(l.bottom - r.y) < l.size * SAME_ROW_EM &&
        r.x >= l.x - l.size &&
        r.x <= l.right + l.size * ROW_GAP_EM,
    );
    const glyphs = glyphsOf(r);
    if (row) {
      row.glyphs.push(...glyphs);
      row.right = Math.max(row.right, r.x + r.w);
    } else {
      rows.push({
        vertical: false,
        size: r.size,
        glyphs,
        x: r.x,
        top: r.y + r.size,
        bottom: r.y,
        right: r.x + r.w,
      });
    }
  }
  for (const c of cols) c.glyphs.sort((p, q) => q.rect.y2 - p.rect.y2);
  for (const l of rows) l.glyphs.sort((p, q) => p.rect.x1 - q.rect.x1);

  markExistingRuby(existingRuby, cols, rows);
  return { lines: [...xyCut(cols), ...rows], existingRuby };
}

/** もとからあるルビの下（縦書きは左）の字に印を付ける */
function markExistingRuby(existingRuby: TextRun[], cols: Line[], rows: Line[]): void {
  for (const r of existingRuby) {
    if (r.vertical) {
      // ルビが親字より長いこともある（私 に わたし）ので、重なりで見て、中心がルビの範囲にある字に付ける
      const near = cols.filter(
        (c) =>
          Math.abs(c.right + r.size / 2 - r.x) < c.size * RUBY_SIDE_TOLERANCE_EM &&
          r.y - r.h < c.top &&
          r.y > c.bottom,
      );
      for (const g of near.flatMap((c) => c.glyphs)) {
        const mid = (g.rect.y1 + g.rect.y2) / 2;
        if (mid > r.y - r.h && mid < r.y) g.hasRuby = true;
      }
    } else {
      const near = rows.filter(
        (l) =>
          r.y > l.bottom + l.size * RUBY_ABOVE_MIN_EM &&
          r.y < l.bottom + l.size * RUBY_ABOVE_MAX_EM &&
          r.x < l.right &&
          r.x + r.w > l.x,
      );
      for (const g of near.flatMap((l) => l.glyphs)) {
        const mid = (g.rect.x1 + g.rect.x2) / 2;
        if (mid > r.x - r.size * RUBY_OVERHANG_EM && mid < r.x + r.w + r.size * RUBY_OVERHANG_EM) {
          g.hasRuby = true;
        }
      }
    }
  }
}

/** 並んだ列のあいだで、いちばん広いすきまと、その真ん中の位置 */
function widestGap(
  cols: Line[],
  lo: (c: Line) => number,
  hi: (c: Line) => number,
): { gap: number; at: number } | undefined {
  const sorted = [...cols].sort((p, q) => hi(q) - hi(p));
  const [first, ...rest] = sorted;
  if (!first) return undefined;
  let edge = lo(first);
  let best: { gap: number; at: number } | undefined;
  for (const c of rest) {
    const gap = edge - hi(c);
    if (gap > 0 && (!best || gap > best.gap)) best = { gap, at: (edge + hi(c)) / 2 };
    edge = Math.min(edge, lo(c));
  }
  return best;
}

/** 縦書きの列を、広いすきまで区切りながら読む順（段は上から、列は右から）に並べる */
function xyCut(cols: Line[]): Line[] {
  if (cols.length <= 1) return cols;
  const v = widestGap(
    cols,
    (c) => c.x - c.size / 2,
    (c) => c.x + c.size / 2,
  );
  const h = widestGap(
    cols,
    (c) => c.bottom,
    (c) => c.top,
  );
  if (h && (!v || h.gap > v.gap * HORIZONTAL_CUT_RATIO)) {
    return [
      ...xyCut(cols.filter((c) => c.bottom > h.at)),
      ...xyCut(cols.filter((c) => c.bottom <= h.at)),
    ];
  }
  if (v) {
    return [...xyCut(cols.filter((c) => c.x > v.at)), ...xyCut(cols.filter((c) => c.x <= v.at))];
  }
  return [...cols].sort((p, q) => q.top - p.top);
}

/** 行を段落にまとめる。縦書きで、長い列が文の終わりで終わっていなければ、次の列に続く */
export function paragraphs(lines: Line[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const isVertical of [true, false]) {
    const same = lines.filter((l) => l.vertical === isVertical);
    const maxLength = Math.max(0, ...same.map((l) => l.glyphs.length));
    let current: Glyph[] = [];
    for (const l of same) {
      current.push(...l.glyphs);
      const last = l.glyphs.at(-1)?.norm ?? '';
      if (
        !isVertical ||
        l.glyphs.length < maxLength * SHORT_LINE_RATIO ||
        PARAGRAPH_END.test(last)
      ) {
        out.push({ vertical: isVertical, glyphs: current });
        current = [];
      }
    }
    if (current.length) out.push({ vertical: isVertical, glyphs: current });
  }
  return out;
}
