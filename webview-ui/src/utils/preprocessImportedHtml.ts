/**
 * Pre-process imported HTML to extract document body and convert
 * exported structures back to Tiptap-compatible HTML.
 */
export function preprocessImportedHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  body.querySelectorAll('.document-header, .document-title, .document-meta, style, script, link').forEach(el => el.remove());

  body.querySelectorAll('figure.doc-image').forEach(fig => {
    const img = fig.querySelector('img');
    if (!img) { fig.remove(); return; }
    const figcaption = fig.querySelector('figcaption');
    if (figcaption) {
      const capText = figcaption.textContent || '';
      const stripped = capText.replace(/^\S+\s+[\d.]+:\s*/, '');
      if (stripped) { img.setAttribute('data-caption', stripped); }
    }
    const style = fig.getAttribute('style') || '';
    if (style.includes('margin-left:auto') && style.includes('margin-right:0')) {
      img.setAttribute('data-align', 'right');
    } else if (style.includes('margin-right:auto') && style.includes('margin-left:0')) {
      img.setAttribute('data-align', 'left');
    } else {
      img.setAttribute('data-align', 'center');
    }
    fig.replaceWith(img);
  });

  body.querySelectorAll('table.doc-table, table').forEach(table => {
    const caption = table.querySelector('caption');
    if (caption) {
      const capText = caption.textContent || '';
      const stripped = capText.replace(/^\S+\s+[\d.]+:\s*/, '');
      if (stripped) { table.setAttribute('data-caption', stripped); }
      caption.remove();
    }
  });

  body.querySelectorAll('ul.task-list').forEach(ul => {
    ul.setAttribute('data-type', 'taskList');
    ul.querySelectorAll('li.task-item').forEach(li => {
      li.setAttribute('data-type', 'taskItem');
      const checkbox = li.querySelector('input[type="checkbox"]');
      if (checkbox) {
        li.setAttribute('data-checked', (checkbox as HTMLInputElement).checked ? 'true' : 'false');
        checkbox.remove();
      }
    });
  });

  body.querySelectorAll('.math-inline').forEach(el => {
    const latex = el.getAttribute('data-latex');
    if (latex) {
      const span = doc.createElement('span');
      span.setAttribute('data-type', 'mathInline');
      span.setAttribute('data-latex', latex);
      span.textContent = `$${latex}$`;
      el.replaceWith(span);
    }
  });
  body.querySelectorAll('.math-block').forEach(el => {
    const latex = el.getAttribute('data-latex');
    if (latex) {
      const div = doc.createElement('div');
      div.setAttribute('data-type', 'mathBlock');
      div.setAttribute('data-latex', latex);
      div.textContent = `$$${latex}$$`;
      el.replaceWith(div);
    }
  });

  return body.innerHTML;
}
