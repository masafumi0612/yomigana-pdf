// 返事を待つ時間に上限を付ける（返事が来ないまま、リーダーが待ち続けないため）
import type { Result } from '@/result';

/**
 * 読みの問い合わせの返事を待つ時間の上限（ミリ秒）。辞書を初めて読み込むときも、ふつうはこの中に収まる。
 * 過ぎたらリーダーは「ルビを付けられませんでした」と出し、もう一度を選べるようにする
 */
export const READING_TIMEOUT_MS = 10_000;

/**
 * 待つ時間に上限を付けて待つ。
 * @param promise 待つもの
 * @param timeoutMs 待つ時間の上限（ミリ秒）
 * @returns 待ったものの値。上限を過ぎたら timeout
 */
export async function withTimeout<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Result<Value, 'timeout'>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<Value, 'timeout'>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      promise.then((value): Result<Value, 'timeout'> => ({ ok: true, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
