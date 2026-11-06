import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { createLogger } from '@/log';
import type { Result } from '@/result';

import { message } from './message';
import { type Block, type Inline, parseNotices } from './notices-markdown';

const log = createLogger('licenses');

/** 画面に出す同梱の文書の、拡張の中の置き場所。ビルドで拡張に写す（wxt.config.ts） */
const FILES = {
  notices: '/THIRD_PARTY_NOTICES.md',
  license: '/LICENSE',
  apache: '/licenses/Apache-2.0.txt',
  ofl: '/licenses/OFL-1.1.txt',
} as const;

/** 同梱の文書の中身 */
type LicenseTexts = Record<keyof typeof FILES, string>;

/** 同梱の文書を読んだ結果。まだ読んでいなければ undefined */
type LoadState = Result<LicenseTexts, 'unreadable'> | undefined;

/** 見出し（`##`）ごとに分けた文書の1つの場所 */
interface NoticeSection {
  readonly title: readonly Inline[];
  readonly blocks: readonly Block[];
}

/**
 * 同梱の文書をすべて読む。拡張の中のファイルなので、外には読みに行かない。
 * @returns 文書の中身。どれか1つでも読めなければ失敗
 */
async function loadTexts(): Promise<Result<LicenseTexts, 'unreadable'>> {
  try {
    const entries = await Promise.all(
      Object.entries(FILES).map(async ([key, path]) => {
        const response = await fetch(path);
        return [key, response.ok ? await response.text() : undefined] as const;
      }),
    );
    if (entries.some(([, text]) => text === undefined)) {
      return { ok: false, error: 'unreadable' };
    }
    return { ok: true, value: Object.fromEntries(entries) as LicenseTexts };
  } catch (error: unknown) {
    // 拡張の中のファイルがないときは、fetch が throw する
    log.error('同梱の文書を読むのに失敗しました', error);
    return { ok: false, error: 'unreadable' };
  }
}

/**
 * 文書を見出し（`##`）ごとに分ける。いちばん上の見出し（`#`）は画面の見出しと同じなので出さない。
 * @param blocks 文書のかたまり
 * @returns 最初の見出しより前のかたまりと、見出しごとの場所
 */
function splitSections(blocks: readonly Block[]): {
  intro: Block[];
  sections: NoticeSection[];
} {
  const intro: Block[] = [];
  const sections: { title: readonly Inline[]; blocks: Block[] }[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level === 1) {
      continue;
    }
    if (block.kind === 'heading' && block.level === 2) {
      sections.push({ title: block.inlines, blocks: [] });
      continue;
    }
    (sections.at(-1)?.blocks ?? intro).push(block);
  }
  return { intro, sections };
}

/**
 * 文の部分を画面の部品にする。URL は新しいタブで開く。
 * @param props 出す文
 * @param props.inlines 文の部分
 * @returns 文
 */
function InlineText({ inlines }: { inlines: readonly Inline[] }): JSX.Element {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.kind === 'code') {
          return <code key={index}>{inline.text}</code>;
        }
        if (inline.kind === 'link') {
          return (
            <a key={index} class="link" href={inline.href} target="_blank" rel="noopener">
              {inline.href}
            </a>
          );
        }
        return inline.text;
      })}
    </>
  );
}

/**
 * 文書の1つのかたまりを画面の部品にする。
 * @param props 出すかたまり
 * @param props.block 文書のかたまり
 * @returns 見出し・段落・箇条書き・表・そのままの文
 */
function NoticeBlock({ block }: { block: Block }): JSX.Element {
  switch (block.kind) {
    case 'heading': {
      return (
        <h3 class="notice-subtitle">
          <InlineText inlines={block.inlines} />
        </h3>
      );
    }
    case 'paragraph': {
      return (
        <p>
          <InlineText inlines={block.inlines} />
        </p>
      );
    }
    case 'list': {
      return (
        <ul class="notice-list">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineText inlines={item} />
            </li>
          ))}
        </ul>
      );
    }
    case 'code': {
      return <pre class="license-text">{block.text}</pre>;
    }
    case 'table': {
      return (
        <table class="notice-table">
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={index} scope="col">
                  <InlineText inlines={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index}>
                    <InlineText inlines={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
  }
}

/**
 * 「ライセンスと出典」の画面。同梱した THIRD_PARTY_NOTICES.md と LICENSE、ライセンスの全文を読みやすく出す。
 * 文書そのものも拡張に同梱しているので、画面の下から開けるようにする。
 * @returns ライセンスと出典の画面
 */
export function LicensesPage(): JSX.Element {
  const [state, setState] = useState<LoadState>(undefined);

  useEffect(() => {
    loadTexts()
      .then(setState)
      .catch((error: unknown) => {
        log.error('同梱の文書を出すのに失敗しました', error);
      });
  }, []);

  const notices = state?.ok === true ? splitSections(parseNotices(state.value.notices)) : undefined;

  return (
    <div class="page">
      <header class="header">
        <div class="heading">
          <h1 class="title">{message('licenses_header_title')}</h1>
          {notices?.intro.map((block, index) => (
            <div key={index} class="lead">
              <NoticeBlock block={block} />
            </div>
          ))}
        </div>
      </header>
      <main class="main" aria-busy={state === undefined}>
        {state?.ok === false && <p class="error">{message('licenses_main_loadFailed')}</p>}
        {state?.ok === true && notices !== undefined && (
          <>
            <section class="card" aria-labelledby="license-own">
              <h2 id="license-own" class="card-title">
                {message('licenses_own_title')}
              </h2>
              <p class="note">{message('licenses_own_note')}</p>
              <pre class="license-text">{state.value.license}</pre>
            </section>
            {notices.sections.map((section, index) => (
              <section key={index} class="card" aria-labelledby={`notice-${String(index)}`}>
                <h2 id={`notice-${String(index)}`} class="card-title">
                  <InlineText inlines={section.title} />
                </h2>
                {section.blocks.map((block, blockIndex) => (
                  <NoticeBlock key={blockIndex} block={block} />
                ))}
              </section>
            ))}
            <section class="card" aria-labelledby="license-full">
              <h2 id="license-full" class="card-title">
                {message('licenses_full_title')}
              </h2>
              <p class="note">{message('licenses_full_note')}</p>
              <details class="license-full">
                <summary>{message('licenses_full_apache')}</summary>
                <pre class="license-text">{state.value.apache}</pre>
              </details>
              <details class="license-full">
                <summary>{message('licenses_full_ofl')}</summary>
                <pre class="license-text">{state.value.ofl}</pre>
              </details>
            </section>
          </>
        )}
      </main>
      <footer class="about" aria-labelledby="files-title">
        <h2 id="files-title" class="about-title">
          {message('licenses_files_title')}
        </h2>
        <ul class="about-list">
          {Object.values(FILES).map((path) => (
            <li key={path}>
              <a class="link" href={path} target="_blank" rel="noopener">
                {path.slice(1)}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
