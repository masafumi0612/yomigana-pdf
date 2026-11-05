import type { JSX } from 'preact';
import { browser } from 'wxt/browser';

import { message } from './message';

/** 同梱した部品のライセンスと辞書の出典の文書。ビルドで拡張に写す（wxt.config.ts） */
const NOTICES_PATH = '/THIRD_PARTY_NOTICES.md';

/**
 * 「この拡張について」。設定ではなく、拡張の情報（プライバシー・版・ライセンス）を出す。
 * @returns 拡張の情報の場所
 */
export function AboutSection(): JSX.Element {
  return (
    <footer class="about" aria-labelledby="about-title">
      <h2 id="about-title" class="about-title">
        {message('options_about_title')}
      </h2>
      <ul class="about-list">
        <li>{message('options_about_privacyLocal')}</li>
        <li>{message('options_about_privacySites')}</li>
        <li>{message('options_about_privacySync')}</li>
        <li>{message('options_about_privacyProfiles')}</li>
      </ul>
      <p class="about-links">
        <a class="link" href={NOTICES_PATH} target="_blank" rel="noopener">
          {message('options_about_licenses')}
        </a>
      </p>
      <p>{message('options_about_version', browser.runtime.getManifest().version)}</p>
    </footer>
  );
}
