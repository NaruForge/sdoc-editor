import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { Editor as TiptapEditor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  ListChecks,
  Code,
  Heading,
  Table2,
  Trash2,
  PenTool,
  Image as ImageIcon,
  Link as LinkIcon,
  Sigma,
  Plus,
  ChevronRight,
  Hash,
  Palette,
  Highlighter,
  Strikethrough,
  Subscript,
  Superscript,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  GitGraph,
  Quote,
  MessageSquareWarning,
  MoreHorizontal,
} from 'lucide-react';
import { CALLOUT_ICONS, type CalloutVariant } from '@shared/editor/extensions/Callout';
import { TEXT_COLORS, HIGHLIGHT_COLORS } from '../constants/colors';
import {
  HEADING_LEVELS,
  nextHeadingMenuIndex,
  type HeadingMenuNavigationKey,
} from '../constants/headings';
import { IconButton } from './ui/IconButton';
import { Menu } from './ui/Menu';
import {
  resolveToolbarLayout,
  TOOLBAR_GROUP_ORDER,
  type ToolbarGroupId,
} from '../toolbar/layout';
import { useEditorI18n, type EditorTranslationKey } from '../i18n';

interface ToolbarProps {
  editor: TiptapEditor | null;
  onInsertDrawio?: () => void;
  onInsertImage?: () => void;
  onInsertLink?: () => void;
  onInsertMath?: () => void;
  onInsertDiagram?: () => void;
  onInsertCrossRef?: () => void;
  disabled?: boolean;
}

const TOOLBAR_GROUP_LABEL_KEYS: Record<ToolbarGroupId, EditorTranslationKey> = {
  'inline-basic': 'toolbar.groupBasic',
  'inline-color': 'toolbar.groupColor',
  heading: 'toolbar.groupHeading',
  alignment: 'toolbar.groupAlignment',
  'lists-blocks': 'toolbar.groupListsBlocks',
  insert: 'toolbar.groupInsert',
  'table-context': 'toolbar.groupTable',
};

const CALLOUT_LABEL_KEYS: Record<CalloutVariant, EditorTranslationKey> = {
  note: 'callout.note',
  info: 'callout.info',
  tip: 'callout.tip',
  warning: 'callout.warning',
  danger: 'callout.danger',
};

const TEXT_COLOR_LABEL_KEYS: readonly EditorTranslationKey[] = [
  'color.default', 'color.blueDefault', 'color.red', 'color.orange', 'color.yellow',
  'color.green', 'color.blue', 'color.purple', 'color.gray',
];

const HIGHLIGHT_COLOR_LABEL_KEYS: readonly EditorTranslationKey[] = [
  'color.none', 'color.yellow', 'color.green', 'color.sky',
  'color.pink', 'color.orange', 'color.purple',
];

export const Toolbar: React.FC<ToolbarProps> = ({
  editor,
  onInsertDrawio,
  onInsertImage,
  onInsertLink,
  onInsertMath,
  onInsertDiagram,
  onInsertCrossRef,
  disabled = false,
}) => {
  const { t } = useEditorI18n();
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [insertQuery, setInsertQuery] = useState('');
  const [showTableSub, setShowTableSub] = useState(false);
  const [showCalloutSub, setShowCalloutSub] = useState(false);
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showAlignMenu, setShowAlignMenu] = useState(false);
  const [showHeadingMenu, setShowHeadingMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const colorTriggerRef = useRef<HTMLButtonElement>(null);
  const highlightPickerRef = useRef<HTMLDivElement>(null);
  const highlightTriggerRef = useRef<HTMLButtonElement>(null);
  const [customRows, setCustomRows] = useState('3');
  const [customCols, setCustomCols] = useState('3');
  const insertMenuRef = useRef<HTMLDivElement>(null);
  const insertTriggerRef = useRef<HTMLButtonElement>(null);
  const tableSubTriggerRef = useRef<HTMLButtonElement>(null);
  const tableSubmenuRef = useRef<HTMLDivElement>(null);
  const calloutSubTriggerRef = useRef<HTMLButtonElement>(null);
  const calloutSubmenuRef = useRef<HTMLDivElement>(null);
  const alignMenuRef = useRef<HTMLDivElement>(null);
  const alignTriggerRef = useRef<HTMLButtonElement>(null);
  const headingMenuRef = useRef<HTMLDivElement>(null);
  const headingTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const groupElementsRef = useRef<Partial<Record<ToolbarGroupId, HTMLDivElement>>>({});
  const [availableWidth, setAvailableWidth] = useState(Number.POSITIVE_INFINITY);
  const [groupWidths, setGroupWidths] = useState<Partial<Record<ToolbarGroupId, number>>>({});
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [activeOverflowGroup, setActiveOverflowGroup] = useState<ToolbarGroupId | null>(null);

  const [, forceToolbarUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => forceToolbarUpdate(v => v + 1);
    editor.on('transaction', handler);
    return () => { editor.off('transaction', handler); };
  }, [editor]);

  // Close menus on outside click
  useEffect(() => {
    const targets: { open: boolean; ref: React.RefObject<HTMLDivElement | null>; close: () => void }[] = [
      { open: showInsertMenu, ref: insertMenuRef, close: closeInsertMenu },
      { open: showColorPicker, ref: colorPickerRef, close: () => setShowColorPicker(false) },
      { open: showHighlightPicker, ref: highlightPickerRef, close: () => setShowHighlightPicker(false) },
      { open: showAlignMenu, ref: alignMenuRef, close: () => setShowAlignMenu(false) },
      { open: showHeadingMenu, ref: headingMenuRef, close: () => setShowHeadingMenu(false) },
      { open: showMoreMenu, ref: moreMenuRef, close: () => setShowMoreMenu(false) },
      {
        open: showOverflowMenu || activeOverflowGroup !== null,
        ref: overflowRef,
        close: () => {
          setShowOverflowMenu(false);
          setActiveOverflowGroup(null);
        },
      },
    ];
    const active = targets.filter(t => t.open);
    if (!active.length) return;
    const handleClick = (e: MouseEvent) => {
      active.forEach(({ ref, close }) => {
        const target = e.target as Element;
        if (
          ref.current
          && !ref.current.contains(target)
          && !target.closest('.toolbar-group.is-overflow-panel')
        ) close();
      });
    };
    const id = requestAnimationFrame(() => document.addEventListener('mousedown', handleClick));
    return () => { cancelAnimationFrame(id); document.removeEventListener('mousedown', handleClick); };
  }, [
    showInsertMenu,
    showColorPicker,
    showHighlightPicker,
    showAlignMenu,
    showHeadingMenu,
    showMoreMenu,
    showOverflowMenu,
    activeOverflowGroup,
  ]);

  const registerGroup = useCallback((id: ToolbarGroupId, element: HTMLDivElement | null) => {
    if (element) groupElementsRef.current[id] = element;
    else delete groupElementsRef.current[id];
  }, []);

  const tableIsActive = editor?.isActive('table') ?? false;
  const presentGroups = useMemo<readonly ToolbarGroupId[]>(
    () => TOOLBAR_GROUP_ORDER.filter((id) => id !== 'table-context' || tableIsActive),
    [tableIsActive],
  );
  const layout = resolveToolbarLayout({
    availableWidth,
    groupWidths,
    presentGroups,
  });

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const style = getComputedStyle(toolbar);
      setAvailableWidth(Math.max(
        0,
        toolbar.clientWidth
          - (parseFloat(style.paddingLeft) || 0)
          - (parseFloat(style.paddingRight) || 0),
      ));
      setGroupWidths((current) => {
        let changed = false;
        const next = { ...current };
        for (const id of presentGroups) {
          const width = groupElementsRef.current[id]?.offsetWidth ?? 0;
          if (width > 0 && next[id] !== width) {
            next[id] = width;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    for (const id of presentGroups) {
      const group = groupElementsRef.current[id];
      if (group) observer.observe(group);
    }
    measure();
    return () => observer.disconnect();
  }, [presentGroups]);

  useEffect(() => {
    const focusedGroup = document.activeElement?.closest<HTMLElement>('[data-toolbar-group]');
    if (!focusedGroup) return;
    const focusedId = focusedGroup.dataset.toolbarGroup as ToolbarGroupId | undefined;
    if (focusedId && layout.overflow.includes(focusedId) && activeOverflowGroup !== focusedId) {
      overflowTriggerRef.current?.focus();
    }
  }, [activeOverflowGroup, layout.overflow]);

  useEffect(() => {
    if (activeOverflowGroup && !layout.overflow.includes(activeOverflowGroup)) {
      setActiveOverflowGroup(null);
    }
  }, [activeOverflowGroup, layout.overflow]);

  if (!editor) return null;

  const Btn: React.FC<{
    onClick: () => void;
    isActive?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    title?: string;
    danger?: boolean;
  }> = ({ onClick, isActive, disabled, children, title = t('toolbar.documentFormatting'), danger }) => (
    <IconButton
      onClick={onClick}
      disabled={disabled}
      label={title}
      title={title}
      pressed={isActive}
      danger={danger}
    >
      {children}
    </IconButton>
  );

  const insertTable = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    closeInsertMenu();
  };

  function closeInsertMenu() {
    setShowInsertMenu(false);
    setShowTableSub(false);
    setShowCalloutSub(false);
    setShowCustomSize(false);
    setInsertQuery('');
  }

  // Flat, searchable list of insert actions (shown when the search box has a query)
  const insertActions: { label: string; keywords: string; icon: React.ReactNode; run: () => void }[] = [
    { label: t('toolbar.table'), keywords: 'table 표 그리드', icon: <Table2 size={15} />, run: () => insertTable(3, 3) },
    ...(onInsertImage ? [{ label: t('toolbar.image'), keywords: 'image picture 이미지 그림 사진', icon: <ImageIcon size={15} />, run: onInsertImage }] : []),
    ...(onInsertDrawio ? [{ label: t('toolbar.drawio'), keywords: 'drawio diagram 다이어그램 도형', icon: <PenTool size={15} />, run: onInsertDrawio }] : []),
    ...(onInsertMath ? [{ label: t('toolbar.math'), keywords: 'math equation 수식 latex katex', icon: <Sigma size={15} />, run: onInsertMath }] : []),
    { label: t('toolbar.codeBlock'), keywords: 'code 코드 block program 프로그램', icon: <Code size={15} />, run: () => editor.chain().focus().toggleCodeBlock().run() },
    ...(onInsertDiagram ? [{ label: t('toolbar.diagram'), keywords: 'text mermaid diagram 텍스트 다이어그램 차트', icon: <GitGraph size={15} />, run: onInsertDiagram }] : []),
    { label: t('toolbar.horizontalRule'), keywords: 'hr horizontal rule 수평선 구분선', icon: <span style={{ fontSize: '15px', lineHeight: '15px', width: '15px', textAlign: 'center' }}>—</span>, run: () => editor.chain().focus().setHorizontalRule().run() },
    ...(Object.entries(CALLOUT_ICONS) as [CalloutVariant, string][]).map(([variant, icon]) => ({
      label: `${t('toolbar.callout')} · ${t(CALLOUT_LABEL_KEYS[variant])}`,
      keywords: `callout 콜아웃 ${variant} ${t(CALLOUT_LABEL_KEYS[variant])}`,
      icon: <span>{icon}</span>,
      run: () => editor.chain().focus().insertContent({ type: 'callout', attrs: { variant }, content: [{ type: 'paragraph' }] }).run(),
    })),
    ...(onInsertCrossRef ? [{ label: t('toolbar.crossReference'), keywords: 'crossref reference 교차 참조 link 링크 anchor', icon: <Hash size={15} />, run: onInsertCrossRef }] : []),
  ];

  const insertQ = insertQuery.trim().toLowerCase();
  const filteredInsertActions = insertQ
    ? insertActions.filter(a => a.label.toLowerCase().includes(insertQ) || a.keywords.toLowerCase().includes(insertQ))
    : [];

  // Active alignment icon
  const activeAlign = editor.isActive({ textAlign: 'center' }) ? <AlignCenter size={16} />
    : editor.isActive({ textAlign: 'right' }) ? <AlignRight size={16} />
    : editor.isActive({ textAlign: 'justify' }) ? <AlignJustify size={16} />
    : <AlignLeft size={16} />;

  const headingMenuButtons = (): HTMLButtonElement[] =>
    Array.from(headingMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);

  const focusHeadingMenuItem = (index: number): void => {
    requestAnimationFrame(() => headingMenuButtons()[index]?.focus());
  };

  const activeHeadingMenuIndex = (): number => {
    const activeLevel = HEADING_LEVELS.findIndex((level) => editor.isActive('heading', { level }));
    return activeLevel >= 0 ? activeLevel + 1 : 0;
  };

  const handleHeadingMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setShowHeadingMenu(false);
      headingTriggerRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = headingMenuButtons();
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[nextHeadingMenuIndex(
      currentIndex,
      event.key as HeadingMenuNavigationKey,
      buttons.length,
    )]?.focus();
  };

  const isGroupVisible = (id: ToolbarGroupId): boolean => layout.visible.includes(id);
  const isOverflowPanel = (id: ToolbarGroupId): boolean => activeOverflowGroup === id;
  const groupProps = (id: ToolbarGroupId) => ({
    ref: (element: HTMLDivElement | null) => registerGroup(id, element),
    role: 'group',
    'data-toolbar-group': id,
    'aria-label': t(TOOLBAR_GROUP_LABEL_KEYS[id]),
    hidden: !isGroupVisible(id) && !isOverflowPanel(id),
    className: `toolbar-group${isOverflowPanel(id) ? ' is-overflow-panel' : ''}`,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isOverflowPanel(id)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setActiveOverflowGroup(null);
        overflowTriggerRef.current?.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowDown' ? (current + 1 + buttons.length) % buttons.length
            : (current - 1 + buttons.length) % buttons.length;
      if (buttons[next]) {
        event.preventDefault();
        buttons[next]?.focus();
      }
    },
  });

  return (
    <div
      ref={toolbarRef}
      className="toolbar"
      role="toolbar"
      aria-label={t('toolbar.documentFormatting')}
      aria-disabled={disabled}
      inert={disabled ? true : undefined}
    >

      <div {...groupProps('inline-basic')}>
        <Btn onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title={t('toolbar.bold')}>
          <Bold size={16} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title={t('toolbar.italic')}>
          <Italic size={16} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title={t('toolbar.underline')}>
          <UnderlineIcon size={16} />
        </Btn>
        {onInsertLink && (
          <Btn onClick={onInsertLink} isActive={editor.isActive('link')} title={t('toolbar.link')}>
            <LinkIcon size={16} />
          </Btn>
        )}
      </div>

      <div {...groupProps('inline-color')}>
        <div ref={colorPickerRef} className="toolbar-dropdown">
        <button
          ref={colorTriggerRef}
          type="button"
          onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }}
          onClick={(event) => {
            const opening = !showColorPicker;
            setShowColorPicker(opening);
            setShowHighlightPicker(false);
            if (opening && event.detail === 0) {
              requestAnimationFrame(() => colorPickerRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus());
            }
          }}
          title={t('toolbar.textColor')}
          aria-label={t('toolbar.textColor')}
          aria-haspopup="menu"
          aria-expanded={showColorPicker}
          aria-pressed={editor.isActive('textStyle') && Boolean(editor.getAttributes('textStyle').color)}
          className={`toolbar-button color-picker-btn ${editor.isActive('textStyle') && editor.getAttributes('textStyle').color ? 'is-active' : ''}`}
        >
          <Palette size={16} />
          <div className="color-indicator" style={{ width: 16, background: editor.getAttributes('textStyle').color || 'currentColor', opacity: editor.getAttributes('textStyle').color ? 1 : 0.4 }} />
        </button>
        {showColorPicker && (
          <Menu
            className="bubble-color-picker"
            style={{ top: '100%', left: 0 }}
            label={t('toolbar.textColor')}
            onMouseDown={e => e.preventDefault()}
            onEscape={() => {
              setShowColorPicker(false);
              colorTriggerRef.current?.focus();
            }}
          >
            {TEXT_COLORS.map(({ value }, index) => {
              const label = t(TEXT_COLOR_LABEL_KEYS[index]);
              return (
              <button key={value} type="button" role="menuitemradio" title={label} aria-label={label}
                aria-checked={editor.getAttributes('textStyle').color === value}
                className={editor.getAttributes('textStyle').color === value ? 'is-active' : ''}
                onClick={() => { if (value) editor.chain().focus().setColor(value).run(); else editor.chain().focus().unsetColor().run(); setShowColorPicker(false); }}
                style={{ background: value || 'transparent', border: value ? 'none' : '1px solid #555' }}>
                {!value && <span style={{ fontSize: 10, color: '#aaa' }}>✕</span>}
              </button>
            );})}
          </Menu>
        )}
        </div>

        <div ref={highlightPickerRef} className="toolbar-dropdown">
        <button
          ref={highlightTriggerRef}
          type="button"
          onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }}
          onClick={(event) => {
            const opening = !showHighlightPicker;
            setShowHighlightPicker(opening);
            setShowColorPicker(false);
            if (opening && event.detail === 0) {
              requestAnimationFrame(() => highlightPickerRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus());
            }
          }}
          title={t('toolbar.highlight')}
          aria-label={t('toolbar.highlight')}
          aria-haspopup="menu"
          aria-expanded={showHighlightPicker}
          aria-pressed={editor.isActive('highlight')}
          className={`toolbar-button color-picker-btn ${editor.isActive('highlight') ? 'is-active' : ''}`}
        >
          <Highlighter size={16} />
          <div className="color-indicator" style={{ width: 16, background: editor.getAttributes('highlight').color || '#fef08a', opacity: editor.isActive('highlight') ? 1 : 0.4 }} />
        </button>
        {showHighlightPicker && (
          <Menu
            className="bubble-color-picker"
            style={{ top: '100%', left: 0 }}
            label={t('toolbar.highlight')}
            onMouseDown={e => e.preventDefault()}
            onEscape={() => {
              setShowHighlightPicker(false);
              highlightTriggerRef.current?.focus();
            }}
          >
            {HIGHLIGHT_COLORS.map(({ value }, index) => {
              const label = t(HIGHLIGHT_COLOR_LABEL_KEYS[index]);
              return (
              <button key={value} type="button" role="menuitemradio" title={label} aria-label={label}
                aria-checked={editor.getAttributes('highlight').color === value}
                className={editor.getAttributes('highlight').color === value ? 'is-active' : ''}
                onClick={() => { if (value) editor.chain().focus().setHighlight({ color: value }).run(); else editor.chain().focus().unsetHighlight().run(); setShowHighlightPicker(false); }}
                style={{ background: value || 'transparent', border: value ? 'none' : '1px solid #555' }}>
                {!value && <span style={{ fontSize: 10, color: '#aaa' }}>✕</span>}
              </button>
            );})}
          </Menu>
        )}
        </div>

        <div ref={moreMenuRef} className="toolbar-dropdown">
        <button
          ref={moreTriggerRef}
          type="button"
          onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }}
          onClick={(event) => {
            const opening = !showMoreMenu;
            setShowMoreMenu(opening);
            if (opening && event.detail === 0) {
              requestAnimationFrame(() => moreMenuRef.current?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')?.focus());
            }
          }}
          title={t('toolbar.moreFormatting')}
          aria-label={t('toolbar.moreFormatting')}
          aria-haspopup="menu"
          aria-expanded={showMoreMenu}
          aria-pressed={editor.isActive('strike') || editor.isActive('subscript') || editor.isActive('superscript')}
          className={`toolbar-button ${editor.isActive('strike') || editor.isActive('subscript') || editor.isActive('superscript') ? 'is-active' : ''}`}
        >
          <MoreHorizontal size={16} />
        </button>
        {showMoreMenu && (
          <Menu
            className="insert-menu"
            style={{ minWidth: '160px' }}
            label={t('toolbar.moreFormatting')}
            onMouseDown={e => e.preventDefault()}
            onEscape={() => {
              setShowMoreMenu(false);
              moreTriggerRef.current?.focus();
            }}
          >
            <button type="button" role="menuitemcheckbox" aria-checked={editor.isActive('strike')} className={`insert-menu-item${editor.isActive('strike') ? ' is-active' : ''}`}
              onClick={() => { editor.chain().focus().toggleStrike().run(); setShowMoreMenu(false); }}>
              <Strikethrough size={14} /><span>{t('toolbar.strikethrough')}</span>
            </button>
            <button type="button" role="menuitemcheckbox" aria-checked={editor.isActive('subscript')} className={`insert-menu-item${editor.isActive('subscript') ? ' is-active' : ''}`}
              onClick={() => { editor.chain().focus().toggleSubscript().run(); setShowMoreMenu(false); }}>
              <Subscript size={14} /><span>{t('toolbar.subscript')}</span>
            </button>
            <button type="button" role="menuitemcheckbox" aria-checked={editor.isActive('superscript')} className={`insert-menu-item${editor.isActive('superscript') ? ' is-active' : ''}`}
              onClick={() => { editor.chain().focus().toggleSuperscript().run(); setShowMoreMenu(false); }}>
              <Superscript size={14} /><span>{t('toolbar.superscript')}</span>
            </button>
          </Menu>
        )}
        </div>
      </div>

      <div {...groupProps('heading')}>
        <div ref={headingMenuRef} className="toolbar-dropdown">
        <button
          ref={headingTriggerRef}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const opening = !showHeadingMenu;
            setShowHeadingMenu(opening);
            if (opening && event.detail === 0) focusHeadingMenuItem(activeHeadingMenuIndex());
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setShowHeadingMenu(false);
              return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            setShowHeadingMenu(true);
            focusHeadingMenuItem(event.key === 'ArrowUp' ? HEADING_LEVELS.length : 0);
          }}
          title={t('toolbar.headingLevel')}
          aria-label={t('toolbar.heading')}
          aria-haspopup="menu"
          aria-expanded={showHeadingMenu}
          className={`toolbar-button${editor.isActive('heading') ? ' is-active' : ''}`}
        >
          <Heading size={16} />
          <span className="toolbar-label">{t('toolbar.heading')}</span>
          <ChevronRight size={10} style={{ transform: 'rotate(90deg)', marginLeft: 2 }} />
        </button>
        {showHeadingMenu && (
          <div
            className="insert-menu"
            role="menu"
            aria-label={t('toolbar.headingLevel')}
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={handleHeadingMenuKeyDown}
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!editor.isActive('heading')}
              className={`insert-menu-item${!editor.isActive('heading') ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor.chain().focus().setParagraph().run();
                setShowHeadingMenu(false);
                headingTriggerRef.current?.focus();
              }}
            >
              <span className="heading-menu-level">P</span><span>{t('toolbar.paragraph')}</span>
            </button>
            {HEADING_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                role="menuitemradio"
                aria-checked={editor.isActive('heading', { level })}
                className={`insert-menu-item${editor.isActive('heading', { level }) ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  editor.chain().focus().setHeading({ level }).run();
                  setShowHeadingMenu(false);
                  headingTriggerRef.current?.focus();
                }}
              >
                <span className="heading-menu-level">H{level}</span>
                <span>{t('toolbar.headingOption', { level })}</span>
              </button>
            ))}
          </div>
        )}
        </div>
        <Btn
          onClick={() => {
            const isUnnumbered = editor.getAttributes('heading').numbered === false;
            editor.chain().focus().updateAttributes('heading', { numbered: isUnnumbered ? null : false }).run();
          }}
          isActive={editor.isActive('heading') && editor.getAttributes('heading').numbered === false}
          disabled={!editor.isActive('heading')}
          title={t('toolbar.headingExcludeNumber')}
        >
          <Hash size={16} />
        </Btn>
      </div>

      <div {...groupProps('alignment')}>
        <div ref={alignMenuRef} className="toolbar-dropdown">
        <button
          ref={alignTriggerRef}
          type="button"
          onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }}
          onClick={(event) => {
            const opening = !showAlignMenu;
            setShowAlignMenu(opening);
            if (opening && event.detail === 0) {
              requestAnimationFrame(() => alignMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus());
            }
          }}
          title={t('toolbar.alignment')}
          aria-label={t('toolbar.alignment')}
          aria-haspopup="menu"
          aria-expanded={showAlignMenu}
          className="toolbar-button"
        >
          {activeAlign}
          <ChevronRight size={10} style={{ transform: 'rotate(90deg)', marginLeft: 2 }} />
        </button>
        {showAlignMenu && (
          <Menu
            className="insert-menu"
            style={{ minWidth: '140px' }}
            label={t('toolbar.alignment')}
            onMouseDown={e => e.preventDefault()}
            onEscape={() => {
              setShowAlignMenu(false);
              alignTriggerRef.current?.focus();
            }}
          >
            {([
              { align: 'left', icon: <AlignLeft size={14} />, label: t('toolbar.alignLeft') },
              { align: 'center', icon: <AlignCenter size={14} />, label: t('toolbar.alignCenter') },
              { align: 'right', icon: <AlignRight size={14} />, label: t('toolbar.alignRight') },
              { align: 'justify', icon: <AlignJustify size={14} />, label: t('toolbar.alignJustify') },
            ] as const).map(({ align, icon, label }) => (
              <button
                key={align}
                type="button"
                role="menuitemradio"
                aria-checked={editor.isActive({ textAlign: align })}
                className={`insert-menu-item${editor.isActive({ textAlign: align }) ? ' is-active' : ''}`}
                onClick={() => { editor.chain().focus().setTextAlign(align).run(); setShowAlignMenu(false); }}
              >
                {icon}<span>{label}</span>
              </button>
            ))}
          </Menu>
        )}
        </div>
      </div>

      <div {...groupProps('lists-blocks')}>
        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} title={t('toolbar.bulletList')}>
          <List size={16} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} title={t('toolbar.orderedList')}>
          <ListOrdered size={16} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleTaskList().run()} isActive={editor.isActive('taskList')} title={t('toolbar.taskList')}>
          <ListChecks size={16} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} isActive={editor.isActive('blockquote')} title={t('toolbar.blockquote')}>
          <Quote size={16} />
        </Btn>
      </div>

      <div {...groupProps('insert')}>
        <div ref={insertMenuRef} className="toolbar-dropdown">
        <IconButton
          ref={insertTriggerRef}
          onClick={() => setShowInsertMenu(!showInsertMenu)}
          label={t('toolbar.insert')}
          aria-haspopup="menu"
          aria-expanded={showInsertMenu}
          pressed={showInsertMenu}
        >
          <Plus size={16} />
          <span className="toolbar-label">{t('toolbar.insert')}</span>
        </IconButton>
        {showInsertMenu && (
          <Menu
            className="insert-menu"
            label={t('toolbar.insert')}
            onEscape={() => {
              closeInsertMenu();
              insertTriggerRef.current?.focus();
            }}
          >
            <input
              type="text"
              className="insert-menu-search"
              placeholder={t('toolbar.insertSearch')}
              aria-label={t('toolbar.insertSearch')}
              value={insertQuery}
              autoFocus
              onChange={(e) => setInsertQuery(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            />
            {insertQ ? (
              <>
                {filteredInsertActions.length === 0 && (
                  <div className="insert-menu-empty">{t('toolbar.noMatches')}</div>
                )}
                {filteredInsertActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    className="insert-menu-item"
                    onClick={() => { closeInsertMenu(); action.run(); }}
                  >
                    {action.icon}<span>{action.label}</span>
                  </button>
                ))}
              </>
            ) : (
            <>
            {/* Table */}
            <div
              className="insert-menu-subcontainer"
              onMouseEnter={() => setShowTableSub(true)}
              onMouseLeave={() => { setShowTableSub(false); setShowCustomSize(false); }}>
              <button
                ref={tableSubTriggerRef}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={showTableSub}
                className="insert-menu-item has-sub"
                onClick={() => setShowTableSub((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  setShowTableSub(true);
                  requestAnimationFrame(() => {
                    tableSubmenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
                  });
                }}
              >
                <Table2 size={15} /><span>{t('toolbar.table')}</span>
                <ChevronRight size={14} className="insert-menu-arrow" />
              </button>
              {showTableSub && (
                <Menu
                  ref={tableSubmenuRef}
                  className="insert-submenu"
                  label={t('toolbar.table')}
                  onEscape={() => {
                    setShowTableSub(false);
                    setShowCustomSize(false);
                    tableSubTriggerRef.current?.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft') return;
                    event.preventDefault();
                    setShowTableSub(false);
                    setShowCustomSize(false);
                    tableSubTriggerRef.current?.focus();
                  }}
                >
                  <div style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>{t('toolbar.tableSize')}</div>
                  {[3, 5, 7, 10].map(size => (
                    <button key={size} type="button" role="menuitem" className="insert-menu-item" onClick={() => insertTable(size, size)}>
                      {size} × {size}
                    </button>
                  ))}
                  <button type="button" role="menuitem" className="insert-menu-item" onClick={(event) => { event.stopPropagation(); setShowCustomSize(true); }}>
                    {t('toolbar.customSize')}
                  </button>
                  {showCustomSize && (
                    <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input type="number" min="1" max="50" value={customRows} onChange={(e) => setCustomRows(e.target.value)} className="insert-size-input" placeholder={t('toolbar.rows')} aria-label={t('toolbar.rows')} />
                        <span style={{ fontSize: '12px' }}>×</span>
                        <input type="number" min="1" max="50" value={customCols} onChange={(e) => setCustomCols(e.target.value)} className="insert-size-input" placeholder={t('toolbar.columns')} aria-label={t('toolbar.columns')} />
                      </div>
                      <button type="button" role="menuitem" className="insert-menu-item" style={{ textAlign: 'center', fontWeight: 'bold' }}
                        onClick={() => { const r = parseInt(customRows), c = parseInt(customCols); if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && r <= 50 && c <= 50) insertTable(r, c); }}>
                        {t('toolbar.insert')}
                      </button>
                    </div>
                  )}
                </Menu>
              )}
            </div>

            {onInsertImage && (
              <button type="button" role="menuitem" className="insert-menu-item" onClick={() => { closeInsertMenu(); onInsertImage(); }}>
                <ImageIcon size={15} /><span>{t('toolbar.image')}</span>
              </button>
            )}
            {onInsertDrawio && (
              <button type="button" role="menuitem" className="insert-menu-item" onClick={() => { closeInsertMenu(); onInsertDrawio(); }}>
                <PenTool size={15} /><span>{t('toolbar.drawio')}</span>
              </button>
            )}
            {onInsertMath && (
              <button type="button" role="menuitem" className="insert-menu-item" onClick={() => { closeInsertMenu(); onInsertMath(); }}>
                <Sigma size={15} /><span>{t('toolbar.math')}</span>
              </button>
            )}
            <button type="button" role="menuitem" className="insert-menu-item" onClick={() => { closeInsertMenu(); editor.chain().focus().toggleCodeBlock().run(); }}>
              <Code size={15} /><span>{t('toolbar.codeBlock')}</span>
            </button>
            {onInsertDiagram && (
              <button type="button" role="menuitem" className="insert-menu-item" onClick={() => { closeInsertMenu(); onInsertDiagram(); }}>
                <GitGraph size={15} /><span>{t('toolbar.diagram')}</span>
              </button>
            )}
            <button type="button" role="menuitem" className="insert-menu-item" onClick={() => { closeInsertMenu(); editor.chain().focus().setHorizontalRule().run(); }}>
              <span style={{ fontSize: '15px', lineHeight: '15px', width: '15px', textAlign: 'center' }}>—</span>
              <span>{t('toolbar.horizontalRule')}</span>
            </button>

            {/* Callout */}
            <div
              className="insert-menu-subcontainer"
              onMouseEnter={() => setShowCalloutSub(true)}
              onMouseLeave={() => setShowCalloutSub(false)}>
              <button
                ref={calloutSubTriggerRef}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={showCalloutSub}
                className="insert-menu-item has-sub"
                onClick={() => setShowCalloutSub((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  setShowCalloutSub(true);
                  requestAnimationFrame(() => {
                    calloutSubmenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
                  });
                }}
              >
                <MessageSquareWarning size={15} /><span>{t('toolbar.callout')}</span>
                <ChevronRight size={14} className="insert-menu-arrow" />
              </button>
              {showCalloutSub && (
                <Menu
                  ref={calloutSubmenuRef}
                  className="insert-submenu"
                  label={t('toolbar.callout')}
                  onEscape={() => {
                    setShowCalloutSub(false);
                    calloutSubTriggerRef.current?.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft') return;
                    event.preventDefault();
                    setShowCalloutSub(false);
                    calloutSubTriggerRef.current?.focus();
                  }}
                >
                  {(Object.entries(CALLOUT_ICONS) as [CalloutVariant, string][]).map(([variant, icon]) => (
                    <button key={variant} type="button" role="menuitem" className="insert-menu-item"
                      onClick={() => { closeInsertMenu(); editor.chain().focus().insertContent({ type: 'callout', attrs: { variant }, content: [{ type: 'paragraph' }] }).run(); }}>
                      <span>{icon}</span><span>{t(CALLOUT_LABEL_KEYS[variant])}</span>
                    </button>
                  ))}
                </Menu>
              )}
            </div>

            {onInsertCrossRef && (
              <button type="button" role="menuitem" className="insert-menu-item" onClick={() => { closeInsertMenu(); onInsertCrossRef(); }}>
                <Hash size={15} /><span>{t('toolbar.crossReference')}</span>
              </button>
            )}
            </>
            )}
          </Menu>
        )}
        </div>
      </div>

      {tableIsActive && (
        <div {...groupProps('table-context')}>
        <Btn onClick={() => editor.chain().focus().deleteTable().run()} title={t('toolbar.tableDelete')} danger>
          <Trash2 size={16} />
          </Btn>
        </div>
      )}

      {layout.overflow.length > 0 && (
        <div ref={overflowRef} className="toolbar-dropdown toolbar-overflow">
          <IconButton
            ref={overflowTriggerRef}
            label={t('toolbar.overflow')}
            aria-haspopup="menu"
            aria-expanded={showOverflowMenu || activeOverflowGroup !== null}
            pressed={showOverflowMenu || activeOverflowGroup !== null}
            onClick={() => {
              const opening = !showOverflowMenu;
              setActiveOverflowGroup(null);
              setShowOverflowMenu(opening);
              if (opening) {
                requestAnimationFrame(() => {
                  overflowRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
                });
              }
            }}
          >
            <MoreHorizontal size={16} />
          </IconButton>
          {showOverflowMenu && (
            <Menu
              className="insert-menu toolbar-overflow-menu"
              label={t('toolbar.overflow')}
              onEscape={() => {
                setShowOverflowMenu(false);
                overflowTriggerRef.current?.focus();
              }}
            >
              {layout.overflow.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className="insert-menu-item"
                  onClick={() => {
                    setShowOverflowMenu(false);
                    setActiveOverflowGroup(id);
                    requestAnimationFrame(() => {
                      groupElementsRef.current[id]?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
                    });
                  }}
                >
                  <span>{t(TOOLBAR_GROUP_LABEL_KEYS[id])}</span>
                  <ChevronRight size={14} className="insert-menu-arrow" />
                </button>
              ))}
            </Menu>
          )}
        </div>
      )}

    </div>
  );
};
