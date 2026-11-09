// 行を、余白で区切って（XY-cut）かたまりにし、読む順に並べ、段落に分ける。
// 縦書きが多いところは右から左へ、横書きが多いところは左から右へ。上下はどちらも上から。
// 字の並ぶ向きの余白（縦書きなら上下、横書きなら左右）は行の中にはないので、先に区切る。
// 行どうしの余白は行間でもあるので、ほかの行間より十分に広いときだけ区切る。
import type { TextLine } from './lines';
import { centerX, centerY, unionRect } from './rect';
import type { Direction, Rect } from './types';

/** 字の並ぶ向きの余白で区切る、すきまの下限（字） */
const FLOW_CUT_EM = 1;
/** 1本の行だけが途切れる余白でも区切る、すきまの下限（字）。これより狭いのは書き込む空欄など */
const SINGLE_LINE_CUT_EM = 3;
/** 余白の端で終わる・始まる行と見なす、端からの長さ（字） */
const EDGE_NEAR_EM = 1;
/** 段や段組みの切れ目と見なす、余白の端で終わる（始まる）行の数の下限 */
const MIN_EDGE_LINES = 2;
/** 両側に行の端がそろっていれば区切る、狭い余白の下限（字）。段組みの溝が1字より狭い本 */
const NARROW_FLOW_CUT_EM = 0.5;
/** 狭い余白で区切るのに要る、余白で終わる行と、余白から始まる行の、それぞれの数の下限 */
const NARROW_EDGE_LINES = 3;
/** 行間を見積もるときに数えない、細い余白の上限（字） */
const LEAD_NOISE_EM = 0.3;
/** 行どうしの余白で区切る、すきまの下限（字） */
const LEAD_CUT_MIN_EM = 0.8;
/** 行どうしの余白で区切る、ほかの行間に対するすきまの比の下限 */
const LEAD_CUT_RATIO = 1.6;
/** 行間に関係なく区切る、行どうしのすきまの下限（字） */
const LEAD_CUT_ABS_EM = 2.5;
/** 段落の終わりと見なす、行の終わりがかたまりの端に届かない長さ（字） */
const SHORT_LINE_EM = 1.5;
/** 段落の始まりと見なす、字下げの長さ（字） */
const INDENT_EM = 0.5;
/** 同じ列・同じ高さの行と見なす、位置のずれの上限（字） */
const SAME_SLOT_EM = 0.5;
/** 同じ段落と見なす字の大きさの比の上限 */
const PARAGRAPH_SIZE_RATIO = 1.2;
/** 同じ段落と見なす、行どうしのすきまの上限（字） */
const PARAGRAPH_GAP_EM = 2;
/** 文の終わりの字（段落の終わりを見分けるのに使う） */
const SENTENCE_END = /[。．！？!?」』）)]$/u;
/** 漢字1字 */
const KANJI_CHAR = /^\p{Script=Han}$/u;
/** 語が行をまたいでいると見なす、前の行の字の数の下限（短い見出しや表の欄を積んだものをつながない） */
const WRAP_MIN_GLYPHS = 4;
/** 語が行をまたいでいると見なす、行どうしのすきまの上限（字） */
const WRAP_GAP_EM = 1.5;

/** 余白（並べた行の、どの行にも重ならない区間） */
interface Gap {
  /** 余白の真ん中 */
  readonly at: number;
  /** 余白の長さ */
  readonly length: number;
}

/** 区切る向き */
type Axis = 'x' | 'y';

/**
 * 中央の値（数が偶数のときは小さいほう）。
 * @param values 値
 * @returns 中央の値。値がなければ 0
 */
function lowerMedian(values: readonly number[]): number {
  const sorted = values.toSorted((p, q) => p - q);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/**
 * 行の字の数で多いほうの向き。同じ数なら横書き。
 * @param lines 行
 * @returns 多いほうの向き
 */
function dominantDirection(lines: readonly TextLine[]): Direction {
  let vertical = 0;
  let horizontal = 0;
  for (const line of lines) {
    if (line.direction === 'vertical') vertical += line.glyphs.length;
    else horizontal += line.glyphs.length;
  }
  return vertical > horizontal ? 'vertical' : 'horizontal';
}

/**
 * 行の箱の、ある向きの区間。
 * @param rect 箱
 * @param axis 向き
 * @returns 小さい端と大きい端
 */
function span(rect: Rect, axis: Axis): readonly [number, number] {
  return axis === 'x' ? [rect.x1, rect.x2] : [rect.y1, rect.y2];
}

/**
 * 行を、ある向きに投げた影の余白を挙げる。
 * @param lines 行（1つ以上）
 * @param axis 向き
 * @returns 小さい位置からの余白
 */
function projectionGaps(lines: readonly TextLine[], axis: Axis): Gap[] {
  const spans = lines.map((line) => span(line.rect, axis)).toSorted((p, q) => p[0] - q[0]);
  const gaps: Gap[] = [];
  let end = -Infinity;
  for (const [index, [lo, hi]] of spans.entries()) {
    if (index > 0 && lo > end) gaps.push({ at: (lo + end) / 2, length: lo - end });
    end = Math.max(end, hi);
  }
  return gaps;
}

/**
 * 行を、区切る位置で分け、読む順に並べる。
 * @param lines 行
 * @param axis 区切る向き
 * @param cuts 区切る位置
 * @param isVertical 縦書きが多いか（左右に区切ったとき、右から読む）
 * @returns 読む順の、区切った行
 */
function splitAt(
  lines: readonly TextLine[],
  axis: Axis,
  cuts: readonly number[],
  isVertical: boolean,
): TextLine[][] {
  const slabs: TextLine[][] = cuts.map(() => []);
  slabs.push([]);
  for (const line of lines) {
    const center = axis === 'x' ? centerX(line.rect) : centerY(line.rect);
    slabs[cuts.filter((cut) => cut < center).length]?.push(line);
  }
  // 小さい位置から並んでいるので、上下は上から、左右は縦書きなら右からに直す
  return axis === 'y' || isVertical ? slabs.reverse() : slabs;
}

/**
 * 字の並ぶ向きの余白で区切ってよいか。2本以上の行がその余白で終わるか始まるときは、段や段組みの切れ目と見なす。
 * 1本の行だけが途切れる余白は、行の中の空欄（書き込む欄など）なので、十分に広いときだけ区切る。
 * 1字より狭い余白は、両側にそれぞれ3本以上の行の端がそろうとき（狭い溝の段組み）だけ区切る。
 * @param lines 行
 * @param gap 余白
 * @param axis 字の並ぶ向き
 * @param size 字の大きさ
 * @returns 区切ってよいなら true
 */
function isFlowCut(lines: readonly TextLine[], gap: Gap, axis: Axis, size: number): boolean {
  if (gap.length >= size * SINGLE_LINE_CUT_EM) return true;
  if (gap.length < size * NARROW_FLOW_CUT_EM) return false;
  const lo = gap.at - gap.length / 2;
  const hi = gap.at + gap.length / 2;
  const near = size * EDGE_NEAR_EM;
  const spans = lines.map((line) => span(line.rect, axis));
  const ending = spans.filter(([, end]) => end <= lo && end >= lo - near).length;
  const starting = spans.filter(([start]) => start >= hi && start <= hi + near).length;
  if (gap.length < size * FLOW_CUT_EM) {
    return Math.min(ending, starting) >= NARROW_EDGE_LINES;
  }
  return Math.max(ending, starting) >= MIN_EDGE_LINES;
}

/**
 * 行を余白で区切り、読む順のかたまりにする。区切れなくなるまで繰り返す。
 * @param lines 行
 * @returns 読む順のかたまりごとの行
 */
function cutRegions(lines: readonly TextLine[]): TextLine[][] {
  if (lines.length <= 1) return [[...lines]];
  const isVertical = dominantDirection(lines) === 'vertical';
  const size = lowerMedian(lines.map((line) => line.size));
  const flowAxis: Axis = isVertical ? 'y' : 'x';
  const leadAxis: Axis = isVertical ? 'x' : 'y';

  let axis = flowAxis;
  let cuts = projectionGaps(lines, flowAxis).filter((gap) => isFlowCut(lines, gap, flowAxis, size));
  if (cuts.length === 0) {
    const leadGaps = projectionGaps(lines, leadAxis);
    // 傍線の番号などの小さな字が行間に入ると、細い余白ができる。行間を見積もるときは数えない
    const leading = lowerMedian(
      leadGaps.map((gap) => gap.length).filter((length) => length >= size * LEAD_NOISE_EM),
    );
    const min = Math.max(size * LEAD_CUT_MIN_EM, leading * LEAD_CUT_RATIO);
    axis = leadAxis;
    cuts = leadGaps.filter((gap) => gap.length >= min || gap.length >= size * LEAD_CUT_ABS_EM);
  }
  if (cuts.length === 0) return [[...lines]];
  return splitAt(
    lines,
    axis,
    cuts.map((gap) => gap.at),
    isVertical,
  ).flatMap((slab) => cutRegions(slab));
}

/**
 * 行の、字の並ぶ向きの始まりと終わり（縦書きは上の端と下の端を、下に向かって測れるように負にする）。
 * @param line 行
 * @returns 始まりと終わり
 */
function flowSpan(line: TextLine): readonly [number, number] {
  return line.direction === 'vertical'
    ? [-line.rect.y2, -line.rect.y1]
    : [line.rect.x1, line.rect.x2];
}

/** 同じ位置の行をまとめた行 */
interface Slot {
  /** まとめた行 */
  readonly line: TextLine;
  /** 同じ位置のほかの行と、段組みや表の溝で分かれているか（前後と別の段落にする） */
  readonly isSplit: boolean;
}

/**
 * 行どうしの、字の並ぶ向きのすきまが、段組みや表の溝か。
 * すきまが1字以上あり、ほかの2本以上の行が、すきまの端で終わるか始まるなら、溝と見なす。
 * 1本の行だけが途切れるすきまは、書き込む空欄なので溝ではない。
 * @param lines かたまりの行
 * @param prev すきまの前の行
 * @param next すきまの後ろの行
 * @returns 溝なら true
 */
function isGutter(lines: readonly TextLine[], prev: TextLine, next: TextLine): boolean {
  const size = Math.max(prev.size, next.size);
  const lo = flowSpan(prev)[1];
  const hi = flowSpan(next)[0];
  if (hi - lo < size * FLOW_CUT_EM) return false;
  const near = size * EDGE_NEAR_EM;
  const others = lines.filter((line) => line !== prev && line !== next).map(flowSpan);
  const ending = others.filter(([, end]) => end <= lo + near && end >= lo - near).length;
  const starting = others.filter(([start]) => start >= hi - near && start <= hi + near).length;
  return Math.max(ending, starting) >= MIN_EDGE_LINES;
}

/**
 * 同じ向きの行を、同じ位置（縦書きは同じ列、横書きは同じ高さ）ごとに1つの行にまとめ、読む順に並べる。
 * 列の途中の空欄（書き込む欄など）で分かれた行も、1つの行に戻る。
 * 段組みや表の溝で分かれた行は戻さず、別の段落にする。
 * @param lines 同じ向きの行（1つ以上）
 * @returns 読む順の行
 */
function toSlots(lines: readonly TextLine[]): Slot[] {
  // 小さいほど先に読む位置（縦書きは右の列から、横書きは上の行から）
  const position = (line: TextLine): number =>
    line.direction === 'vertical' ? -centerX(line.rect) : -centerY(line.rect);
  const slots: { anchor: TextLine; lines: TextLine[] }[] = [];
  for (const line of lines.toSorted((p, q) => position(p) - position(q))) {
    const slot = slots.at(-1);
    if (
      slot !== undefined &&
      position(line) - position(slot.anchor) < slot.anchor.size * SAME_SLOT_EM
    ) {
      slot.lines.push(line);
    } else {
      slots.push({ anchor: line, lines: [line] });
    }
  }
  return slots.flatMap(({ anchor, lines: same }) => {
    const groups: TextLine[][] = [];
    for (const line of same.toSorted((p, q) => flowSpan(p)[0] - flowSpan(q)[0])) {
      const group = groups.at(-1);
      const prev = group?.at(-1);
      if (group === undefined || prev === undefined || isGutter(lines, prev, line)) {
        groups.push([line]);
      } else {
        group.push(line);
      }
    }
    return groups.map((group) => ({
      line: {
        direction: anchor.direction,
        glyphs: group.flatMap((line) => line.glyphs),
        rect: unionRect(group.map((line) => line.rect)),
        size: anchor.size,
      },
      isSplit: groups.length > 1,
    }));
  });
}

/** 段落を分けるか決めるときに見る、となりの行 */
interface Neighbors {
  /** 前の行のさらに前の行 */
  readonly before: TextLine | undefined;
  /** 前の行 */
  readonly prev: TextLine;
  /** 次の行 */
  readonly next: TextLine;
}

/**
 * 前の行と次の行のあいだで、段落が変わるか。
 * 前の行がかたまりの端まで届かず、文の終わりで終わるか、前後のどちらの行よりも短ければ、段落の終わりと見なす
 * （図をよけて短く折り返した行は、前後の行も短いので段落を続ける）。
 * 次の行が字下げしていて、前の行が文の終わりで終わるときも、段落が変わる。
 * @param neighbors となりの行
 * @param start かたまりの行の始まりの端
 * @param end かたまりの行の終わりの端
 * @returns 段落が変わるなら true
 */
function isParagraphBreak(neighbors: Neighbors, start: number, end: number): boolean {
  const { before, prev, next } = neighbors;
  const size = Math.max(prev.size, next.size);
  if (size > Math.min(prev.size, next.size) * PARAGRAPH_SIZE_RATIO) return true;
  const gap =
    prev.direction === 'vertical' ? prev.rect.x1 - next.rect.x2 : prev.rect.y1 - next.rect.y2;
  if (gap > size * PARAGRAPH_GAP_EM) return true;
  const prevEnd = flowSpan(prev)[1];
  const isSentenceEnd = SENTENCE_END.test(
    prev.glyphs
      .slice(-1)
      .map((glyph) => glyph.norm)
      .join(''),
  );
  const neighborEnd = Math.min(flowSpan(next)[1], before ? flowSpan(before)[1] : Infinity);
  const shortLine = size * SHORT_LINE_EM;
  if (end - prevEnd > shortLine && (isSentenceEnd || neighborEnd - prevEnd > shortLine)) {
    return true;
  }
  return flowSpan(next)[0] - start > size * INDENT_EM && isSentenceEnd;
}

/**
 * 同じ向きの行を読む順に並べ、段落に分ける。
 * @param lines 同じ向きの行（1つ以上）
 * @returns 読む順の段落ごとの行
 */
function toParagraphs(lines: readonly TextLine[]): TextLine[][] {
  const slots = toSlots(lines);
  const start = Math.min(...slots.map(({ line }) => flowSpan(line)[0]));
  const end = Math.max(...slots.map(({ line }) => flowSpan(line)[1]));
  const paragraphs: TextLine[][] = [];
  let current: TextLine[] = [];
  let isPrevSplit = false;
  for (const { line, isSplit } of slots) {
    const prev = current.at(-1);
    // 前の行のさらに前の行は、同じ段落のときだけ比べる（見出しなどの長さと比べない）
    const before = current.at(-2);
    if (
      prev !== undefined &&
      (isSplit || isPrevSplit || isParagraphBreak({ before, prev, next: line }, start, end))
    ) {
      paragraphs.push(current);
      current = [];
    }
    current.push(line);
    isPrevSplit = isSplit;
  }
  paragraphs.push(current);
  return paragraphs;
}

/**
 * 行を、読む順の段落（見出し・表の欄・囲みなども含む）に分ける。
 * 余白で区切れないところに縦書きと横書きが混じっていれば、多いほうの向きの段落を先にする。
 * @param lines ページの行
 * @returns 読む順の段落ごとの行（どの段落も同じ向きの行だけ）
 */
export function orderParagraphs(lines: readonly TextLine[]): TextLine[][] {
  if (lines.length === 0) return [];
  const paragraphs = cutRegions(lines).flatMap((region) => {
    const dominant = dominantDirection(region);
    const same = region.filter((line) => line.direction === dominant);
    const others = region.filter((line) => line.direction !== dominant);
    return [same, others].filter((group) => group.length > 0).flatMap(toParagraphs);
  });
  return joinWrappedWords(paragraphs);
}

/**
 * 続く2つの段落のあいだで、語が行をまたいでいるか。
 * 前の段落が漢字で終わり、次の段落が漢字で始まり、2つの行がすぐ隣にあって行の頭がそろい、
 * 前の行が次の行の終わりまで届くなら、折り返しで語が切れたと見なす。
 * @param prev 前の段落の最後の行
 * @param next 次の段落の最初の行
 * @returns 語がまたいでいるなら true
 */
function isWrappedWord(prev: TextLine, next: TextLine): boolean {
  const last = prev.glyphs.at(-1);
  const first = next.glyphs[0];
  if (
    last === undefined ||
    first === undefined ||
    prev.direction !== next.direction ||
    prev.glyphs.length < WRAP_MIN_GLYPHS ||
    !KANJI_CHAR.test(last.norm) ||
    !KANJI_CHAR.test(first.norm)
  ) {
    return false;
  }
  const size = Math.max(prev.size, next.size);
  const gap =
    prev.direction === 'vertical' ? prev.rect.x1 - next.rect.x2 : prev.rect.y1 - next.rect.y2;
  const [prevStart, prevEnd] = flowSpan(prev);
  const [nextStart, nextEnd] = flowSpan(next);
  return (
    size <= Math.min(prev.size, next.size) * PARAGRAPH_SIZE_RATIO &&
    gap >= -size * LEAD_NOISE_EM &&
    gap <= size * WRAP_GAP_EM &&
    Math.abs(prevStart - nextStart) <= size * EDGE_NEAR_EM &&
    prevEnd >= nextEnd - size * EDGE_NEAR_EM
  );
}

/**
 * 折り返しで語が切れている、続く段落をつなぐ（拡／大防止 → 拡大防止）。
 * つながないと、切れた字だけで読むことになり、読みが違ったり付かなかったりする。
 * @param paragraphs 読む順の段落
 * @returns つないだ段落
 */
function joinWrappedWords(paragraphs: readonly TextLine[][]): TextLine[][] {
  const joined: TextLine[][] = [];
  for (const paragraph of paragraphs) {
    const previous = joined.at(-1);
    const prevLine = previous?.at(-1);
    const nextLine = paragraph[0];
    if (
      previous !== undefined &&
      prevLine !== undefined &&
      nextLine !== undefined &&
      isWrappedWord(prevLine, nextLine)
    ) {
      previous.push(...paragraph);
    } else {
      joined.push([...paragraph]);
    }
  }
  return joined;
}
