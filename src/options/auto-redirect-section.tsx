import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import { updateSettings } from '@/settings/storage';

import { ALL_SITES, isAutoRedirectShownOn } from './auto-redirect';
import { FileAccessRow } from './file-access-row';
import { message } from './message';

const log = createLogger('options');

/** 「PDF を開いたら、自動でルビを付ける」の場所に渡すもの */
export interface AutoRedirectSectionProps {
  /** 保存してあるスイッチの値 */
  readonly isEnabled: boolean;
  /** すべてのサイトを読む権限があるなら true */
  readonly hasHostAccess: boolean;
}

/**
 * 「PDF を開いたら、自動でルビを付ける」のスイッチと、パソコンの PDF のための許可の案内。
 * @param props 保存してある値と権限
 * @param props.isEnabled 保存してあるスイッチの値
 * @param props.hasHostAccess すべてのサイトを読む権限があるなら true
 * @returns スイッチの場所
 */
export function AutoRedirectSection({
  isEnabled,
  hasHostAccess,
}: AutoRedirectSectionProps): JSX.Element {
  const [isAsking, setIsAsking] = useState(false);
  const isOn = isAutoRedirectShownOn(isEnabled, hasHostAccess);

  const toggle = (): void => {
    if (isAsking) {
      return;
    }
    if (isOn) {
      // 権限は外さない。またオンにするときに、許可を求め直さずに済む
      updateSettings({ autoRedirect: false }).catch((error: unknown) => {
        log.error('スイッチを保存するのに失敗しました', error);
      });
      return;
    }
    setIsAsking(true);
    // 許可を求める画面は、押した操作の中で呼ばないと出ない。ほかを待つ前に呼ぶ
    browser.permissions
      .request(ALL_SITES)
      .then(async (isGranted) => {
        if (isGranted) {
          await updateSettings({ autoRedirect: true });
        }
      })
      .catch((error: unknown) => {
        log.error('スイッチをオンにするのに失敗しました', error);
      })
      .finally(() => {
        setIsAsking(false);
      });
  };

  return (
    <section class={isOn ? 'card card-on' : 'card'} aria-labelledby="auto-title">
      <div class="switch-row">
        <div class="heading">
          <h2 id="auto-title" class="card-title card-title-main">
            {message('options_auto_title')}
          </h2>
          <p id="auto-note" class="note">
            {message(isOn ? 'options_auto_noteOn' : 'options_auto_noteOff')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          class="switch"
          aria-checked={isOn}
          aria-labelledby="auto-title"
          aria-describedby="auto-note"
          onClick={toggle}
        >
          <span class="switch-knob" />
        </button>
      </div>
      <FileAccessRow />
    </section>
  );
}
