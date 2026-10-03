import { useEffect, useState } from 'react';
import { actShort, someone } from '../copy.js';
import { sameTrack } from '../lib/opener.js';
import { Back, Icon, More } from '../ui.jsx';

/** S6 — what should the opening track be? Only the track is ever shown. */
export function Pick({ show, text, setText, onBack }) {
  const setlist = Array.isArray(show?.setlist) ? show.setlist : [];
  const artist = actShort(show?.act) === 'the band' ? '' : String(show?.act || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ margin: '6px 0 16px' }}>What should the opening track be?</h1>
      <div className="field" style={{ '--c': 'var(--song)', borderColor: text ? 'var(--song)' : undefined }}>
        <Icon name="queue_music" size={18} color="var(--song)" />
        <input value={text} onChange={(e) => setText(e.target.value.slice(0, 60))} placeholder="type any track" aria-label="Your opening track" enterKeyHint="done" />
      </div>
      {setlist.length ? (
        <>
          <div className="label" style={{ margin: '22px 0 12px' }}>from tonight's set list</div>
          <div className="tracks">
            {setlist.map((t) => {
              const sel = text === t;
              return (
                <button key={t} type="button" className="trk" aria-pressed={sel} onClick={() => setText(t)}>
                  <Icon name="music_note" size={15} color={sel ? 'var(--song)' : 'var(--text-3)'} />
                  <span className="small" style={{ color: sel ? 'var(--song)' : '#fff', whiteSpace: 'nowrap' }}>{t}</span>
                  {artist ? <span className="small" style={{ whiteSpace: 'nowrap' }}>{artist}</span> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      <div className="small" style={{ marginTop: 'auto', padding: '16px 0 20px' }}>nobody sees your name — only the track.</div>
    </div>
  );
}

/** Once the venue's staff name it: the answer, whether you called it, and how many here did — never who. */
function Opener({ opener }) {
  return (
    <div className="yours" role="status" style={{ borderColor: 'var(--song)', marginBottom: 8 }}>
      <Icon name="queue_music" size={19} color="var(--song)" />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="micro" style={{ color: 'var(--song)' }}>the opener was</span>
        <span className="h2">{opener.track}</span>
        <span className="small">
          {opener.line ? <span style={{ color: opener.called ? 'var(--ok)' : undefined }}>{opener.line} </span> : null}
          {opener.crowd}
        </span>
      </span>
    </div>
  );
}

/** S7 — what everyone wants first. Like a track, not a face, and take it back if you like. */
export function Wall({ wall, pick, opener, onBack, onChange, onLike, onMore }) {
  // A like is sent at once, and shown at once: the room's answer follows and replaces it.
  const [pending, setPending] = useState({});
  useEffect(() => setPending({}), [wall]);
  const liked = (w) => (w.handle in pending ? pending[w.handle] : w.liked);
  const tap = (w) => {
    const next = !liked(w);
    setPending((p) => ({ ...p, [w.handle]: next }));
    onLike(w.handle, next);
  };
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ margin: '6px 0 4px' }}>What everyone wants first</h1>
      <span className="small" style={{ marginBottom: 12 }}>like a track, not a face — and you can take it back.</span>
      {opener ? <Opener opener={opener} /> : null}
      {pick ? (
        <div className="yours">
          <Icon name="music_note" size={19} color="var(--song)" />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="micro" style={{ color: 'var(--song)' }}>your pick</span>
            <span className="h2">{pick}</span>
          </span>
          <button type="button" className="btn-s" style={{ padding: '0 14px', '--f': 'var(--text-2)' }} onClick={onChange}>CHANGE</button>
        </div>
      ) : (
        <button type="button" className="add-yours" onClick={onChange}>
          <span className="small" style={{ textAlign: 'left' }}>you haven't picked yet — add yours</span>
          <Icon name="chevron_right" size={18} color="var(--song)" />
        </button>
      )}
      <div className="scroll">
        {wall.length === 0 ? (
          <div className="empty">
            <span className="h2">No picks on the wall yet.</span>
            <span className="body muted">When someone here picks a track, it shows up — the track, never the person.</span>
          </div>
        ) : null}
        {wall.map((w) => {
          const on = liked(w);
          return (
            <div key={w.handle} className="row" style={{ gap: 9, borderColor: on ? 'var(--song)' : undefined }}>
              <div className="person" style={{ gap: 9 }}>
                <Icon name="music_note" size={19} color="var(--song)" />
                <span className="h2" style={{ flex: 1, minWidth: 0 }}>{w.pick}</span>
                <More className="more" onClick={() => onMore(w.handle, someone(w.band))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingRight: 6 }}>
                <span className="small">
                  {on ? 'You liked this' : someone(w.band)}
                  {opener && sameTrack(w.pick, opener.track) ? <span className="micro" style={{ color: 'var(--song)', marginLeft: 8 }}>CALLED IT</span> : null}
                </span>
                <button type="button" className="btn-s" aria-pressed={on} onClick={() => tap(w)} style={{ margin: '-6px 0', '--c': on ? 'var(--song)' : 'var(--line)', '--f': on ? 'var(--song)' : '#fff' }}>
                  {on ? 'LIKED' : 'LIKE'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
