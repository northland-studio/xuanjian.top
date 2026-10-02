/**
 * 轻量 SEO 助手（SPA 里动态维护 head 标签）
 * req.md §15：Wiki 页面要支持 title / description / Open Graph / Twitter Card / canonical。
 */
function upsertMeta(attr, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

const SITE = 'https://xuanjian.top';

/** 设置页面 SEO（标题/描述/OG/Twitter/canonical） */
export function setPageSeo({ title, description, image, url, type = 'article' }) {
  if (title) document.title = title;
  const desc = (description || '').replace(/\s+/g, ' ').slice(0, 200);
  upsertMeta('name', 'description', desc);
  upsertMeta('property', 'og:title', title);
  upsertMeta('property', 'og:description', desc);
  upsertMeta('property', 'og:type', type);
  upsertMeta('property', 'og:url', url);
  upsertMeta('property', 'og:site_name', '玄剑公会');
  if (image) upsertMeta('property', 'og:image', image.startsWith('http') ? image : SITE + image);
  upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  upsertMeta('name', 'twitter:title', title);
  upsertMeta('name', 'twitter:description', desc);
  if (image) upsertMeta('name', 'twitter:image', image.startsWith('http') ? image : SITE + image);
  upsertLink('canonical', url);
}

/** 纯文本摘要（从 HTML 或文本里截取） */
export function plainText(html, max = 160) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}
