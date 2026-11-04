// offscreen document の中の Worker：同梱の辞書を読み込み、文の読みを出す
import { DICTIONARY_DIR } from '@/config';
import { createWorkerListener } from '@/messaging/worker';
import { createGzipLoader, loadTokenizer } from '@/text/dictionary';
import { createReadingService } from '@/text/reading-service';

const dictionaryUrl = new URL(`/${DICTIONARY_DIR}/`, self.location.origin);
const service = createReadingService(() => loadTokenizer(createGzipLoader(dictionaryUrl)));

self.addEventListener(
  'message',
  createWorkerListener(service, (response) => {
    self.postMessage(response);
  }),
);
