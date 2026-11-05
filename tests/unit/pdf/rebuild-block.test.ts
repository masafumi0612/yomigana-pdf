import { describe, expect, it } from 'vitest';

import { isDirectionUncertain } from '@/pdf/direction';
import { extractPageText } from '@/pdf/page-text';
import { createBlockRebuilder } from '@/pdf/rebuild-block';

import { contentOf, defined, horizontalItem, unmarkedColumn, verticalItem } from './make-items';

describe('isDirectionUncertain', () => {
  it('自信が 1 のとき、違っているかもしれないとは見ない', () => {
    expect(isDirectionUncertain({ confidence: 1 })).toBe(false);
  });

  it('自信が 1 未満のとき、違っているかもしれないと見る', () => {
    expect(isDirectionUncertain({ confidence: 0.8 })).toBe(true);
    expect(isDirectionUncertain({ confidence: 0.5 })).toBe(true);
  });
});

describe('createBlockRebuilder', () => {
  it('縦書きと推定したかたまりを横書きに指定したとき、横書きで自信 1 のかたまりになる', () => {
    const content = contentOf(unmarkedColumn('今日は朝から', 300, 700));
    const block = defined(extractPageText(content).blocks[0]);
    expect([block.direction, block.confidence]).toEqual(['vertical', 0.8]);

    const rebuilt = defined(createBlockRebuilder(content)(block, 'horizontal'));

    expect([rebuilt.direction, rebuilt.confidence]).toEqual(['horizontal', 1]);
    expect(rebuilt.text).toBe('今日は朝から');
  });

  it('1字だけで向きの分からないかたまりを縦書きに指定したとき、縦書きになる', () => {
    const content = contentOf([horizontalItem('橋', 100, 600)]);
    const block = defined(extractPageText(content).blocks[0]);
    expect(block.confidence).toBe(0.5);

    const rebuilt = defined(createBlockRebuilder(content)(block, 'vertical'));

    expect([rebuilt.direction, rebuilt.text, rebuilt.confidence]).toEqual(['vertical', '橋', 1]);
  });

  it('横書きの行を縦書きに指定したとき、すべての字が縦書きの1つの列に並ぶ', () => {
    const content = contentOf([horizontalItem('ことば', 100, 600)]);
    const block = defined(extractPageText(content).blocks[0]);

    const rebuilt = defined(createBlockRebuilder(content)(block, 'vertical'));

    expect(rebuilt.direction).toBe('vertical');
    expect(rebuilt.glyphs).toHaveLength(3);
  });

  it('ほかのかたまりがあるとき、指定したかたまりの字だけで組み直す', () => {
    const content = contentOf([
      horizontalItem('橋', 100, 600),
      verticalItem('山の上の道', 400, 300),
    ]);
    const blocks = extractPageText(content).blocks;
    const lone = defined(blocks.find((block) => block.text === '橋'));

    const rebuilt = defined(createBlockRebuilder(content)(lone, 'vertical'));

    expect(rebuilt.text).toBe('橋');
  });

  it('かたまりの字がページにないとき、undefined を返す', () => {
    const block = defined(extractPageText(contentOf([horizontalItem('橋', 100, 600)])).blocks[0]);

    expect(createBlockRebuilder(contentOf([horizontalItem('川', 10, 10)]))(block, 'vertical')).toBe(
      undefined,
    );
  });
});
