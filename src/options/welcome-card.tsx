import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { SAMPLE_PDF_PATH } from '@/config';
import { createLogger } from '@/log';

import { message } from './message';
import { openReader } from './open-pdf-section';
import { dismissWelcome, getWelcomeShown } from './welcome';

const log = createLogger('options');

/**
 * 入れた直後の案内を出すかを読み、閉じる関数と一緒に返す。
 * @returns 出すなら true（読み終わるまでは false）と、案内を閉じる関数
 */
export function useWelcome(): [boolean, () => void] {
  const [isShown, setIsShown] = useState(false);
  useEffect(() => {
    getWelcomeShown()
      .then(setIsShown)
      .catch((error: unknown) => {
        log.error('入れた直後の案内の状態を読むのに失敗しました', error);
      });
  }, []);
  const close = (): void => {
    setIsShown(false);
    dismissWelcome().catch((error: unknown) => {
      log.error('入れた直後の案内を閉じたことを残すのに失敗しました', error);
    });
  };
  return [isShown, close];
}

/** 入れた直後の案内に渡すもの */
interface WelcomeCardProps {
  /** 「閉じる」を押したときに呼ぶ */
  readonly onClose: () => void;
}

/**
 * 初めて入れた直後の案内。スイッチのことを伝え、同梱した見本の PDF を開けるようにする。
 * @param props 閉じるときに呼ぶ関数
 * @param props.onClose 「閉じる」を押したときに呼ぶ
 * @returns 案内の場所
 */
export function WelcomeCard({ onClose }: WelcomeCardProps): JSX.Element {
  // 見本は拡張の中にあるので、この画面と同じ起点の URL で開ける
  const openSample = (): void => {
    openReader(new URL(`/${SAMPLE_PDF_PATH}`, location.href).href);
  };

  return (
    <section class="welcome" aria-labelledby="welcome-title">
      <div class="heading welcome-text">
        <h2 id="welcome-title" class="welcome-title">
          {message('options_welcome_title')}
        </h2>
        <p class="note">{message('options_welcome_lead')}</p>
      </div>
      <div class="row">
        <button type="button" class="button button-primary" onClick={openSample}>
          {message('options_welcome_trySample')}
        </button>
        <button type="button" class="button button-outline" onClick={onClose}>
          {message('options_welcome_close')}
        </button>
      </div>
    </section>
  );
}
