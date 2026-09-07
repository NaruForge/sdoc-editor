import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorTranslator } from '../i18n';

let nextDescriptionId = 0;

/** Screen-only controls; the table body remains ProseMirror's contentDOM. */
export function attachTableScrollControls(
  wrapper: HTMLElement,
  container: HTMLElement,
  table: HTMLTableElement,
  editor: Editor,
  view: EditorView,
  translate: EditorTranslator,
  focusFallback: () => void,
) {
  const controls = document.createElement('div');
  controls.className = 'table-scroll-controls';
  controls.contentEditable = 'false';
  controls.hidden = true;
  controls.tabIndex = 0;
  controls.setAttribute('role', 'region');
  controls.setAttribute('aria-label', translate('table.scrollRegion'));

  const left = document.createElement('button');
  const right = document.createElement('button');
  for (const [button, key, glyph] of [
    [left, 'table.scrollLeft', '←'],
    [right, 'table.scrollRight', '→'],
  ] as const) {
    button.type = 'button';
    button.textContent = glyph;
    button.setAttribute('aria-label', translate(key));
    button.title = translate(key);
  }
  const status = document.createElement('span');
  status.className = 'table-scroll-status';
  status.id = `table-scroll-status-${++nextDescriptionId}`;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'off');
  controls.append(left, status, right);

  const instructions = document.createElement('div');
  instructions.className = 'table-scroll-instructions';
  instructions.contentEditable = 'false';
  instructions.id = `${status.id}-keys`;
  // Keep keyboard controls inside the scroll region; sticky positioning keeps
  // them visible while the table moves horizontally beneath them.
  container.prepend(controls, instructions);

  let frame = 0;
  let destroyed = false;
  function refresh() {
    if (destroyed) return;
    const maximum = Math.max(0, container.scrollWidth - container.clientWidth);
    const overflow = maximum > 1;
    const offset = Math.max(0, Math.min(maximum, container.scrollLeft));
    const atStart = offset <= 1;
    const atEnd = maximum - offset <= 1;
    if (!overflow && controls.contains(document.activeElement)) focusFallback();
    else if (overflow && ((atStart && document.activeElement === left)
      || (atEnd && document.activeElement === right))) controls.focus({ preventScroll: true });
    controls.hidden = !overflow;
    wrapper.classList.toggle('table-has-overflow', overflow);
    left.disabled = atStart;
    right.disabled = atEnd;
    if (overflow) {
      const direction = translate(atStart ? 'table.moreRight' : atEnd ? 'table.moreLeft' : 'table.moreBoth');
      const percent = atStart ? 0 : atEnd ? 100 : Math.round(offset / maximum * 100);
      const message = translate('table.scrollPosition', { direction, percent });
      if (status.textContent !== message) status.textContent = message;
      controls.setAttribute('aria-describedby', `${status.id} ${instructions.id}`);
    } else {
      controls.removeAttribute('aria-describedby');
    }
    const help = translate(editor.isEditable ? 'table.scrollKeysEditable' : 'table.scrollKeys');
    if (instructions.textContent !== help) instructions.textContent = help;
    status.setAttribute('aria-live', wrapper.contains(document.activeElement) ? 'polite' : 'off');
  }
  function schedule() {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  }
  function scrollByPage(direction: number) {
    container.scrollLeft += direction * Math.max(40, container.clientWidth * 0.8);
    refresh();
  }
  function editVisibleCell() {
    if (!editor.isEditable) return;
    const bounds = container.getBoundingClientRect();
    const cells = Array.from(table.rows[0]?.cells ?? []);
    // At either end, enter the corresponding edge cell. In the middle, choose
    // the cell with the largest visible part, including merged cells.
    const visibleWidth = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.min(bounds.right, rect.right) - Math.max(bounds.left, rect.left));
    };
    const cell = container.scrollLeft <= 1 ? cells[0]
      : container.scrollWidth - container.clientWidth - container.scrollLeft <= 1 ? cells[cells.length - 1]
      : cells.sort((a, b) => visibleWidth(b) - visibleWidth(a))[0];
    if (cell) {
      const position = view.posAtDOM(cell, 0);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
      view.focus();
    }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target === controls) {
      if (event.key === 'ArrowLeft') scrollByPage(-1);
      else if (event.key === 'ArrowRight') scrollByPage(1);
      else if (event.key === 'Home') { container.scrollLeft = 0; refresh(); }
      else if (event.key === 'End') { container.scrollLeft = container.scrollWidth; refresh(); }
      else if (event.key === 'Enter' && editor.isEditable) editVisibleCell();
      else return;
    } else if (event.key === 'Escape' && view.hasFocus()
      && table.contains(view.domAtPos(editor.state.selection.from).node) && !controls.hidden) {
      const horizontalOffset = container.scrollLeft;
      controls.focus({ preventScroll: true });
      controls.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      container.scrollLeft = horizontalOffset;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }
  const onLeft = () => scrollByPage(-1);
  const onRight = () => scrollByPage(1);
  left.addEventListener('click', onLeft);
  right.addEventListener('click', onRight);
  wrapper.addEventListener('keydown', onKeyDown);
  view.dom.addEventListener('keydown', onKeyDown);
  wrapper.addEventListener('focusin', schedule);
  wrapper.addEventListener('focusout', schedule);
  container.addEventListener('scroll', schedule, { passive: true });
  const observer = new ResizeObserver(schedule);
  observer.observe(container);
  observer.observe(table);
  schedule();
  return {
    schedule,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      left.removeEventListener('click', onLeft);
      right.removeEventListener('click', onRight);
      wrapper.removeEventListener('keydown', onKeyDown);
      view.dom.removeEventListener('keydown', onKeyDown);
      wrapper.removeEventListener('focusin', schedule);
      wrapper.removeEventListener('focusout', schedule);
      container.removeEventListener('scroll', schedule);
    },
  };
}
