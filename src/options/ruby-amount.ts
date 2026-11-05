// 「ルビの量」の場所に並べる段階と、その名前・字の数
import type { MessageLookup, MessageName } from '@/settings/level-text';
import { countKanjiWithin, KANJI_TIERS, type KanjiTier } from '@/text/kanji-data';
import type { Level } from '@/text/types';

/** 小学校（学年別漢字配当表）の段階。すべての漢字にルビを付ける「なし」を先頭に置く */
export const ELEMENTARY_LEVELS: readonly Level[] = ['all', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6'];

/** 中学・高校（常用漢字）の段階 */
export const MIDDLE_LEVELS: readonly Level[] = ['m1', 'm2', 'joyo'];

/** 段階ごとの名前の文言と、その中の `$1` に入れる文字 */
const TIER_NAMES: Readonly<Record<KanjiTier, readonly [MessageName, string?]>> = {
  g1: ['options_amount_grade', '1'],
  g2: ['options_amount_grade', '2'],
  g3: ['options_amount_grade', '3'],
  g4: ['options_amount_grade', '4'],
  g5: ['options_amount_grade', '5'],
  g6: ['options_amount_grade', '6'],
  m1: ['options_amount_middle', '1'],
  m2: ['options_amount_middle', '2'],
  joyo: ['options_amount_joyo'],
};

/** 字の数の書き方（3けたごとに区切る。例：1,026） */
const COUNT_FORMAT = new Intl.NumberFormat('ja-JP');

/** 段階ごとの、それまでに習う字の数。画面を描き直すたびに数えないよう、一度だけ数える */
const KANJI_COUNTS: ReadonlyMap<KanjiTier, number> = new Map(
  KANJI_TIERS.map((tier) => [tier, countKanjiWithin(tier)]),
);

/** 選ぶ欄の1つに出す文字 */
export interface LevelChoiceText {
  /** 段階の名前（例：3年まで） */
  readonly name: string;
  /** 名前の下の説明（例：440字） */
  readonly note: string;
}

/**
 * 段階を選ぶ欄の1つに出す、名前と説明を作る。
 * @param level 段階
 * @param message 文言を引く関数
 * @returns 名前と説明
 */
export function levelChoiceText(level: Level, message: MessageLookup): LevelChoiceText {
  if (level === 'all') {
    return { name: message('options_amount_none'), note: message('options_amount_noneNote') };
  }
  const [name, substitution] = TIER_NAMES[level];
  const count = COUNT_FORMAT.format(KANJI_COUNTS.get(level) ?? 0);
  return { name: message(name, substitution), note: message('options_amount_count', count) };
}
