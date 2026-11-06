// ルビの右クリックから開く、読みを直す小さな窓。語と読みの欄、「決める」「やめる」（直した読みがあれば「元に戻す」）を出す。
// 保存したあとのルビは、直した読みの見張り（user-dictionary-feed）を通して付け直すので、ここでは出し直さない。
// 窓は showModal で開き、焦点を窓の中に閉じこめる。Esc で閉じ、閉じたら焦点を紙面に戻す。
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import { putUserDictionaryEntry, removeUserDictionaryEntry } from '@/settings/user-dictionary';

import {
  checkReadingFix,
  fixErrorMessage,
  type ReadingFixError,
  type ReadingFixForm,
  readingFixFormOf,
} from './reading-fix';
import type { PlacedRuby } from './ruby-hit';
import type { Box } from './transform';

/** 窓とルビの間（px） */
const DIALOG_GAP_PX = 8;
/** 窓と画面の端の間の下限（px） */
const DIALOG_MARGIN_PX = 8;
/** 保存したことの知らせを出しておく時間（ミリ秒） */
const STATUS_MS = 5000;

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

const log = createLogger('viewer');

/** 読みを直す窓 */
export interface ReadingFixDialog {
  /**
   * ルビのもとになった語の読みを直す窓を、そのルビの近くに開く。
   * @param ruby 右クリックしたルビ
   */
  open(ruby: PlacedRuby): void;
}

/**
 * 要素を作る。
 * @param tag 要素の名前
 * @param className class
 * @param text 中の文字
 * @returns 作った要素
 */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

/**
 * 窓を置く位置を出す。ルビの下に置き、入らなければ上に置き、画面の端からはみ出さないようにする。
 * @param target ルビ（画面の上の箱）
 * @param size 窓の幅と高さ
 * @param size.width 幅
 * @param size.height 高さ
 * @returns 窓の左上の位置
 */
function placeNear(
  target: Box,
  size: { readonly width: number; readonly height: number },
): { left: number; top: number } {
  const below = target.top + target.height + DIALOG_GAP_PX;
  const above = target.top - DIALOG_GAP_PX - size.height;
  const top = below + size.height <= innerHeight - DIALOG_MARGIN_PX ? below : above;
  const clamp = (value: number, room: number): number =>
    Math.max(DIALOG_MARGIN_PX, Math.min(value, room - DIALOG_MARGIN_PX));
  return {
    left: clamp(target.left, innerWidth - size.width),
    top: clamp(top, innerHeight - size.height),
  };
}

/**
 * 読みを直す窓を作り、画面に入れる。
 * @param returnFocus 窓を閉じたあと、焦点を戻す
 * @returns 読みを直す窓
 */
export function createReadingFixDialog(returnFocus: () => void): ReadingFixDialog {
  const text = (name: MessageName, substitutions?: string | string[]): string =>
    browser.i18n.getMessage(name, substitutions);

  const dialog = element('dialog', 'fix-dialog');
  dialog.setAttribute('aria-labelledby', 'fix-title');
  const form = element('form', 'fix-form');
  form.noValidate = true;
  const title = element('h2', 'fix-title');
  title.id = 'fix-title';
  const word = element('span', 'fix-word');
  title.append(element('span', 'fix-caption', text('viewer_fix_title')), word);
  const label = element('label', 'fix-label', text('viewer_fix_readingLabel'));
  label.htmlFor = 'fix-reading';
  const input = element('input', 'bar-field fix-input');
  Object.assign(input, { id: 'fix-reading', type: 'text', autocomplete: 'off', spellcheck: false });
  input.lang = 'ja';
  input.setAttribute('aria-describedby', 'fix-error fix-note');
  const error = element('p', 'fix-error');
  error.id = 'fix-error';
  error.setAttribute('role', 'alert');
  const note = element('p', 'fix-note', text('viewer_fix_note'));
  note.id = 'fix-note';
  // ボタンと欄の形は、バーの下の案内と同じものを使う
  const button = (name: MessageName, className: string): HTMLButtonElement => {
    const created = element('button', `bar-button ${className}`, text(name));
    created.type = 'button';
    return created;
  };
  const restore = button('viewer_fix_restore', 'notice-button fix-restore');
  const cancel = button('viewer_fix_cancel', 'notice-button');
  const save = button('viewer_fix_save', 'fix-save');
  save.type = 'submit';
  const actions = element('div', 'fix-actions');
  actions.append(restore, cancel, save);
  form.append(title, label, input, error, note, actions);
  dialog.append(form);
  // 保存したことの知らせ。窓を閉じたあとも読み上げられるよう、窓の外に置く
  const status = element('p', 'fix-status');
  status.setAttribute('role', 'status');
  document.body.append(dialog, status);

  let current: ReadingFixForm | undefined;
  let target: Box | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  // 理由を出して窓の高さが変わったときも、ルビを隠さないよう置き直す
  const place = (): void => {
    if (target === undefined || !dialog.open) return;
    const { left, top } = placeNear(target, {
      width: dialog.offsetWidth,
      height: dialog.offsetHeight,
    });
    dialog.style.left = `${String(left)}px`;
    dialog.style.top = `${String(top)}px`;
  };

  const showError = (reason: ReadingFixError | undefined, failed?: MessageName): void => {
    const [name, count] = reason === undefined ? [failed, undefined] : fixErrorMessage(reason);
    error.textContent = name === undefined ? '' : text(name, count);
    input.setAttribute('aria-invalid', String(reason?.field === 'reading'));
    place();
  };

  const announce = (message: string): void => {
    clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = setTimeout(() => {
      status.textContent = '';
    }, STATUS_MS);
  };

  const setBusy = (isBusy: boolean): void => {
    for (const control of [input, restore, cancel, save]) control.disabled = isBusy;
  };

  // 保存か削除をして、うまくいけば窓を閉じて知らせる。失敗したら窓を開いたまま、理由を出す
  const run = (work: Promise<unknown>, done: string): void => {
    setBusy(true);
    work
      .then(() => {
        dialog.close();
        announce(done);
      })
      .catch((cause: unknown) => {
        log.error('直した読みを保存できませんでした', cause);
        showError(undefined, 'options_dict_saveFailed');
      })
      .finally(() => {
        setBusy(false);
        // 失敗して窓が開いたままのときは、止めていた欄に焦点を戻す
        if (dialog.open) input.focus();
      });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (current === undefined) return;
    const checked = checkReadingFix(current, input.value);
    if (!checked.ok) {
      showError(checked.error);
      input.focus();
      return;
    }
    const { surface, reading } = checked.value;
    run(putUserDictionaryEntry(checked.value), text('viewer_fix_saved', [surface, reading]));
  });
  restore.addEventListener('click', () => {
    if (current === undefined) return;
    const { surface } = current;
    run(removeUserDictionaryEntry(surface), text('viewer_fix_restored', surface));
  });
  cancel.addEventListener('click', () => {
    dialog.close();
  });
  // 窓の外（背景）を押したときも閉じる。欄の字を選びながら外で離したときに閉じないよう、押したときに見る
  dialog.addEventListener('pointerdown', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    current = undefined;
    target = undefined;
    returnFocus();
  });

  return {
    open(ruby) {
      current = readingFixFormOf(ruby.box.word);
      target = ruby.rect;
      word.textContent = current.surface;
      input.value = current.reading;
      restore.hidden = !current.canRestore;
      showError(undefined);
      setBusy(false);
      dialog.showModal();
      place();
      input.focus();
      input.select();
    },
  };
}
