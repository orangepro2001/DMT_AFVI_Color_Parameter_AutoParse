export type Lang = 'zh' | 'en' | 'ko';
export type Messages = Record<string, string>;

export const LANGS: ReadonlyArray<{ code: Lang; label: string }> = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
];

const STORAGE_KEY = 'teach.lang';

function isLang(value: string | null): value is Lang {
  return value === 'zh' || value === 'en' || value === 'ko';
}

function readUrlLang(): Lang | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('lang');
    if (isLang(value)) return value;
  } catch {
    return null;
  }
  return null;
}

function readStoredLang(): Lang | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(value)) return value;
  } catch {
    return null;
  }
  return null;
}

function detectLang(): Lang {
  const fromUrl = readUrlLang();
  if (fromUrl !== null) return fromUrl;
  const stored = readStoredLang();
  if (stored !== null) return stored;
  return 'zh';
}

const currentLang: Lang = detectLang();

const htmlLang: Record<Lang, string> = { zh: 'zh-CN', en: 'en', ko: 'ko' };

if (typeof document !== 'undefined') {
  document.documentElement.lang = htmlLang[currentLang];
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore storage failures
  }
  let target = window.location.href;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', lang);
    target = url.toString();
  } catch {
    target = window.location.href;
  }
  window.location.href = target;
}

const dictionaries: Record<Lang, Messages> = { zh: {}, en: {}, ko: {} };

export function defineMessages(dict: Record<Lang, Messages>): void {
  for (const lang of ['zh', 'en', 'ko'] as Lang[]) {
    const messages = dict[lang];
    if (messages === undefined) continue;
    for (const key of Object.keys(messages)) {
      dictionaries[lang][key] = messages[key];
    }
  }
}

export function t(key: string, params?: Record<string, string | number>): string {
  let template = dictionaries[currentLang][key];
  if (template === undefined) template = dictionaries.zh[key];
  if (template === undefined) template = key;
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function applyDom(root: ParentNode): void {
  const textNodes = root.querySelectorAll<HTMLElement>('[data-i18n]');
  textNodes.forEach((node) => {
    const key = node.dataset.i18n;
    if (key !== undefined) node.textContent = t(key);
  });
  const titleNodes = root.querySelectorAll<HTMLElement>('[data-i18n-title]');
  titleNodes.forEach((node) => {
    const key = node.dataset.i18nTitle;
    if (key !== undefined) node.title = t(key);
  });
}

defineMessages({
  zh: {
    'common.error': '错误：{msg}',
    'common.lang': '语言',
  },
  en: {
    'common.error': 'Error: {msg}',
    'common.lang': 'Language',
  },
  ko: {
    'common.error': '오류: {msg}',
    'common.lang': '언어',
  },
});
