import type { JSX } from 'preact';
import { browser } from 'wxt/browser';

import { message } from './message';
import { ReportButton } from './report-button';

/** 同梱した部品のライセンスと辞書の出典を、読みやすく出す画面（src/entrypoints/licenses） */
const LICENSES_PATH = '/licenses.html';

/** プライバシーポリシー。リポジトリの docs/privacy.md を GitHub Pages で公開したもの */
const PRIVACY_POLICY_URL = 'https://masafumi0612.github.io/yomigana-pdf/privacy';

/**
 * 「この拡張について」。設定ではなく、拡張の情報（プライバシー・版・ライセンス）と、報告用の情報のコピーを出す。
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
        <a class="link" href={PRIVACY_POLICY_URL} target="_blank" rel="noopener">
          {message('options_about_privacyPolicy')}
        </a>
        <a class="link" href={LICENSES_PATH} target="_blank" rel="noopener">
          {message('options_about_licenses')}
        </a>
      </p>
      <ReportButton />
      <p>{message('options_about_version', browser.runtime.getManifest().version)}</p>
    </footer>
  );
}
