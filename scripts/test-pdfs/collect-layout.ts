/** 色（0〜1 の RGB） */
export type Rgb = [number, number, number];

/**
 * 字の向き。
 * h = 横書き、v = 縦書き（正立）、s = 横倒し（時計回りに 90°）、t = 縦中横
 */
export type GlyphMode = 'h' | 'v' | 's' | 't';

/** 枠線の辺 */
export type BorderSide = 'top' | 'right' | 'bottom' | 'left';

/** 長方形（CSS px、ページの左上が原点） */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Chromium が並べた1つの字 */
export interface LaidGlyph extends Box {
  ch: string;
  mode: GlyphMode;
  /** CSS の font-family の最初の名前 */
  family: string;
  weight: number;
  /** 字の大きさ（CSS px） */
  size: number;
  rgb: Rgb;
  /** 字の箱の上から基準線までの長さ（em） */
  ascent: number;
  /** ルビ（rt の中）の字か */
  ruby: boolean;
}

/** 背景の塗り */
export interface FillGraphic extends Box {
  kind: 'fill';
  rgb: Rgb;
}

/** 枠線の1辺 */
export interface BorderGraphic extends Box {
  kind: 'border';
  side: BorderSide;
  /** CSS の border-style（solid・dashed・dotted・double など） */
  style: string;
  /** 線の太さ（CSS px） */
  width: number;
  rgb: Rgb;
}

/** 字のほかに描くもの */
export type Graphic = FillGraphic | BorderGraphic;

/** 1ページ（HTML の .page 1つ）の並び */
export interface LaidPage {
  glyphs: LaidGlyph[];
  graphics: Graphic[];
  /** ページの外にはみ出して切れた字 */
  overflow: string;
  width: number;
  height: number;
  /** 文書の左上から見たページの位置（画像だけのページを撮るときに使う） */
  top: number;
  left: number;
}

/**
 * ページの中で動かし、.page ごとに字の箱と、背景・枠線を集める。
 *
 * Playwright が関数の文字列をページへ送るので、この関数の外のものは使えない
 * （定数も中に置く）。
 */
export function collectLayout(): LaidPage[] {
  const CHANNEL_MAX = 255;
  const PROBE_PX = 100;
  // 字の箱がページから少しはみ出すのは丸めの誤差なので許す
  const EDGE_TOLERANCE_PX = 0.5;
  const SIDES: readonly BorderSide[] = ['top', 'right', 'bottom', 'left'];

  const firstFamily = (fontFamily: string): string =>
    (fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
  const parseColor = (css: string): { rgb: Rgb; alpha: number } => {
    const n = (css.match(/[\d.]+/g) ?? []).map(Number);
    return {
      rgb: [(n[0] ?? 0) / CHANNEL_MAX, (n[1] ?? 0) / CHANNEL_MAX, (n[2] ?? 0) / CHANNEL_MAX],
      alpha: n[3] ?? 1,
    };
  };

  // この Chromium が並べたときの、字の箱の上から基準線までの長さ（フォントと太さごと）
  const ascents = new Map<string, number>();
  const ascentOf = (family: string, weight: number): number => {
    const key = `${family}|${String(weight)}`;
    const known = ascents.get(key);
    if (known !== undefined) return known;
    const probe = document.createElement('span');
    probe.style.cssText = `font: ${String(weight)} ${String(PROBE_PX)}px "${family}"; line-height: normal; writing-mode: horizontal-tb; position: absolute; top: 0; left: 0;`;
    const text = document.createTextNode('あ');
    const mark = document.createElement('i');
    mark.style.cssText = 'display: inline-block; width: 0; height: 0; vertical-align: baseline;';
    probe.append(text, mark);
    document.body.append(probe);
    const range = document.createRange();
    range.selectNodeContents(text);
    const textTop = range.getClientRects()[0]?.top ?? 0;
    const ascent = (mark.getBoundingClientRect().bottom - textTop) / PROBE_PX;
    probe.remove();
    ascents.set(key, ascent);
    return ascent;
  };

  const pages: LaidPage[] = [];
  for (const pageEl of document.querySelectorAll<HTMLElement>('.page')) {
    const origin = pageEl.getBoundingClientRect();
    const relative = (r: DOMRect): Box => ({
      x: r.left - origin.left,
      y: r.top - origin.top,
      w: r.width,
      h: r.height,
    });

    const graphics: Graphic[] = [];
    for (const el of [pageEl, ...pageEl.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const box = relative(el.getBoundingClientRect());
      const background = parseColor(cs.backgroundColor);
      // ページそのものの白は紙の色なので描かない
      if (background.alpha > 0 && el !== pageEl) {
        graphics.push({ kind: 'fill', ...box, rgb: background.rgb });
      }
      for (const side of SIDES) {
        const width = parseFloat(cs.getPropertyValue(`border-${side}-width`));
        const style = cs.getPropertyValue(`border-${side}-style`);
        if (!width || style === 'none' || style === 'hidden') continue;
        const rgb = parseColor(cs.getPropertyValue(`border-${side}-color`)).rgb;
        graphics.push({ kind: 'border', side, style, width, ...box, rgb });
      }
    }

    const glyphs: LaidGlyph[] = [];
    const overflow: string[] = [];
    const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!(node instanceof Text) || !parent) continue;
      const cs = getComputedStyle(parent);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const family = firstFamily(cs.fontFamily);
      const weight = Number(cs.fontWeight);
      const isVertical = cs.writingMode.startsWith('vertical');
      const isTcy = isVertical && cs.textCombineUpright === 'all';
      const isSideways = cs.textOrientation === 'sideways';
      const common = {
        family,
        weight,
        size: parseFloat(cs.fontSize),
        rgb: parseColor(cs.color).rgb,
        ascent: ascentOf(family, weight),
        ruby: parent.closest('rt') !== null,
      };
      let at = 0;
      for (const ch of node.data) {
        const start = at;
        at += ch.length;
        if (/\s/.test(ch)) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, at);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        const box = relative(rect);
        if (
          box.x < -EDGE_TOLERANCE_PX ||
          box.y < -EDGE_TOLERANCE_PX ||
          box.x + box.w > origin.width + EDGE_TOLERANCE_PX ||
          box.y + box.h > origin.height + EDGE_TOLERANCE_PX
        ) {
          overflow.push(ch);
          continue;
        }
        let mode: GlyphMode = 'h';
        if (isTcy) mode = 't';
        // 縦書きの中の半角英数字は、Chromium が横倒しにする
        else if (isVertical) mode = isSideways || /[\x21-\x7e]/.test(ch) ? 's' : 'v';
        glyphs.push({ ch, mode, ...box, ...common });
      }
    }

    pages.push({
      glyphs,
      graphics,
      overflow: overflow.join(''),
      width: origin.width,
      height: origin.height,
      top: origin.top + window.scrollY,
      left: origin.left + window.scrollX,
    });
  }
  return pages;
}
