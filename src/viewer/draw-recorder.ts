// pdf.js が Canvas に字を描く所（fillText）で、描いた位置を書き留める。
// getTextContent() の位置は片の中を等分したものなので、半角の字や字詰めのある片では字の位置が半字ほどずれる。
// pdf.js は字を1つずつ fillText で描くので、そこで本当の位置が分かる。
// 書き留めるのは、見張ると決めた Canvas だけ。ほかの Canvas は、そのまま描く。
// Type3 フォントや、字の形を線で描くフォントは fillText を通らないので、書き留められない（getTextContent() の位置を使う）
import type { DrawnGlyph } from './glyph-snap';

/** 描いた位置を書き留める道具 */
export interface DrawRecorder {
  /**
   * この Canvas に描く字を、書き留め始める。
   * @param canvas 見張る Canvas
   */
  watch(canvas: HTMLCanvasElement): void;
  /**
   * 書き留めた字を受け取り、見張るのをやめる。
   * @param canvas 見張っていた Canvas
   * @returns 描いた順の字（Canvas の画素）。見張っていなければ空
   */
  take(canvas: HTMLCanvasElement): DrawnGlyph[];
}

/** ctx.font から字の大きさ（px）を読む */
const FONT_SIZE_PATTERN = /(\d+(?:\.\d+)?)px/u;

/**
 * CanvasRenderingContext2D の fillText に、描いた位置を書き留める処理をはさむ。ページで1回だけ呼ぶ。
 * @returns 描いた位置を書き留める道具
 */
export function installDrawRecorder(): DrawRecorder {
  const recording = new WeakMap<HTMLCanvasElement, DrawnGlyph[]>();
  const prototype = CanvasRenderingContext2D.prototype;
  const original: unknown = Object.getOwnPropertyDescriptor(prototype, 'fillText')?.value;
  if (typeof original !== 'function') {
    throw new TypeError('CanvasRenderingContext2D に fillText がない');
  }
  const fillText = new Proxy(original, {
    apply(target, thisArg: unknown, args: unknown[]): unknown {
      if (thisArg instanceof CanvasRenderingContext2D) {
        const draws = recording.get(thisArg.canvas);
        const [text, x, y] = args;
        if (
          draws !== undefined &&
          typeof text === 'string' &&
          typeof x === 'number' &&
          typeof y === 'number'
        ) {
          const draw = measureDraw(thisArg, text, x, y);
          if (draw !== undefined) draws.push(draw);
        }
      }
      const result: unknown = Reflect.apply(target, thisArg, args);
      return result;
    },
  });
  Object.defineProperty(prototype, 'fillText', { value: fillText });
  return {
    watch(canvas) {
      recording.set(canvas, []);
    },
    take(canvas) {
      const draws = recording.get(canvas) ?? [];
      recording.delete(canvas);
      return draws;
    },
  };
}

/**
 * 描く1字の位置を、Canvas の画素で測る。
 * @param context 描く Canvas の文脈
 * @param text 描く字
 * @param x 描く位置（その時の変換の中の座標）
 * @param y 描く基準線の位置（その時の変換の中の座標）
 * @returns 描いた位置。空白や、字の大きさが読めないときは undefined
 */
function measureDraw(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): DrawnGlyph | undefined {
  const fontSize = Number(FONT_SIZE_PATTERN.exec(context.font)?.[1]);
  if (text.trim() === '' || !(fontSize > 0)) return undefined;
  const matrix = context.getTransform();
  const width = context.measureText(text).width;
  const toCanvas = (px: number, py: number): DrawnGlyph['origin'] => {
    const point = matrix.transformPoint({ x: px, y: py });
    return { x: point.x, y: point.y };
  };
  // Canvas の文脈の中では y が下へ向くので、字の上は基準線から fontSize だけ引いた所
  return {
    origin: toCanvas(x, y),
    advance: toCanvas(x + width, y),
    top: toCanvas(x, y - fontSize),
  };
}
