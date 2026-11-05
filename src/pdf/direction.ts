// かたまりの向きの自信の線と、向きが違うかもしれないかたまりの見分け方。
import type { TextBlock } from './types';

/** 向きが確かなかたまりの自信（これ未満は、利用者に直してもらえるよう知らせる） */
export const SURE_CONFIDENCE = 1;

/**
 * かたまりの向きが、違っているかもしれないか。
 * @param block かたまり
 * @returns 向きの自信が足りなければ true
 */
export function isDirectionUncertain(block: Pick<TextBlock, 'confidence'>): boolean {
  return block.confidence < SURE_CONFIDENCE;
}
