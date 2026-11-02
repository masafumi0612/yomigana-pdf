// 字ごとに分けた語に、利用者の段階に合わせてルビを付けるかを決める（方式 C：まだ習っていない字にだけ付ける）
import { getKanjiTier, isTierWithin } from './kanji-data';
import type { Level, RubyPiece, Seg, SplitResult } from './types';

/**
 * 1語の字ごとに、ルビを付けるかを決める。
 * @param result 字ごとに分けた1語
 * @param level 利用者が選んだ段階
 * @returns seg と同じ順に並べたルビの層に渡す1つ分（base をつなぐと語の書き方になる）
 */
export function judge(result: SplitResult, level: Level): RubyPiece[] {
  return result.segs.map((seg) => judgeSeg(seg, level));
}

/**
 * seg 1つ分のルビを決める。
 * @param seg 字ごとに分けた1つ分
 * @param level 利用者が選んだ段階
 * @returns ルビの層に渡す1つ分
 */
function judgeSeg(seg: Seg, level: Level): RubyPiece {
  if (seg.kind === 'kana') {
    return noRuby(seg.base);
  }
  // 読みが分からないときは、間違ったルビより付けないほうがよい
  if (seg.reading === '') {
    return noRuby(seg.base);
  }
  if (seg.kind === 'block') {
    return seg.why === 'unknown' ? noRuby(seg.base) : withRuby(seg.base, seg.reading, true);
  }
  const tier = getKanjiTier(seg.base);
  // 表外字と表外音訓は学校で習わないので、段階に関係なく付ける
  if (tier === undefined || seg.isHyogaiReading) {
    return withRuby(seg.base, seg.reading, true);
  }
  if (level !== 'all' && isTierWithin(tier, level)) {
    return noRuby(seg.base);
  }
  return withRuby(seg.base, seg.reading, false);
}

/**
 * ルビを付けない1つ分を作る。
 * @param base 字、または語の固まり
 * @returns ルビのない1つ分
 */
function noRuby(base: string): RubyPiece {
  return { base, ruby: undefined, isAlways: false };
}

/**
 * ルビを付ける1つ分を作る。
 * @param base 字、または語の固まり
 * @param ruby 付けるルビ（平仮名）
 * @param isAlways 段階に関係なくいつも付けるなら true
 * @returns ルビのある1つ分
 */
function withRuby(base: string, ruby: string, isAlways: boolean): RubyPiece {
  return { base, ruby, isAlways };
}
