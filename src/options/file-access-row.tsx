import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';

import { useFileSchemeAccess } from './hooks';
import { message } from './message';

const log = createLogger('options');

/**
 * パソコンに保存した PDF も自動で移すための、ファイルの URL へのアクセスの状態と、許可の手順。
 * 許可は拡張から変えられないので、Chrome の拡張機能の画面を開く。
 * @returns 許可の状態の行
 */
export function FileAccessRow(): JSX.Element {
  const isAllowed = useFileSchemeAccess();
  const [isStepsShown, setIsStepsShown] = useState(false);
  const isNeeded = isAllowed === false;

  const openExtensions = (): void => {
    browser.tabs
      .create({ url: `chrome://extensions/?id=${browser.runtime.id}` })
      .catch((error: unknown) => {
        log.error('拡張機能の画面を開くのに失敗しました', error);
      });
  };

  return (
    <div class="sub">
      <div class="sub-row">
        <p class="sub-label">{message('options_file_label')}</p>
        {isAllowed === true && (
          <span class="badge badge-ok">{message('options_file_allowed')}</span>
        )}
        {isNeeded && (
          <>
            <span class="badge badge-warn">{message('options_file_needed')}</span>
            <button
              type="button"
              class="button button-outline"
              aria-expanded={isStepsShown}
              aria-controls="file-steps"
              onClick={() => {
                setIsStepsShown(!isStepsShown);
              }}
            >
              {message(isStepsShown ? 'options_file_hideSteps' : 'options_file_showSteps')}
            </button>
          </>
        )}
      </div>
      {isNeeded && (
        <div id="file-steps" class="steps" hidden={!isStepsShown}>
          <ol class="steps-list">
            <li>{message('options_file_step1')}</li>
            <li>{message('options_file_step2')}</li>
          </ol>
          <div class="row">
            <button type="button" class="button button-primary" onClick={openExtensions}>
              {message('options_file_openExtensions')}
            </button>
            <span class="hint">{message('options_file_school')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
