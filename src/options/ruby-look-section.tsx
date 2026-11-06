import type { JSX } from 'preact';

import { createLogger } from '@/log';
import {
  RUBY_COLORS,
  RUBY_SIZE_RATIOS,
  type RubyColor,
  type RubySize,
  type RubyStyle,
} from '@/settings/model';
import { getSettings, updateSettings } from '@/settings/storage';

import { message, type MessageName } from './message';
import { RubyText } from './ruby-text';

const log = createLogger('options');

/** 大きさの選択肢と、その名前 */
const SIZE_CHOICES: readonly (readonly [RubySize, MessageName])[] = [
  ['s', 'options_look_sizeS'],
  ['m', 'options_look_sizeM'],
  ['l', 'options_look_sizeL'],
];

/** 色の選択肢と、その名前 */
const COLOR_CHOICES: readonly (readonly [RubyColor, MessageName])[] = [
  ['ink', 'options_look_colorInk'],
  ['blue', 'options_look_colorBlue'],
  ['orange', 'options_look_colorOrange'],
];

/** 続けて変えたときに、前の保存を待ってから次を保存するための鎖 */
let savingQueue: Promise<void> = Promise.resolve();

/**
 * ルビの見た目の一部を変えて保存する。見た目は1つのまとまりで保存するので、
 * ほかの項目を古い値で上書きしないよう、保存してある今の値に重ね、続けて変えたときは順に保存する。
 * @param change 変える項目
 */
function saveRubyStyle(change: Partial<RubyStyle>): void {
  savingQueue = savingQueue
    .then(async () => {
      const { rubyStyle } = await getSettings();
      await updateSettings({ rubyStyle: { ...rubyStyle, ...change } });
    })
    .catch((error: unknown) => {
      log.error('ルビの見た目を保存するのに失敗しました', error);
    });
}

/** 「ルビの見た目」の場所に渡すもの */
export interface RubyLookSectionProps {
  /** 保存してあるルビの見た目 */
  readonly rubyStyle: RubyStyle;
}

/**
 * 「ルビの見た目」の場所。大きさ・色・帯を選ぶとすぐ保存し、横書きと縦書きの見本に映す。
 * @param props 保存してある見た目
 * @param props.rubyStyle 保存してあるルビの見た目
 * @returns ルビの見た目の場所
 */
export function RubyLookSection({ rubyStyle }: RubyLookSectionProps): JSX.Element {
  const { size, color, hasBand } = rubyStyle;
  const previewStyle = {
    '--preview-ruby-size': `${String(RUBY_SIZE_RATIOS[size])}em`,
    '--preview-ruby-color': RUBY_COLORS[color],
  };

  return (
    <section class="card" aria-labelledby="look-title">
      <div class="heading">
        <h2 id="look-title" class="card-title">
          {message('options_look_title')}
        </h2>
        <p class="lead">{message('options_look_lead')}</p>
      </div>
      <div class="look-fields">
        <fieldset class="look-field">
          <legend class="field-label">{message('options_look_size')}</legend>
          <div class="segments">
            {SIZE_CHOICES.map(([choice, name]) => (
              <label key={choice} class="segment">
                <input
                  class="visually-hidden"
                  type="radio"
                  name="ruby-size"
                  value={choice}
                  checked={choice === size}
                  onChange={() => {
                    saveRubyStyle({ size: choice });
                  }}
                />
                <span>{message(name)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="look-field">
          <legend class="field-label">{message('options_look_color')}</legend>
          <div class="row">
            {COLOR_CHOICES.map(([choice, name]) => (
              <label key={choice} class="color-choice">
                <input
                  class="visually-hidden"
                  type="radio"
                  name="ruby-color"
                  value={choice}
                  checked={choice === color}
                  onChange={() => {
                    saveRubyStyle({ color: choice });
                  }}
                />
                <span class="color-swatch" style={{ background: RUBY_COLORS[choice] }} />
                <span>{message(name)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="look-field look-field-band">
          <legend class="field-label">{message('options_look_band')}</legend>
          <label class="band-choice">
            <input
              type="checkbox"
              checked={hasBand}
              aria-describedby="band-note"
              onChange={(event) => {
                saveRubyStyle({ hasBand: event.currentTarget.checked });
              }}
            />
            <span>{message('options_look_bandLabel')}</span>
          </label>
          <p id="band-note" class="band-note">
            {message('options_look_bandNote')}
          </p>
        </fieldset>
      </div>
      <div class={hasBand ? 'previews previews-band' : 'previews'} style={previewStyle}>
        <div class="preview">
          <p class="preview-label">{message('options_look_horizontal')}</p>
          <p class="preview-text">
            <RubyText text={message('options_look_horizontalText')} />
          </p>
        </div>
        <div class="preview preview-vertical">
          <p class="preview-label">{message('options_look_vertical')}</p>
          <p class="preview-text">
            <RubyText text={message('options_look_verticalText')} />
          </p>
        </div>
      </div>
    </section>
  );
}
