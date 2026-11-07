import type { JSX } from 'preact';

import { createLogger } from '@/log';
import { levelAmountText } from '@/settings/level-text';
import { updateSettings } from '@/settings/storage';
import type { Level } from '@/text/types';

import { message, type MessageName } from './message';
import { ELEMENTARY_LEVELS, levelChoiceText, MIDDLE_LEVELS } from './ruby-amount';
import { RubyText } from './ruby-text';

const log = createLogger('options');

/** どの段階でもルビが付く文字の見本（種類・呼び名・ルビ付きの例） */
const ALWAYS_EXAMPLES: readonly (readonly [MessageName, MessageName, MessageName])[] = [
  [
    'options_amount_hyogaiChar',
    'options_amount_hyogaiCharTerm',
    'options_amount_hyogaiCharExample',
  ],
  ['options_amount_jukujikun', 'options_amount_jukujikunTerm', 'options_amount_jukujikunExample'],
  [
    'options_amount_hyogaiReading',
    'options_amount_hyogaiReadingTerm',
    'options_amount_hyogaiReadingExample',
  ],
];

/** 段階のまとまり（小学校・中学と高校）に渡すもの */
interface LevelGroupProps {
  /** まとまりの id（説明の id に使う） */
  readonly id: string;
  /** まとまりの名前 */
  readonly legend: MessageName;
  /** 名前の横に出す説明 */
  readonly note?: MessageName;
  readonly levels: readonly Level[];
  /** 保存してある段階 */
  readonly current: Level;
  /**
   * 段階を選んだ
   * @param level 選んだ段階
   */
  readonly onChoose: (level: Level) => void;
}

/**
 * 段階のまとまり。どのまとまりのラジオボタンも同じ名前にして、矢印キーで続けて選べるようにする。
 * @param props まとまりの作り方
 * @returns まとまり
 */
function LevelGroup(props: LevelGroupProps): JSX.Element {
  const { id, legend, note, levels, current, onChoose } = props;
  const noteId = `${id}-note`;
  return (
    <fieldset class="level-group" aria-describedby={note === undefined ? undefined : noteId}>
      <legend class="level-legend">{message(legend)}</legend>
      {note !== undefined && (
        <p id={noteId} class="level-group-note">
          {message(note)}
        </p>
      )}
      <div class="level-grid">
        {levels.map((level) => {
          const text = levelChoiceText(level, message);
          return (
            <label key={level} class="level-choice">
              <input
                type="radio"
                name="level"
                value={level}
                checked={level === current}
                onChange={() => {
                  onChoose(level);
                }}
              />
              <span class="level-text">
                <span class="level-name">{text.name}</span>
                <span class="level-note">{text.note}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 「ルビの量」の場所に渡すもの */
export interface RubyAmountSectionProps {
  /** 保存してある段階 */
  readonly level: Level;
  /** 見出しを受け取る。リーダーから開いたとき、この場所を上に出して見出しに移るのに使う */
  readonly titleRef?: (element: HTMLHeadingElement | null) => void;
}

/**
 * 「ルビの量：ルビを付けない漢字の範囲」の場所。段階を選ぶと、すぐ保存する。
 * @param props 保存してある段階と、見出しを受け取る関数
 * @param props.level 保存してある段階
 * @param props.titleRef 見出しを受け取る関数
 * @returns ルビの量の場所
 */
export function RubyAmountSection({ level, titleRef }: RubyAmountSectionProps): JSX.Element {
  const choose = (next: Level): void => {
    updateSettings({ level: next }).catch((error: unknown) => {
      log.error('ルビの量を保存するのに失敗しました', error);
    });
  };

  return (
    <section class="card" aria-labelledby="amount-title">
      <div class="heading">
        <h2 ref={titleRef} id="amount-title" class="card-title" tabIndex={-1}>
          {message('options_amount_title')}
        </h2>
        <p class="note">
          {message('options_amount_lead')}
          {message('options_amount_current')}
          <b>{levelAmountText(level, message)}</b>
        </p>
      </div>
      <LevelGroup
        id="amount-elementary"
        legend="options_amount_elementary"
        levels={ELEMENTARY_LEVELS}
        current={level}
        onChoose={choose}
      />
      <LevelGroup
        id="amount-middle"
        legend="options_amount_middleGroup"
        note="options_amount_middleNote"
        levels={MIDDLE_LEVELS}
        current={level}
        onChoose={choose}
      />
      <div class="always">
        <h3 id="always-title" class="always-title">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
          </svg>
          <span>{message('options_amount_alwaysTitle')}</span>
        </h3>
        <ul class="always-list" aria-labelledby="always-title">
          {ALWAYS_EXAMPLES.map(([kind, term, example]) => (
            <li key={kind} class="always-item">
              <span class="always-kind">
                <b>{message(kind)}</b>
                {message(term)}
              </span>
              <span class="always-example">
                <RubyText text={message(example)} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
