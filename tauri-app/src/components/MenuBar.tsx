import React, { useEffect, useRef, useState } from 'react';

export interface MenuItemDef {
  /** 구분선을 렌더링하려면 label 없이 separator만 true로 둔다. */
  separator?: true;
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export interface MenuDef {
  label: string;
  items: MenuItemDef[];
}

interface MenuBarProps {
  menus: MenuDef[];
}

/**
 * VS Code/일반 데스크톱 앱과 유사한 상단 가로 메뉴바(File/Edit/View/Help 등).
 * 메뉴 구성은 부모가 선언적 `menus` 배열로 전달하므로, 새 메뉴/항목 추가는
 * 배열에 항목을 추가하는 것만으로 확장 가능하다.
 */
export const MenuBar: React.FC<MenuBarProps> = ({ menus }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const handleOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenIndex(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenIndex(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openIndex]);

  return (
    <div className="app-menu-bar" ref={barRef}>
      {menus.map((menu, index) => (
        <div key={menu.label} className="app-menu-bar-item">
          <button
            className={`app-menu-bar-label${openIndex === index ? ' is-open' : ''}`}
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            onMouseEnter={() => { if (openIndex !== null) setOpenIndex(index); }}
          >
            {menu.label}
          </button>
          {openIndex === index && (
            <div className="app-menu-dropdown">
              {menu.items.map((item, itemIndex) =>
                item.separator ? (
                  <div key={`sep-${itemIndex}`} className="app-menu-dropdown-separator" />
                ) : (
                  <button
                    key={item.label}
                    className="app-menu-dropdown-item"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpenIndex(null);
                      item.onClick?.();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="app-menu-dropdown-shortcut">{item.shortcut}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
