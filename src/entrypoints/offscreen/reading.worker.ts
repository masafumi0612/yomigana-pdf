// offscreen document の中の Worker：同梱の辞書を読み込み、文の読みを出す
import { DICTIONARY_DIR } from '@/config';
import { createWorkerListener } from '@/messaging/worker';
import { createGzipLoader, loadTokenizer } from '@/text/dictionary';
import { createReadingService } from '@/text/reading-service';

/**
 * 辞書を読み込み終えるまでの時間を測る名前（performance.measure）。
 * 性能を測る E2E（tests/e2e/perf-budget.test.ts）が、この Worker の中から引いて残す
 */
const DICTIONARY_MEASURE = 'yomigana-pdf:dictionary';

const dictionaryUrl = new URL(`/${DICTIONARY_DIR}/`, self.location.origin);
const service = createReadingService(async () => {
  const startedAt = performance.now();
  const loaded = await loadTokenizer(createGzipLoader(dictionaryUrl));
  performance.measure(DICTIONARY_MEASURE, { start: startedAt, detail: { isLoaded: loaded.ok } });
  return loaded;
});

self.addEventListener(
  'message',
  createWorkerListener(service, (response) => {
    self.postMessage(response);
  }),
);
