import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

/* Extend Tiptap's RawCommands with the two new commands */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cursorHistory: {
      navigateBack: () => ReturnType;
      navigateForward: () => ReturnType;
    };
  }
}

/**
 * 커서 히스토리 항목
 * docVersion: ProseMirror doc version — 삭제 등으로 position이 무효화되었을 때 감지
 */
interface CursorHistoryEntry {
  from: number;
  to: number;
}

/** 히스토리 스택 최대 항목 수 */
const MAX_HISTORY = 80;

/** 같은 위치 재기록 방지를 위한 최소 이동 거리 (position 단위) */
const MIN_MOVE_DISTANCE = 50;

const cursorHistoryKey = new PluginKey<{
  stack: CursorHistoryEntry[];
  index: number;
  navigating: boolean;
}>('cursorHistory');

/**
 * CursorHistory Extension
 *
 * 의미 있는 커서 이동(마우스 클릭, 대규모 키보드 이동)을 스택에 기록하고
 * navigateBack() / navigateForward() 명령으로 이전/다음 위치로 복원.
 *
 * 기록 기준:
 *   - 마우스 클릭 (pointer meta)
 *   - 이전 위치와 MIN_MOVE_DISTANCE 이상 떨어진 이동 (Ctrl+G, 교차 참조 클릭 등)
 *   - 타이핑 중 매 글자 이동은 기록하지 않음 (docChanged 시)
 */
export const CursorHistory = Extension.create({
  name: 'cursorHistory',

  addCommands() {
    return {
      navigateBack:
        () =>
        ({ state, dispatch, view }) => {
          const pluginState = cursorHistoryKey.getState(state);
          if (!pluginState) return false;
          const { stack, index } = pluginState;

          const targetIndex = index - 1;
          if (targetIndex < 0) return false;

          const entry = stack[targetIndex];
          if (!entry) return false;

          const docSize = state.doc.content.size;
          const safeFrom = Math.min(entry.from, docSize);

          if (dispatch) {
            const tr = state.tr;
            tr.setMeta(cursorHistoryKey, { navigating: true, newIndex: targetIndex });
            try {
              tr.setSelection(TextSelection.near(tr.doc.resolve(safeFrom)));
            } catch {
              // leave selection as-is if position is invalid
            }
            dispatch(tr);
            view.dispatch(view.state.tr.scrollIntoView());
          }
          return true;
        },

      navigateForward:
        () =>
        ({ state, dispatch, view }) => {
          const pluginState = cursorHistoryKey.getState(state);
          if (!pluginState) return false;
          const { stack, index } = pluginState;

          const targetIndex = index + 1;
          if (targetIndex >= stack.length) return false;

          const entry = stack[targetIndex];
          if (!entry) return false;

          const docSize = state.doc.content.size;
          const safeFrom = Math.min(entry.from, docSize);

          if (dispatch) {
            const tr = state.tr;
            tr.setMeta(cursorHistoryKey, { navigating: true, newIndex: targetIndex });
            try {
              tr.setSelection(TextSelection.near(tr.doc.resolve(safeFrom)));
            } catch {
              // leave selection as-is
            }
            dispatch(tr);
            view.dispatch(view.state.tr.scrollIntoView());
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Alt-ArrowLeft': ({ editor }) => editor.commands.navigateBack(),
      'Alt-ArrowRight': ({ editor }) => editor.commands.navigateForward(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: cursorHistoryKey,

        state: {
          init() {
            return { stack: [] as CursorHistoryEntry[], index: -1, navigating: false };
          },

          apply(tr, prev) {
            const meta = tr.getMeta(cursorHistoryKey) as
              | { navigating: boolean; newIndex: number }
              | undefined;

            // 네비게이션 중이면 인덱스만 업데이트
            if (meta?.navigating) {
              return { ...prev, index: meta.newIndex, navigating: true };
            }

            // doc이 바뀌었으나 selection도 안 바뀌었으면 기록 불필요
            if (!tr.selectionSet) return { ...prev, navigating: false };

            // 타이핑/삭제 중(docChanged)에는 기록하지 않음
            if (tr.docChanged) return { ...prev, navigating: false };

            const isPointerMove = !!tr.getMeta('pointer');
            const newFrom = tr.selection.from;
            const newTo = tr.selection.to;

            // 직전 인덱스 항목과 같은 위치면 기록 불필요
            const last = prev.stack[prev.index];
            if (last && last.from === newFrom && last.to === newTo) {
              return { ...prev, navigating: false };
            }

            // 마우스 클릭이 아니면 최소 이동 거리 필터 적용
            if (!isPointerMove) {
              if (last && Math.abs(newFrom - last.from) < MIN_MOVE_DISTANCE) {
                return { ...prev, navigating: false };
              }
            }

            // 현재 인덱스 이후의 "앞으로" 스택을 버리고 새 항목 추가
            const truncated = prev.stack.slice(0, prev.index + 1);
            const newEntry: CursorHistoryEntry = { from: newFrom, to: newTo };
            const newStack = [...truncated, newEntry].slice(-MAX_HISTORY);
            const newIndex = newStack.length - 1;

            return { stack: newStack, index: newIndex, navigating: false };
          },
        },
      }),
    ];
  },
});
