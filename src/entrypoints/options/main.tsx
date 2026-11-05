import './style.css';

import { render } from 'preact';

import { App } from '@/options/app';
import { message } from '@/options/message';

const root = document.getElementById('app');
if (root === null) {
  throw new TypeError('設定の画面に #app がない');
}
document.title = message('options_page_title');
render(<App />, root);
