/**
 * Markdown renderer — port of public/uiPrimitives.js markdown(): escape-first,
 * fenced code blocks via placeholder tokens, inline code/bold/italic, safe-link
 * anchors (https only, noreferrer), headings → h3, ul/ol lists, paragraph wrap.
 */
export function renderMarkdown(text: string): string {
  const blocks: string[] = [];
  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  let html = escapeHtml(text)
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_match: string, _lang: string, code: string) => {
      blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
      return `\uE000${blocks.length - 1}\uE000`;
    })
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<h3>$1</h3>');

  html = html
    .replace(/(?:^[-*]\s+.+(?:\n|$))+/gm, (match: string) =>
      `<ul>${match.trim().split('\n').map((line) => `<li>${line.replace(/^[-*]\s+/, '')}</li>`).join('')}</ul>`)
    .replace(/(?:^\d+[.)]\s+.+(?:\n|$))+/gm, (match: string) =>
      `<ol>${match.trim().split('\n').map((line) => `<li>${line.replace(/^\d+[.)]\s+/, '')}</li>`).join('')}</ol>`);

  return html
    .split(/\n{2,}/)
    .map((chunk) => (/^\s*(<(ul|ol|pre|h3)|\uE000)/.test(chunk) ? chunk : `<p>${chunk.replace(/\n/g, '<br>')}</p>`))
    .join('')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/\uE000(\d+)\uE000/g, (_match: string, index: string) => blocks[Number(index)]);
}

/** tailOf: last N chars, whitespace-collapsed, ellipsis when truncated. */
export function tailOf(text: string, max = 110): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `…${collapsed.slice(-max)}` : collapsed;
}
