// offscreen document：中の Worker が辞書を1回だけ読み込み、全タブの読みの問い合わせに答える
import { browser } from 'wxt/browser';

import { createOffscreenListener } from '@/messaging/offscreen';
import { READING_TIMEOUT_MS } from '@/messaging/timeout';
import { createWorkerClient } from '@/messaging/worker';

import ReadingWorker from './reading.worker?worker';

const client = createWorkerClient(new ReadingWorker(), READING_TIMEOUT_MS);
browser.runtime.onMessage.addListener(createOffscreenListener(client));
