/** いちばん小さい倍率（1 が 100%） */
export const MIN_ZOOM = 0.25;

/** いちばん大きい倍率 */
export const MAX_ZOOM = 5;

/** 拡大・縮小の段階（倍率）。Chrome の PDF の表示と同じ段階にそろえる */
// prettier-ignore
const ZOOM_STEPS = [
  MIN_ZOOM, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, MAX_ZOOM,
];

/** 倍率が段階と同じとみなす差。ページ幅に合わせたときの半端な倍率を、近い段階と区別するため */
const ZOOM_EPSILON = 0.001;

/** 拡大か縮小か */
export type ZoomDirection = 'in' | 'out';

/** 入力されたページ番号を読み取った結果 */
export type PageNumberResult =
  { ok: true; value: number } | { ok: false; error: 'not-a-number' | 'out-of-range' };

/**
 * 入力されたページ番号を読み取る。
 *
 * @param input - ページ番号の欄に入力された文字（全角の数字も読む）
 * @param pageCount - PDF の全ページ数
 * @returns 1 から全ページ数までのページ番号。数でないとき・範囲の外のときは失敗
 */
export function parsePageNumber(input: string, pageCount: number): PageNumberResult {
  const halfWidth = input.trim().normalize('NFKC');
  if (!/^\d+$/u.test(halfWidth)) {
    return { ok: false, error: 'not-a-number' };
  }
  const pageNumber = Number(halfWidth);
  if (pageNumber < 1 || pageNumber > pageCount) {
    return { ok: false, error: 'out-of-range' };
  }
  return { ok: true, value: pageNumber };
}

/**
 * 今の倍率から、1段階だけ拡大・縮小した倍率を求める。
 *
 * @param scale - 今の倍率（1 が 100%）
 * @param direction - 拡大（in）か縮小（out）か
 * @returns 次の段階の倍率。もう端の段階なら、端の倍率
 */
export function nextZoomStep(scale: number, direction: ZoomDirection): number {
  if (direction === 'in') {
    return ZOOM_STEPS.find((step) => step > scale + ZOOM_EPSILON) ?? MAX_ZOOM;
  }
  return ZOOM_STEPS.findLast((step) => step < scale - ZOOM_EPSILON) ?? MIN_ZOOM;
}

/**
 * 倍率を、バーに出す百分率の文字にする。
 *
 * @param scale - 倍率（1 が 100%）
 * @returns `100%` のような文字
 */
export function formatZoom(scale: number): string {
  return `${String(Math.round(scale * 100))}%`;
}

/** 紙面を1回で回す角度（時計回り） */
const ROTATION_STEP = 90;

/**
 * 今の向きから、時計回りに 90 度回した向きを求める。
 *
 * @param rotation - 今の向き（0・90・180・270 のどれか）
 * @returns 90 度回した向き（270 の次は 0）
 */
export function nextRotation(rotation: number): number {
  return (rotation + ROTATION_STEP) % 360;
}
