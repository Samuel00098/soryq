import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import './Dropdown.css';

// Premium custom dropdown matching the app's picker language (see
// FloatingPromptBar target-picker): frosted popover, rounded items, accent
// active state. Replaces native <select> so menus feel consistent.
export type DropdownOption = {
  value: string;
  label: string;
  sublabel?: string;
  color?: string;
  disabled?: boolean;
};

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

// Menu max-height (keep in sync with .dd-menu max-height in CSS).
const MENU_MAX = 260;

export default function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  ariaLabel = 'Select an option',
  disabled = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootEl = useRef<HTMLDivElement | null>(null);
  const menuEl = useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  /**
   * Position the menu. It is portaled to <body> with `position: fixed` so it can
   * never be clipped by an ancestor's `overflow` (the room panels that host this
   * dropdown clip their content), and the available space decides whether it
   * opens up or down and how tall it can grow before it scrolls.
   */
  const updatePlacement = useCallback(() => {
    if (!rootEl.current) return;
    const r = rootEl.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const willDropUp = below < Math.min(MENU_MAX, 200) && above > below;
    setDropUp(willDropUp);

    const maxHeight = Math.max(120, Math.min(MENU_MAX, (willDropUp ? above : below) - 12));
    const next: CSSProperties = {
      position: 'fixed',
      left: r.left,
      width: r.width,
      maxHeight,
    };
    if (willDropUp) {
      next.bottom = window.innerHeight - r.top + 6;
    } else {
      next.top = r.bottom + 6;
    }
    setMenuStyle(next);
  }, []);

  function toggle() {
    if (disabled) return;
    if (!open) updatePlacement();
    setOpen((o) => !o);
  }

  function choose(option: DropdownOption) {
    if (option.disabled) return;
    onChange?.(option.value);
    setOpen(false);
  }

  function onKeydown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !open) {
      e.preventDefault();
      updatePlacement();
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        updatePlacement();
        setOpen(true);
        return;
      }
      const enabled = options.filter((o) => !o.disabled);
      if (enabled.length === 0) return;
      const idx = enabled.findIndex((o) => o.value === value);
      const next =
        e.key === 'ArrowDown'
          ? enabled[Math.min(enabled.length - 1, idx + 1)]
          : enabled[Math.max(0, idx - 1)];
      if (next) onChange?.(next.value);
    }
  }

  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node;
      // The menu is portaled outside `rootEl`, so it must be checked separately —
      // otherwise clicking an option would register as an outside click and close
      // the menu before the selection fires.
      if (rootEl.current?.contains(target)) return;
      if (menuEl.current?.contains(target)) return;
      setOpen(false);
    };
    const reposition = () => updatePlacement();
    window.addEventListener('mousedown', handlePointer);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, updatePlacement]);

  return (
    <div className="dropdown" ref={rootEl}>
      <button
        type="button"
        className={`dd-trigger${open ? ' open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        onKeyDown={onKeydown}
      >
        {selected?.color && <span className="dd-dot" style={{ background: selected.color }}></span>}
        <span className={`dd-value${!selected ? ' placeholder' : ''}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          className="dd-chevron"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuEl}
            className={`dd-menu${dropUp ? ' drop-up' : ''}`}
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`dd-item${option.value === value ? ' active' : ''}`}
                disabled={option.disabled}
                role="option"
                aria-selected={option.value === value}
                onClick={() => choose(option)}
              >
                {option.color && <span className="dd-dot" style={{ background: option.color }}></span>}
                <span className="dd-item-label">{option.label}</span>
                {option.sublabel && <span className="dd-item-sub">{option.sublabel}</span>}
                {option.value === value && (
                  <svg
                    className="dd-check"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
