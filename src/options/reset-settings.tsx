import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { createLogger } from '@/log';
import { resetSettings } from '@/settings/storage';

import { useElement } from './hooks';
import { message } from './message';

const log = createLogger('options');

/** 戻すボタンの状態。押す前（idle）・確かめている（confirm）・戻した（done） */
type ResetPhase = 'idle' | 'confirm' | 'done';

/**
 * 設定を最初の状態に戻すボタン。押すと、この画面の中で確かめてから戻す。
 * @returns 戻すボタンの場所
 */
export function ResetSettings(): JSX.Element {
  const [phase, setPhase] = useState<ResetPhase>('idle');
  const [resetButton, setResetButton] = useElement<HTMLButtonElement>();
  const [cancelButton, setCancelButton] = useElement<HTMLButtonElement>();

  useEffect(() => {
    // キーボードで操作している人が迷わないよう、出した確かめのボタンに移り、終わったら元のボタンに戻る
    if (phase === 'confirm') {
      cancelButton.current?.focus();
    }
  }, [phase]);

  const finish = (next: ResetPhase): void => {
    setPhase(next);
    // 確かめのボタンが消える前に移しておく
    resetButton.current?.focus();
  };

  const reset = (): void => {
    resetSettings()
      .then(() => {
        finish('done');
      })
      .catch((error: unknown) => {
        log.error('設定を最初の状態に戻すのに失敗しました', error);
        finish('idle');
      });
  };

  return (
    <div class="reset">
      <button
        ref={setResetButton}
        type="button"
        class="button-text"
        aria-expanded={phase === 'confirm'}
        aria-controls="reset-confirm"
        onClick={() => {
          setPhase('confirm');
        }}
      >
        {message('options_reset_button')}
      </button>
      <div
        id="reset-confirm"
        class="reset-confirm"
        role="group"
        aria-labelledby="reset-question"
        hidden={phase !== 'confirm'}
      >
        <p id="reset-question" class="reset-question">
          {message('options_reset_question')}
        </p>
        <div class="row">
          <button type="button" class="button button-danger-fill" onClick={reset}>
            {message('options_reset_confirm')}
          </button>
          <button
            ref={setCancelButton}
            type="button"
            class="button button-outline"
            onClick={() => {
              finish('idle');
            }}
          >
            {message('options_reset_cancel')}
          </button>
        </div>
      </div>
      <p class="saved" role="status">
        {phase === 'done' ? message('options_reset_done') : ''}
      </p>
    </div>
  );
}
