import type { JSX } from 'preact';

import { AboutSection } from './about-section';
import { AutoRedirectSection } from './auto-redirect-section';
import { useHostAccess, useSettings } from './hooks';
import { message } from './message';
import { OpenPdfSection } from './open-pdf-section';
import { ResetSettings } from './reset-settings';
import { RubyAmountSection } from './ruby-amount-section';
import { UserDictionarySection } from './user-dictionary-section';

/**
 * 設定の画面の全体。白い枠は設定、枠のない下の場所は拡張の情報。場所ごとに部品を分けて並べる。
 * @returns 設定の画面
 */
export function App(): JSX.Element {
  const settings = useSettings();
  const hasHostAccess = useHostAccess();

  return (
    <div class="page">
      <header class="header">
        <div class="heading">
          <h1 class="title">{message('options_header_title')}</h1>
          <p class="lead">{message('options_header_lead')}</p>
        </div>
        <p class="header-saved">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M5 12l5 5 9-10" />
          </svg>
          <span>{message('options_header_saved')}</span>
        </p>
      </header>
      <main class="main">
        {/* 初めて入れたときの案内は、ここに足す */}
        {settings !== undefined && (
          <AutoRedirectSection isEnabled={settings.autoRedirect} hasHostAccess={hasHostAccess} />
        )}
        <OpenPdfSection />
        {settings !== undefined && <RubyAmountSection level={settings.level} />}
        <UserDictionarySection />
        <ResetSettings />
      </main>
      <AboutSection />
    </div>
  );
}
