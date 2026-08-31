import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const locales = [
  { locale: 'zh-CN', slug: '', screenshot: 'screenshot-001', docs: 'https://github.com/havonz/XXTCloudControl#readme' },
  { locale: 'zh-TW', slug: 'zh-tw', screenshot: 'screenshot-001-en' },
  { locale: 'en-US', slug: 'en', screenshot: 'screenshot-001-en' },
  { locale: 'ja-JP', slug: 'ja', screenshot: 'screenshot-001-en' },
  { locale: 'ko-KR', slug: 'ko', screenshot: 'screenshot-001-en' },
  { locale: 'vi-VN', slug: 'vi', screenshot: 'screenshot-001-en' },
  { locale: 'es-ES', slug: 'es', screenshot: 'screenshot-001-en' },
  { locale: 'pt-BR', slug: 'pt-br', screenshot: 'screenshot-001-en' },
  { locale: 'ru-RU', slug: 'ru', screenshot: 'screenshot-001-en' },
  { locale: 'fr-FR', slug: 'fr', screenshot: 'screenshot-001-en' },
  { locale: 'de-DE', slug: 'de', screenshot: 'screenshot-001-en' }
];

const dist = new URL('../dist/', import.meta.url);
const publicDir = new URL('../public/', import.meta.url);
const repositoryRoot = new URL('../../', import.meta.url);
const rawBase = process.env.SITE_BASE?.trim() || '/';
const base = rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+|\/+$/g, '')}/`;
const languagePreferenceKey = 'xxtouch.release.locale.v1';
const errors = [];
const rootReadme = await readFile(new URL('README.md', repositoryRoot), 'utf8');
const fencedCodePattern = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
const rootCodeBlocks = Array.from(rootReadme.matchAll(fencedCodePattern), (match) => match[1]);

for (const entry of locales) {
  const pagePath = entry.slug ? join(entry.slug, 'index.html') : 'index.html';
  let html;
  try {
    html = await readFile(new URL(pagePath, dist), 'utf8');
  } catch (error) {
    errors.push(`${pagePath}: ${error.message}`);
    continue;
  }

  const expectedDocs = entry.docs || `https://github.com/havonz/XXTCloudControl/blob/main/docs/i18n/README.${entry.locale}.md`;
  const expectations = [
    `<html lang="${entry.locale}"`,
    `href="${expectedDocs}"`,
    `${entry.screenshot}.png`,
    `${entry.screenshot}-dark.png`,
    '<meta name="description"',
    '<title>'
  ];

  for (const expected of expectations) {
    if (!html.includes(expected)) {
      errors.push(`${pagePath}: missing ${expected}`);
    }
  }

  for (const alternate of locales) {
    if (!html.includes(`hreflang="${alternate.locale}"`)) {
      errors.push(`${pagePath}: missing hreflang ${alternate.locale}`);
    }
    if (!html.includes(`data-language-locale="${alternate.locale}"`)) {
      errors.push(`${pagePath}: missing persisted language choice ${alternate.locale}`);
    }
  }
  if (!html.includes('hreflang="x-default"')) {
    errors.push(`${pagePath}: missing hreflang x-default`);
  }

  const currentLanguagePath = entry.slug ? `${base}${entry.slug}/` : base;
  const currentLanguageLink = `<a href="${currentLanguagePath}" class="language-menu-active" lang="${entry.locale}" hreflang="${entry.locale}" aria-current="page" data-language-locale="${entry.locale}">`;
  if (!html.includes('<nav class="language-menu"') || !html.includes('<summary class="language-menu-trigger">')) {
    errors.push(`${pagePath}: missing compact language menu`);
  }
  if (!html.includes(`data-language-preference-key="${languagePreferenceKey}"`)) {
    errors.push(`${pagePath}: missing language preference storage key`);
  }
  if (!html.includes(currentLanguageLink)) {
    errors.push(`${pagePath}: missing active language link for ${entry.locale}`);
  }

  const hasLanguageRedirect = html.includes('data-language-redirect');
  if (entry.locale === 'zh-CN') {
    for (const expected of ['navigator.languages', 'window.location.replace', 'en-US']) {
      if (!hasLanguageRedirect || !html.includes(expected)) {
        errors.push(`${pagePath}: missing root language negotiation ${expected}`);
      }
    }
  } else if (hasLanguageRedirect) {
    errors.push(`${pagePath}: explicit locale route must not auto-redirect`);
  }

  if (entry.locale !== 'zh-CN') {
    try {
      const readme = await readFile(new URL(`docs/i18n/README.${entry.locale}.md`, repositoryRoot), 'utf8');
      const translatedCodeBlocks = Array.from(readme.matchAll(fencedCodePattern), (match) => match[1]);
      if (translatedCodeBlocks.length !== rootCodeBlocks.length) {
        errors.push(`docs/i18n/README.${entry.locale}.md: expected ${rootCodeBlocks.length} code blocks, found ${translatedCodeBlocks.length}`);
      } else {
        for (let index = 0; index < rootCodeBlocks.length; index += 1) {
          if (translatedCodeBlocks[index] !== rootCodeBlocks[index]) {
            errors.push(`docs/i18n/README.${entry.locale}.md: code block ${index + 1} differs from README.md`);
          }
        }
      }
    } catch (error) {
      errors.push(`docs/i18n/README.${entry.locale}.md: missing documentation`);
    }
  }
}

for (const screenshot of ['screenshot-001.png', 'screenshot-001-dark.png', 'screenshot-001-en.png', 'screenshot-001-en-dark.png']) {
  try {
    await access(new URL(screenshot, publicDir));
  } catch {
    errors.push(`public/${screenshot}: missing screenshot asset`);
  }
}

if (errors.length > 0) {
  throw new Error(`Localized site verification failed:\n${errors.join('\n')}`);
}

console.log(`Verified ${locales.length} localized routes, metadata, documentation links, and screenshots.`);
