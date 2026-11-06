// 同じ行のルビを、読む順に並べて、隣のルビと重ならないように置き直す。
// 長さはすべて行の向きの位置（読む向きに進むほど大きい値）で考える。
// まず親字の大きさの半分までずらして避け、ずらしても入らないときだけ、はみ出すルビの字を小さくする。
// 隣にルビのない所へのはみ出しは、そのまま認める。

/** 行の向きの1つのルビ */
export interface LineRuby {
  /** 親字の頭の端 */
  readonly baseStart: number;
  /** 親字の終わりの端 */
  readonly baseEnd: number;
  /** 親字の大きさ */
  readonly baseSize: number;
  /** ルビの字の数 */
  readonly charCount: number;
  /** 行の向きに縮める前の、ルビの字の大きさ */
  readonly fontSize: number;
  /** ルビの字を親字の長さに均等に並べるなら true。字の長さは親字の長さに収まっている */
  readonly isSpread: boolean;
}

/** 置き直した1つのルビ */
export interface LineFit {
  /** 字の大きさにかける割合（1 なら縮めない） */
  readonly scale: number;
  /** ルビの箱の頭の端 */
  readonly start: number;
  /** ルビの箱の終わりの端 */
  readonly end: number;
}

/** 親字の中心からずらしてよい長さ（親字の大きさに対する割合）。これより離すと、どの字のルビか分かりにくい */
export const MAX_SHIFT_EM = 0.5;
/** 縮めるときの割合の下限。ここまで縮めても入らないときは、重ならないことを優先して先へ押し出す */
const MIN_SCALE = 0.05;
/** 縮める割合を探すときに、半分に分ける回数 */
const SEARCH_STEPS = 24;
/** 計算の誤差として見のがす長さ（PDF の単位） */
const EPSILON = 1e-9;

/** 置き直している途中の1つのルビ */
interface Item {
  readonly ruby: LineRuby;
  /** 親字の中心 */
  readonly middle: number;
  /** ずらしてよい長さ */
  readonly reach: number;
  scale: number;
}

/**
 * 同じ行のルビを、隣どうしが重ならないように置き直す。
 * @param rubies 同じ行のルビ（親字の中心の、読む順）
 * @returns rubies と同じ順の、置き直したルビ
 */
export function fitLine(rubies: readonly LineRuby[]): LineFit[] {
  const items: Item[] = rubies.map((ruby) => ({
    ruby,
    middle: (ruby.baseStart + ruby.baseEnd) / 2,
    reach: ruby.baseSize * MAX_SHIFT_EM,
    scale: 1,
  }));
  for (const cluster of clustersOf(items)) shrinkToFit(cluster);
  const centers = placeCenters(items);
  return items.map((item, index) => {
    const center = centers[index] ?? item.middle;
    const half = Math.min(
      longest(item) / 2,
      center - boundary(items, centers, index - 1),
      boundary(items, centers, index) - center,
    );
    return { scale: item.scale, start: center - half, end: center + half };
  });
}

/**
 * ルビの字を並べた長さ。
 * @param item ルビ
 * @returns 字の数 × 字の大きさ
 */
function textLength(item: Item): number {
  return item.ruby.charCount * item.ruby.fontSize * item.scale;
}

/**
 * 隣と重ならないようにする長さ。均等に並べるルビは親字の長さ全体、ほかは字の長さ。
 * @param item ルビ
 * @returns 長さ
 */
function extent(item: Item): number {
  const text = textLength(item);
  return item.ruby.isSpread ? Math.max(item.ruby.baseEnd - item.ruby.baseStart, text) : text;
}

/**
 * 隣と重ならなければ取りたい箱の長さ（今の置き方と同じく、親字とルビの字の長いほう）。
 * @param item ルビ
 * @returns 長さ
 */
function longest(item: Item): number {
  return Math.max(item.ruby.baseEnd - item.ruby.baseStart, textLength(item));
}

/**
 * 隣どうしの字の間の真ん中。箱はここを越えないので、重ならない。
 * @param items ルビ
 * @param centers 置いた中心
 * @param index 前のルビの番号（次のルビはその次）
 * @returns 真ん中の位置。前か次がなければ限りなく遠い
 */
function boundary(items: readonly Item[], centers: readonly number[], index: number): number {
  const previous = items[index];
  const next = items[index + 1];
  if (previous === undefined) return -Infinity;
  if (next === undefined) return Infinity;
  const previousEnd = (centers[index] ?? previous.middle) + extent(previous) / 2;
  const nextStart = (centers[index + 1] ?? next.middle) - extent(next) / 2;
  return (previousEnd + nextStart) / 2;
}

/**
 * ずらしても縮めてもぶつかりうるルビのまとまりに分ける。まとまりどうしは、どう置いても重ならない。
 * @param items ルビ（読む順）
 * @returns まとまり
 */
function clustersOf(items: readonly Item[]): Item[][] {
  const clusters: Item[][] = [];
  let farthest = -Infinity;
  for (const item of items) {
    const half = item.reach + extent(item) / 2;
    const cluster = clusters.at(-1);
    if (cluster === undefined || item.middle - half >= farthest) clusters.push([item]);
    else cluster.push(item);
    farthest = Math.max(farthest, item.middle + half);
  }
  return clusters;
}

/**
 * まとまりの中で、ずらしてよい長さの内に、重ならずに置けるか。
 * @param items ルビ（読む順）
 * @returns 置けるなら true
 */
function isPlaceable(items: readonly Item[]): boolean {
  let previous: { center: number; item: Item } | undefined;
  for (const item of items) {
    const lowest = item.middle - item.reach;
    const center =
      previous === undefined
        ? lowest
        : Math.max(lowest, previous.center + (extent(previous.item) + extent(item)) / 2);
    if (center > item.middle + item.reach + EPSILON) return false;
    previous = { center, item };
  }
  return true;
}

/**
 * ずらすだけでは入らないとき、親字からはみ出すルビの字を、入るいちばん大きい割合まで縮める。
 * はみ出すルビがなければ（親字どうしが重なっているとき）、均等に並べるもののほかをすべて縮める。
 * @param cluster ぶつかりうるルビのまとまり
 */
function shrinkToFit(cluster: readonly Item[]): void {
  if (isPlaceable(cluster)) return;
  const overhanging = cluster.filter(
    (item) => !item.ruby.isSpread && textLength(item) > item.ruby.baseEnd - item.ruby.baseStart,
  );
  const targets =
    overhanging.length > 0 ? overhanging : cluster.filter((item) => !item.ruby.isSpread);
  const setScale = (scale: number): void => {
    for (const item of targets) item.scale = scale;
  };
  let low = MIN_SCALE;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step++) {
    const middle = (low + high) / 2;
    setScale(middle);
    if (isPlaceable(cluster)) low = middle;
    else high = middle;
  }
  setScale(low);
}

/**
 * ルビの中心を決める。親字の中心からのずれ（の2乗の和）がいちばん小さくなる並べ方を、
 * ずらしてよい長さの内に収める。収まらないときは、重ならないことを優先して先へ押し出す。
 * @param items ルビ（読む順）
 * @returns items と同じ順の中心
 */
function placeCenters(items: readonly Item[]): number[] {
  const gaps = items.map((item, index) => {
    const next = items[index + 1];
    return next === undefined ? 0 : (extent(item) + extent(next)) / 2;
  });
  const lowest: number[] = [];
  for (const [index, item] of items.entries()) {
    const previous = lowest[index - 1];
    const gap = gaps[index - 1] ?? 0;
    lowest.push(
      Math.max(item.middle - item.reach, previous === undefined ? -Infinity : previous + gap),
    );
  }
  const highest: number[] = [];
  let next = Infinity;
  for (const [index, item] of [...items.entries()].reverse()) {
    next = Math.min(item.middle + item.reach, next - (gaps[index] ?? 0));
    highest[index] = next;
  }
  if (lowest.some((low, index) => low > (highest[index] ?? Infinity) + EPSILON)) {
    return pushForward(items, gaps);
  }
  return closestCenters(items, gaps).map((center, index) =>
    Math.min(Math.max(center, lowest[index] ?? center), highest[index] ?? center),
  );
}

/**
 * 重ならないことだけを守って、親字の中心からのずれのいちばん小さい中心を出す（隣り合う違反をまとめて平均する）。
 * @param items ルビ（読む順）
 * @param gaps 隣との中心の間の、いちばん短い長さ
 * @returns items と同じ順の中心
 */
function closestCenters(items: readonly Item[], gaps: readonly number[]): number[] {
  // 中心から、頭からの間の長さの和を引くと、重ならない決まりは「前より小さくない」になる
  const offsets: number[] = [];
  let offset = 0;
  for (const [index] of items.entries()) {
    offsets.push(offset);
    offset += gaps[index] ?? 0;
  }
  const pools: { sum: number; count: number }[] = [];
  for (const [index, item] of items.entries()) {
    let pool = { sum: item.middle - (offsets[index] ?? 0), count: 1 };
    for (let last = pools.at(-1); last !== undefined; last = pools.at(-1)) {
      if (last.sum / last.count <= pool.sum / pool.count) break;
      pools.pop();
      pool = { sum: last.sum + pool.sum, count: last.count + pool.count };
    }
    pools.push(pool);
  }
  const centers: number[] = [];
  for (const pool of pools) {
    for (let count = 0; count < pool.count; count++) {
      centers.push(pool.sum / pool.count + (offsets[centers.length] ?? 0));
    }
  }
  return centers;
}

/**
 * ずらしてよい長さを越えても、重ならないように、前のルビの後ろへ押し出す。
 * @param items ルビ（読む順）
 * @param gaps 隣との中心の間の、いちばん短い長さ
 * @returns items と同じ順の中心
 */
function pushForward(items: readonly Item[], gaps: readonly number[]): number[] {
  const centers: number[] = [];
  for (const [index, item] of items.entries()) {
    const previous = centers[index - 1];
    centers.push(
      previous === undefined
        ? item.middle
        : Math.max(item.middle, previous + (gaps[index - 1] ?? 0)),
    );
  }
  return centers;
}
