import type { GlyphMode, Graphic, LaidGlyph, Rgb } from './collect-layout.ts';
import { hex4, num } from './pdf-writer.ts';
import type { FontSet, SubsetFont, WritingDir } from './subset-font.ts';

/** 1 CSS px = 0.75 pt（96 dpi） */
export const PT_PER_PX = 0.75;
const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
/** A4 の幅（pt） */
export const PAGE_WIDTH_PT = (A4_WIDTH_MM / MM_PER_INCH) * PT_PER_INCH;
/** A4 の高さ（pt） */
export const PAGE_HEIGHT_PT = (A4_HEIGHT_MM / MM_PER_INCH) * PT_PER_INCH;

const PDF_EM = 1000;
// 縦中横の字の基準線は、1 em の箱の中央から 0.38 em 下（和文の箱の基準線は上から 0.88 em）
const TCY_BASELINE_BELOW_CENTER = 0.38;
// 同じ行（列）と見なす、字の位置のずれ（pt）
const SAME_LINE_TOLERANCE_PT = 0.3;
// 1つのまとまりにつなぐ、字と字のすきまの上限（em）
const MAX_GAP_EM = 1.5;
const MAX_TCY_GAP_EM = 0.3;
// 縦中横がこれより長ければ、箱に収まるよう横に縮める
const TCY_SQUEEZE_THRESHOLD = 1.01;
const PERCENT = 100;
// これより小さい TJ の差は書かない（1/1000 em）
const MIN_ADJUST = 0.5;
// 点線・破線の、線と間の長さ（線の太さの何倍か）
const DASH_RATIO = 3;
// 二重線の1本の太さ（線の太さの何分の1か）
const DOUBLE_LINE_PARTS = 3;

/** PDF に置く1つの字 */
interface PlacedGlyph {
  dir: WritingDir;
  /** 字の原点（pt、PDF の座標：左下が原点、y は上向き） */
  x: number;
  y: number;
  /** 横倒し（時計回りに 90°）で書くか */
  rotated: boolean;
  /** 縦中横の箱の右の端（pt） */
  right: number;
  gid: number;
  font: SubsetFont;
  /** 字の大きさ（pt） */
  size: number;
  rgb: Rgb;
  mode: GlyphMode;
  /** フォントの送り幅（pt） */
  advance: number;
}

/** 1つの BT … ET にまとめる字の並び */
interface GlyphRun {
  font: SubsetFont;
  size: number;
  mode: GlyphMode;
  rgb: Rgb;
  items: PlacedGlyph[];
}

const px = (v: number): number => v * PT_PER_PX;
/** CSS の y（下向き、px）を PDF の y（上向き、pt）にする */
const pdfY = (v: number): number => PAGE_HEIGHT_PT - v * PT_PER_PX;
const color = (rgb: Rgb): string => rgb.map(num).join(' ');

/** 背景と枠線を、PDF の描く命令にする */
export function graphicsOps(graphics: Graphic[]): string[] {
  const ops: string[] = [];
  for (const g of graphics) {
    ops.push(`${color(g.rgb)} rg ${color(g.rgb)} RG`);
    if (g.kind === 'fill') {
      ops.push(`${num(px(g.x))} ${num(pdfY(g.y + g.h))} ${num(px(g.w))} ${num(px(g.h))} re f`);
      continue;
    }
    // 枠線の1辺を、帯（実線・二重線）か、帯の中央の線（点線・破線）として描く
    const isHorizontal = g.side === 'top' || g.side === 'bottom';
    const band = (offset: number, width: number): [number, number, number, number] => {
      let top = g.y;
      if (g.side === 'top') top = g.y + offset;
      else if (g.side === 'bottom') top = g.y + g.h - offset - width;
      let left = g.x;
      if (g.side === 'left') left = g.x + offset;
      else if (g.side === 'right') left = g.x + g.w - offset - width;
      return isHorizontal ? [left, top, g.w, width] : [left, top, width, g.h];
    };
    if (g.style === 'dashed' || g.style === 'dotted') {
      const [l, t, w, h] = band(0, g.width);
      const dash = g.style === 'dashed' ? DASH_RATIO * g.width : g.width;
      const [from, to] = isHorizontal
        ? [
            [l, t + h / 2],
            [l + w, t + h / 2],
          ]
        : [
            [l + w / 2, t],
            [l + w / 2, t + h],
          ];
      ops.push(
        `[${num(px(dash))} ${num(px(dash))}] 0 d ${num(px(g.width))} w ${num(px(from[0] ?? 0))} ${num(pdfY(from[1] ?? 0))} m ${num(px(to[0] ?? 0))} ${num(pdfY(to[1] ?? 0))} l S [] 0 d`,
      );
    } else {
      const part = g.width / DOUBLE_LINE_PARTS;
      const bands =
        g.style === 'double' ? [band(0, part), band(part * 2, part)] : [band(0, g.width)];
      for (const [l, t, w, h] of bands) {
        ops.push(`${num(px(l))} ${num(pdfY(t + h))} ${num(px(w))} ${num(px(h))} re f`);
      }
    }
  }
  return ops;
}

/** 1つの字を、PDF のどこに、どの書き方で置くかを決める */
function place(g: LaidGlyph, fonts: FontSet): PlacedGlyph {
  const font = fonts.get(g.family, g.weight);
  const gid = font.glyphId(g.ch, g.mode === 'v');
  // 送り幅（CSS px。縦書きの正立は 1 em）
  const advancePx = ((font.widths.get(gid) ?? PDF_EM) / PDF_EM) * g.size;
  const common = {
    gid,
    font,
    size: px(g.size),
    rgb: g.rgb,
    mode: g.mode,
    advance: px(advancePx),
    rotated: false,
    right: 0,
  };
  // DOM の箱が字より広いことがある（長いルビの下の親字、字間を空けたルビ）。
  // Chromium は箱の中央に字を置く（Chromium の印刷と比べて確かめた）ので、同じにする
  switch (g.mode) {
    case 'v': {
      // Identity-V：字の原点は em の箱の上の中央（DW2 = [880 -1000]）
      return { ...common, dir: 'V', x: px(g.x + g.w / 2), y: pdfY(g.y + (g.h - g.size) / 2) };
    }
    case 's': {
      // 横倒し：字の上が右を向くので、基準線は箱の右の端から ascent だけ左
      return {
        ...common,
        dir: 'H',
        rotated: true,
        x: px(g.x + g.w - g.ascent * g.size),
        y: pdfY(g.y + (g.h - advancePx) / 2),
      };
    }
    case 't': {
      return {
        ...common,
        dir: 'H',
        x: px(g.x),
        y: pdfY(g.y + g.h / 2 + TCY_BASELINE_BELOW_CENTER * g.size),
        right: px(g.x + g.w),
      };
    }
    case 'h': {
      return {
        ...common,
        dir: 'H',
        x: px(g.x + (g.w - advancePx) / 2),
        y: pdfY(g.y + g.ascent * g.size),
      };
    }
  }
}

/** 前の字と同じまとまり（同じフォント・大きさ・色・向きで、続いて並ぶ）か */
function continues(run: GlyphRun, last: PlacedGlyph, item: PlacedGlyph): boolean {
  const isSameStyle =
    run.font === item.font &&
    run.size === item.size &&
    run.mode === item.mode &&
    run.rgb.join() === item.rgb.join();
  if (!isSameStyle) return false;
  const s = run.size;
  switch (item.mode) {
    case 'v': {
      return (
        Math.abs(item.x - last.x) < SAME_LINE_TOLERANCE_PT &&
        last.y - item.y > 0 &&
        last.y - s - item.y < s * MAX_GAP_EM
      );
    }
    case 's': {
      return (
        Math.abs(item.x - last.x) < SAME_LINE_TOLERANCE_PT &&
        last.y - item.y > 0 &&
        last.y - last.advance - item.y < s * MAX_GAP_EM
      );
    }
    case 't': {
      return (
        Math.abs(item.y - last.y) < SAME_LINE_TOLERANCE_PT &&
        item.x > last.x &&
        item.x - last.right < s * MAX_TCY_GAP_EM
      );
    }
    case 'h': {
      return (
        Math.abs(item.y - last.y) < SAME_LINE_TOLERANCE_PT &&
        item.x > last.x &&
        item.x - (last.x + last.advance) < s * MAX_GAP_EM
      );
    }
  }
}

/** 1つのまとまりを BT … TJ ET にする */
function runOp(run: GlyphRun, fonts: FontSet): string {
  const [first] = run.items;
  if (!first) return '';
  const parts: string[] = [];
  let scale = PERCENT;
  if (run.mode === 't') {
    // 縦中横の数字は、Chromium が作った箱（ふつうは 1 em）に収まるよう縮める
    const natural = run.items.reduce((sum, it) => sum + it.advance, 0);
    const box = (run.items.at(-1)?.right ?? first.right) - first.x;
    if (natural > box * TCY_SQUEEZE_THRESHOLD) scale = (box / natural) * PERCENT;
    parts.push(`<${run.items.map((it) => hex4(it.gid)).join('')}>`);
  } else {
    let prev: PlacedGlyph | undefined;
    for (const it of run.items) {
      if (prev) {
        // 置きたい送りと、フォントのままの送りとの差（1/1000 em）。
        // TJ の数は、横書きの送り（横倒しも同じ）からは引かれ、Identity-V の下向きの送りには足される
        const isDownward = run.mode === 'v' || run.mode === 's';
        const wanted = isDownward ? prev.y - it.y : it.x - prev.x;
        const natural = run.mode === 'v' ? run.size : prev.advance;
        const sign = run.mode === 'v' ? 1 : -1;
        const adjust = sign * (wanted - natural) * (PDF_EM / run.size);
        if (Math.abs(adjust) >= MIN_ADJUST) parts.push(num(adjust));
      }
      parts.push(`<${hex4(it.gid)}>`);
      prev = it;
    }
  }
  const matrix = first.rotated
    ? `0 -1 1 0 ${num(first.x)} ${num(first.y)}`
    : `1 0 0 1 ${num(first.x)} ${num(first.y)}`;
  const tz = scale === PERCENT ? '' : `${num(scale)} Tz `;
  const res = fonts.resourceName(run.font, first.dir);
  return `BT /${res} ${num(run.size)} Tf ${color(run.rgb)} rg ${tz}${matrix} Tm [${parts.join(' ')}] TJ ET`;
}

/**
 * 字を PDF の文字の命令にする。同じフォント・大きさ・色・向きで1行（1列）に続く字は
 * 1つの BT … TJ ET にまとめ、TJ の数で、どの字も Chromium が置いた場所に来るようにする
 */
export function textOps(glyphs: LaidGlyph[], fonts: FontSet): string[] {
  const runs: GlyphRun[] = [];
  for (const g of glyphs) {
    const item = place(g, fonts);
    item.font.usedDirs.add(item.dir);
    const run = runs.at(-1);
    const last = run?.items.at(-1);
    if (run && last && continues(run, last, item)) run.items.push(item);
    else
      runs.push({
        font: item.font,
        size: item.size,
        mode: item.mode,
        rgb: item.rgb,
        items: [item],
      });
  }
  return runs.map((run) => runOp(run, fonts));
}
