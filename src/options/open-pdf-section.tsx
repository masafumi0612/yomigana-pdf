import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import { isPdfFile } from '@/viewer/source';

import { useElement } from './hooks';
import { message, type MessageName } from './message';
import {
  hostPatternOf,
  namedBlobUrl,
  parseWebPdfUrl,
  readerUrlFor,
  type WebPdfUrlError,
} from './open-pdf';

const log = createLogger('options');

/** URL の欄の下に出す、開けなかった理由の文言 */
const URL_ERROR_MESSAGES: Readonly<Record<WebPdfUrlError | 'denied', MessageName>> = {
  empty: 'options_open_urlEmpty',
  invalid: 'options_open_urlInvalid',
  denied: 'options_open_urlDenied',
};

/**
 * リーダーを新しいタブで開く。
 * @param pdfUrl 開く PDF の URL
 */
export function openReader(pdfUrl: string): void {
  browser.tabs
    .create({ url: readerUrlFor(browser.runtime.getURL('/viewer.html'), pdfUrl) })
    .catch((error: unknown) => {
      log.error('リーダーを開くのに失敗しました', error);
    });
}

/**
 * 「PDF を選んでルビ付きで開く」の場所。パソコンの PDF（選ぶ・ドラッグする）と、Web の PDF の URL から開く。
 * @returns 開く場所
 */
export function OpenPdfSection(): JSX.Element {
  const [fileInput, setFileInput] = useElement<HTMLInputElement>();
  const [isNotPdf, setIsNotPdf] = useState(false);
  const [urlText, setUrlText] = useState('');
  const [urlError, setUrlError] = useState<WebPdfUrlError | 'denied' | undefined>(undefined);

  const openFile = (file: File | undefined): void => {
    if (file === undefined) {
      return;
    }
    if (!isPdfFile(file)) {
      setIsNotPdf(true);
      return;
    }
    setIsNotPdf(false);
    // この URL は、この画面を閉じるまで同じ拡張の画面（リーダー）から読める
    openReader(namedBlobUrl(URL.createObjectURL(file), file.name));
  };

  useEffect(() => {
    const allowDrop = (event: DragEvent): void => {
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };
    const drop = (event: DragEvent): void => {
      event.preventDefault();
      openFile(event.dataTransfer?.files[0]);
    };
    document.addEventListener('dragover', allowDrop);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragover', allowDrop);
      document.removeEventListener('drop', drop);
    };
  }, []);

  const submitUrl = (event: SubmitEvent): void => {
    event.preventDefault();
    const parsed = parseWebPdfUrl(urlText);
    if (!parsed.ok) {
      setUrlError(parsed.error);
      return;
    }
    setUrlError(undefined);
    const pdfUrl = parsed.value;
    // 許可を求める画面は、押した操作の中で呼ばないと出ない。ほかを待つ前に呼ぶ
    browser.permissions
      .request({ origins: [hostPatternOf(pdfUrl)] })
      .then((isGranted) => {
        if (isGranted) {
          openReader(pdfUrl.href);
        } else {
          setUrlError('denied');
        }
      })
      .catch((error: unknown) => {
        log.error('サイトを読む許可を求めるのに失敗しました', error);
      });
  };

  return (
    <section class="card" aria-labelledby="open-title">
      <div class="heading">
        <h2 id="open-title" class="card-title">
          {message('options_open_title')}
        </h2>
        <p class="lead">{message('options_open_lead')}</p>
      </div>
      <div class="row">
        <button
          type="button"
          class="button button-primary button-large"
          onClick={() => fileInput.current?.click()}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span>{message('options_open_chooseFile')}</span>
        </button>
        <span class="hint">{message('options_open_dropHint')}</span>
        <input
          ref={setFileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            const input = event.currentTarget;
            openFile(input.files?.[0]);
            // 同じファイルをもう一度選んでも開けるよう、選んだものを空にする
            input.value = '';
          }}
        />
      </div>
      <p class="error" role="alert">
        {isNotPdf ? message('options_open_notPdf') : ''}
      </p>
      <form class="url-form" noValidate onSubmit={submitUrl}>
        <label for="pdf-url" class="field-label">
          {message('options_open_urlLabel')}
        </label>
        <div class="row">
          <input
            id="pdf-url"
            class="field"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder={message('options_open_urlPlaceholder')}
            value={urlText}
            aria-invalid={urlError !== undefined}
            aria-describedby="pdf-url-error pdf-url-hint"
            onInput={(event) => {
              setUrlText(event.currentTarget.value);
            }}
          />
          <button type="submit" class="button button-outline button-large">
            {message('options_open_urlSubmit')}
          </button>
        </div>
        <p id="pdf-url-error" class="error" role="alert">
          {urlError === undefined ? '' : message(URL_ERROR_MESSAGES[urlError])}
        </p>
        <p id="pdf-url-hint" class="hint">
          {message('options_open_urlHint')}
        </p>
      </form>
    </section>
  );
}
