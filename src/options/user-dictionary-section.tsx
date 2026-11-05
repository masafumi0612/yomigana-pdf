import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { createLogger } from '@/log';
import {
  MAX_READING_LENGTH,
  MAX_SURFACE_LENGTH,
  parseReading,
  parseSurface,
  type ReadingInputError,
  type SurfaceError,
  type UserDictionaryEntry,
} from '@/settings/dictionary-entry';
import { putUserDictionaryEntry, removeUserDictionaryEntry } from '@/settings/user-dictionary';

import { useElement, useUserDictionary } from './hooks';
import { message, type MessageName } from './message';

const log = createLogger('options');

/** 言葉を受け付けなかった理由の文言 */
const SURFACE_ERRORS: Readonly<Record<SurfaceError, MessageName>> = {
  empty: 'options_dict_surfaceEmpty',
  'too-long': 'options_dict_surfaceTooLong',
  'no-kanji': 'options_dict_surfaceNoKanji',
};

/** 読みを受け付けなかった理由の文言 */
const READING_ERRORS: Readonly<Record<ReadingInputError, MessageName>> = {
  empty: 'options_dict_readingEmpty',
  'not-hiragana': 'options_dict_readingNotHiragana',
  'too-long': 'options_dict_readingTooLong',
};

/**
 * 言葉を受け付けなかった理由を文にする。
 * @param error 理由
 * @returns 欄の下に出す文
 */
function surfaceErrorText(error: SurfaceError | undefined): string {
  return error === undefined ? '' : message(SURFACE_ERRORS[error], String(MAX_SURFACE_LENGTH));
}

/**
 * 読みを受け付けなかった理由を文にする。
 * @param error 理由
 * @returns 欄の下に出す文
 */
function readingErrorText(error: ReadingInputError | undefined): string {
  return error === undefined ? '' : message(READING_ERRORS[error], String(MAX_READING_LENGTH));
}

/** 一覧の1行の作り方 */
interface DictionaryRowProps {
  readonly entry: UserDictionaryEntry;
  /** 行の番号（欄の id に使う） */
  readonly index: number;
  /**
   * 読みを変える
   * @param entry 変えたあとの1件
   * @returns 保存できたら true
   */
  readonly onChange: (entry: UserDictionaryEntry) => Promise<boolean>;
  /**
   * 元に戻す（消す）
   * @param entry 消す1件
   */
  readonly onRemove: (entry: UserDictionaryEntry) => void;
}

/**
 * 直した読みの一覧の1行。「読みを変える」で、その場で読みの欄に変わる。
 * @param props 行の作り方
 * @returns 一覧の1行
 */
function DictionaryRow(props: DictionaryRowProps): JSX.Element {
  const { entry, index, onChange, onRemove } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(entry.reading);
  const [error, setError] = useState<ReadingInputError | undefined>(undefined);
  const [changeButton, setChangeButton] = useElement<HTMLButtonElement>();
  const [input, setInput] = useElement<HTMLInputElement>();
  // 欄を閉じたら、キーボードで操作している人が迷わないよう「読みを変える」に戻る
  const isReturningFocus = useRef(false);
  const inputId = `dict-edit-${String(index)}`;
  const errorId = `${inputId}-error`;

  useEffect(() => {
    if (isEditing) {
      input.current?.focus();
    } else if (isReturningFocus.current) {
      isReturningFocus.current = false;
      changeButton.current?.focus();
    }
  }, [isEditing]);

  const close = (): void => {
    isReturningFocus.current = true;
    setError(undefined);
    setIsEditing(false);
  };

  const save = (event: SubmitEvent): void => {
    event.preventDefault();
    const parsed = parseReading(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    onChange({ surface: entry.surface, reading: parsed.value })
      .then((isSaved) => {
        if (isSaved) close();
      })
      .catch((cause: unknown) => {
        log.error('読みを変えるのに失敗しました', cause);
      });
  };

  return (
    <li class="dict-row">
      <span class="dict-word">
        <ruby>
          {entry.surface}
          <rt>{entry.reading}</rt>
        </ruby>
      </span>
      {isEditing ? (
        <form
          class="dict-edit"
          noValidate
          onSubmit={save}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        >
          <label for={inputId} class="visually-hidden">
            {message('options_dict_editLabel', entry.surface)}
          </label>
          <div class="row">
            <input
              ref={setInput}
              id={inputId}
              class="field dict-edit-field"
              type="text"
              autoComplete="off"
              value={text}
              aria-invalid={error !== undefined}
              aria-describedby={errorId}
              onInput={(event) => {
                setText(event.currentTarget.value);
              }}
            />
            <button type="submit" class="button button-primary">
              {message('options_dict_save')}
            </button>
            <button type="button" class="button button-outline" onClick={close}>
              {message('options_dict_cancel')}
            </button>
          </div>
          <p id={errorId} class="error" role="alert">
            {readingErrorText(error)}
          </p>
        </form>
      ) : (
        <div class="row dict-actions">
          <button
            ref={setChangeButton}
            type="button"
            class="button button-outline"
            aria-label={message('options_dict_changeLabel', entry.surface)}
            onClick={() => {
              setText(entry.reading);
              setIsEditing(true);
            }}
          >
            {message('options_dict_change')}
          </button>
          <button
            type="button"
            class="button button-quiet"
            aria-label={message('options_dict_removeLabel', entry.surface)}
            onClick={() => {
              onRemove(entry);
            }}
          >
            {message('options_dict_remove')}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * 「直した読み」の場所。直した読みの一覧（読みを変える・元に戻す）と、言葉と読みを足す欄。
 * @returns 直した読みの場所
 */
export function UserDictionarySection(): JSX.Element {
  const dictionary = useUserDictionary();
  const [surfaceText, setSurfaceText] = useState('');
  const [readingText, setReadingText] = useState('');
  const [surfaceError, setSurfaceError] = useState<SurfaceError | undefined>(undefined);
  const [readingError, setReadingError] = useState<ReadingInputError | undefined>(undefined);
  const [status, setStatus] = useState('');
  const [hasFailed, setHasFailed] = useState(false);
  const [list, setList] = useElement<HTMLUListElement>();
  const [surfaceInput, setSurfaceInput] = useElement<HTMLInputElement>();
  const entries = dictionary?.entries ?? [];

  const save = async (entry: UserDictionaryEntry, done: MessageName): Promise<boolean> => {
    try {
      await putUserDictionaryEntry(entry);
    } catch (error) {
      log.error('直した読みを保存できませんでした', error);
      setHasFailed(true);
      return false;
    }
    setHasFailed(false);
    setStatus(message(done, entry.surface));
    return true;
  };

  const add = (event: SubmitEvent): void => {
    event.preventDefault();
    const surface = parseSurface(surfaceText);
    const reading = parseReading(readingText);
    setSurfaceError(surface.ok ? undefined : surface.error);
    setReadingError(reading.ok ? undefined : reading.error);
    if (!surface.ok || !reading.ok) {
      return;
    }
    const isExisting = entries.some((entry) => entry.surface === surface.value);
    save(
      { surface: surface.value, reading: reading.value },
      isExisting ? 'options_dict_changed' : 'options_dict_added',
    )
      .then((isSaved) => {
        if (!isSaved) return;
        setSurfaceText('');
        setReadingText('');
        surfaceInput.current?.focus();
      })
      .catch((error: unknown) => {
        log.error('言葉と読みを足すのに失敗しました', error);
      });
  };

  const remove = (entry: UserDictionaryEntry): void => {
    // 押したボタンは消えるので、一覧そのものに移る
    list.current?.focus();
    removeUserDictionaryEntry(entry.surface)
      .then(() => {
        setHasFailed(false);
        setStatus(message('options_dict_removed', entry.surface));
      })
      .catch((error: unknown) => {
        log.error('直した読みを元に戻せませんでした', error);
        setHasFailed(true);
      });
  };

  return (
    <section class="card" aria-labelledby="dict-title">
      <div class="heading">
        <h2 id="dict-title" class="card-title">
          {message('options_dict_title')}
        </h2>
        <p class="lead">{message('options_dict_lead')}</p>
      </div>
      {dictionary?.area === 'local' && <p class="dict-local">{message('options_dict_local')}</p>}
      <ul ref={setList} class="dict-list" aria-labelledby="dict-title" tabIndex={-1}>
        {entries.length === 0 ? (
          <li class="dict-empty">{message('options_dict_empty')}</li>
        ) : (
          entries.map((entry, index) => (
            <DictionaryRow
              key={entry.surface}
              entry={entry}
              index={index}
              onChange={(changed) => save(changed, 'options_dict_changed')}
              onRemove={remove}
            />
          ))
        )}
      </ul>
      <form class="dict-form" noValidate aria-labelledby="dict-add-title" onSubmit={add}>
        <h3 id="dict-add-title" class="field-label">
          {message('options_dict_addTitle')}
        </h3>
        <div class="dict-fields">
          <div class="dict-field">
            <label for="dict-surface">{message('options_dict_surfaceLabel')}</label>
            <input
              ref={setSurfaceInput}
              id="dict-surface"
              class="field"
              type="text"
              autoComplete="off"
              placeholder={message('options_dict_surfacePlaceholder')}
              value={surfaceText}
              aria-invalid={surfaceError !== undefined}
              aria-describedby="dict-surface-error dict-add-hint"
              onInput={(event) => {
                setSurfaceText(event.currentTarget.value);
              }}
            />
            <p id="dict-surface-error" class="error" role="alert">
              {surfaceErrorText(surfaceError)}
            </p>
          </div>
          <div class="dict-field">
            <label for="dict-reading">{message('options_dict_readingLabel')}</label>
            <input
              id="dict-reading"
              class="field"
              type="text"
              autoComplete="off"
              placeholder={message('options_dict_readingPlaceholder')}
              value={readingText}
              aria-invalid={readingError !== undefined}
              aria-describedby="dict-reading-error"
              onInput={(event) => {
                setReadingText(event.currentTarget.value);
              }}
            />
            <p id="dict-reading-error" class="error" role="alert">
              {readingErrorText(readingError)}
            </p>
          </div>
          <button type="submit" class="button button-primary button-large dict-add">
            {message('options_dict_add')}
          </button>
        </div>
        <p id="dict-add-hint" class="hint">
          {message('options_dict_addHint')}
        </p>
      </form>
      <p class="error" role="alert">
        {hasFailed ? message('options_dict_saveFailed') : ''}
      </p>
      {/* 設定を戻すボタンの知らせ（role="status"）と分けるため、aria-live で読み上げる */}
      <p class="saved" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
