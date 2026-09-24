import { useEffect, useRef } from 'react';
import { hueVars } from './copy.js';

export const Icon = ({ name, size = 20, color, style }) => (
  <span aria-hidden="true" className="ms" style={{ fontSize: size, color, ...style }}>{name}</span>
);

export const Back = ({ onClick, className = '' }) => (
  <button type="button" className={'back ' + className} onClick={onClick} aria-label="Back">
    <Icon name="arrow_back" size={24} />
  </button>
);

export const More = ({ onClick, label = 'More options', className = '' }) => (
  <button type="button" className={'icon-btn ' + className} onClick={onClick} aria-label={label}>
    <Icon name="more_horiz" size={20} />
  </button>
);

/** The primary action, in the hue of what it does. */
export const Cta = ({ hue, plain, children, className = '', style, ...rest }) => (
  <button type="button" className={'cta ' + (plain ? 'plain ' : '') + className} style={{ ...hueVars(hue), ...style }} {...rest}>
    {children}
  </button>
);

export const Ghost = ({ children, ...rest }) => (
  <button type="button" className="ghost" {...rest}>{children}</button>
);

export const Pill = ({ track, artist, hue = 'song' }) => (
  <span className="pill">
    <Icon name="music_note" size={14} color={`var(--${hue})`} />
    <span className="t">{track}</span>
    {artist ? <span className="a">{artist}</span> : null}
  </span>
);

/**
 * A sheet over the screen. The screen under it goes inert, focus moves in and
 * is kept in, and Escape or the scrim closes it — as the canvas does.
 */
export function Sheet({ sheet, onClose, screenRef }) {
  const ref = useRef(null);
  useEffect(() => {
    const under = screenRef.current;
    if (under) under.inert = true;
    const focusables = () => [...(ref.current?.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])') || [])]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    (ref.current?.querySelector('input') || focusables()[0])?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      const inside = ref.current?.contains(a);
      if (e.shiftKey && (!inside || a === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || a === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (under) under.inert = false;
    };
  }, [sheet, onClose, screenRef]);

  return (
    <div className="sheet-wrap">
      <button type="button" className="scrim" onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={sheet.title}>
        <div className="grip"><span aria-hidden="true" /></div>
        <div className="h2">{sheet.title}</div>
        {sheet.sub ? <div className="small" style={{ marginTop: 5 }}>{sheet.sub}</div> : null}
        {sheet.body ? <div style={{ marginTop: 16 }}>{sheet.body}</div> : null}
        {sheet.rows?.length ? (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column' }}>
            {sheet.rows.map((r) => (
              <button key={r.label} type="button" className="srow" onClick={r.onTap} disabled={r.disabled}>
                <Icon name={r.icon} size={20} color={r.fg} style={{ marginTop: 1 }} />
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span className="body" style={{ color: r.fg }}>{r.label}</span>
                  {r.sub ? <span className="small">{r.sub}</span> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <Cta plain style={{ height: 52, marginTop: 14 }} onClick={onClose}>{sheet.close || 'Cancel'}</Cta>
      </div>
    </div>
  );
}
