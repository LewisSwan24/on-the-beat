import { useEffect, useState } from 'react';
import { HUE, MEET, hueVars, matchName, spotShort } from '../copy.js';
import { reducedMotion } from '../lib/device.js';
import { FOUND_MINE, foundBoth, metCount, metItem } from '../lib/found.js';
import { PHASES, hhmm, phaseOf, timesOf } from '../lib/phase.js';
import { tonightKey } from '../lib/store.js';
import { Back, Cta, Ghost, Icon, More, Pill } from '../ui.jsx';

/** S8 — you both said yes. Now a name, and where to meet. */
export function Match({ match, number, held, onMyWay, onNotThis, onPick }) {
  const full = 'Meet ' + match.spot + '.';
  const [typed, setTyped] = useState(reducedMotion() ? full : '');
  useEffect(() => {
    if (reducedMotion()) { setTyped(full); return undefined; }
    setTyped('');
    let iv = null;
    const t = setTimeout(() => {
      const t0 = Date.now();
      iv = setInterval(() => {
        const i = Math.min(full.length, Math.round((Date.now() - t0) / 28));
        setTyped(full.slice(0, i));
        if (i >= full.length) clearInterval(iv);
      }, 28);
    }, 220);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [full]);

  const name = matchName(match);
  return (
    <div className="scr" style={{ justifyContent: 'center', padding: '0 24px', animation: 'none' }}>
      {number ? (
        <div className="lede" style={{ marginBottom: 16, textAlign: 'center' }}>
          {MEET.look} <span style={{ font: 'var(--display-l)', color: (HUE[match.intent] || HUE.hi).c }}>{number}</span>
          {held ? <div className="small" style={{ marginTop: 6 }}>{MEET.held}</div> : null}
        </div>
      ) : null}
      <div className="match" style={hueVars(match.intent)}>
        <div className="h2">You both said yes.</div>
        <div className="pair">
          <div>
            <span className="micro">you</span>
            {match.yourPick ? <span className="body">{match.yourPick}</span> : (
              <button type="button" onClick={onPick} style={{ alignSelf: 'flex-start', margin: '-6px -6px -6px 0', minHeight: 44, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, textAlign: 'left' }}>
                <span className="body muted">not picked yet</span>
                <span className="micro" style={{ color: 'var(--song)' }}>pick one ›</span>
              </button>
            )}
          </div>
          <div>
            <span className="micro" style={{ color: 'var(--c)' }}>{name}</span>
            <span className="body" style={{ color: match.pick ? '#fff' : 'var(--text-2)' }}>{match.pick || 'no pick yet'}</span>
          </div>
        </div>
        <div className="lede" style={{ marginTop: 20, minHeight: 52 }} aria-label={full}>
          <span aria-hidden="true">{typed}</span>
          {typed.length < full.length ? <span aria-hidden="true" className="caret" style={{ color: 'var(--c)' }}>▍</span> : null}
        </div>
      </div>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Cta hue={match.intent} onClick={onMyWay}>ON MY WAY</Cta>
        <Ghost onClick={onNotThis}>Not this one</Ghost>
      </div>
    </div>
  );
}

/** S11 — the person you met: found, and kept, only if you both say so. */
/** SAVE TO CONTACTS: the card is made on the phone and handed to it; nothing is sent. */
function SaveCard({ onSave, label }) {
  return (
    <button type="button" className="micro" aria-label={label} onClick={onSave}
      style={{ color: 'var(--ok)', minHeight: 44, padding: '0 4px', alignSelf: 'center', whiteSpace: 'nowrap' }}>
      SAVE TO CONTACTS
    </button>
  );
}

export function Mate({ match, number, held, onBack, onMore, onFound, onKeep, onTonight, onSave }) {
  const name = matchName(match);
  const hue = HUE[match.intent] || HUE.hi;
  return (
    <div className="scr">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Back onClick={onBack} />
        <More className="" onClick={onMore} />
      </div>
      <div className="mate">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="dot" aria-hidden="true" style={{ width: 10, height: 10, '--c': hue.c, '--g': hue.g }} />
          <span className="h1">{name}</span>
        </div>
        {match.pick ? <div style={{ marginTop: 16 }}><Pill track={match.pick} /></div> : null}
        <div className="small tnum" style={{ marginTop: 16 }}>met at {hhmm(match.at)}, {spotShort(match.spot)}</div>
      </div>
      {number ? (
        <div className="lede" style={{ marginBottom: 14 }}>
          {MEET.look} <span style={{ font: 'var(--display-l)', color: hue.c }}>{number}</span>
          {held ? <div className="small" style={{ marginTop: 6 }}>{MEET.held}</div> : null}
        </div>
      ) : null}
      {match.foundAt ? (
        <div className="small tnum" style={{ marginBottom: 14, color: 'var(--ok)' }}>{foundBoth(match.foundAt)}</div>
      ) : match.found ? (
        <div className="small" style={{ marginBottom: 14 }}>{FOUND_MINE}</div>
      ) : (
        <div style={{ marginBottom: 14 }}><Cta hue={match.intent} onClick={onFound}>WE FOUND EACH OTHER</Cta></div>
      )}
      <div className="keep">
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span className="h2">Keep after tonight</span>
          <span className="small">Only if you both do.</span>
        </span>
        <button type="button" className="switch" role="switch" aria-checked={!!match.kept} aria-label="Keep after tonight" onClick={() => onKeep(!match.kept)}>
          <span className="rail"><span className="knob" /></span>
        </button>
      </div>
      {match.keptByBoth && match.contact ? (
        <div className="reach">
          <Icon name="favorite" size={20} color="var(--ok)" />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="micro" style={{ color: 'var(--ok)' }}>you both kept it</span>
            <span className="v">{match.contact}</span>
          </span>
          <SaveCard onSave={onSave} label={'Save ' + name + ' to your contacts'} />
        </div>
      ) : match.kept ? (
        <div className="small" style={{ marginTop: 10 }}>kept on your side. they won't know unless they keep it too.</div>
      ) : null}
      <div style={{ marginTop: 'auto', paddingBottom: 26 }}>
        <Cta plain onClick={onTonight}>BACK TO TONIGHT</Cta>
      </div>
    </div>
  );
}

const matchLine = (m) => {
  const name = matchName(m);
  if (m.intent === 'song') return 'matched with ' + name + (m.pick ? ' over ' + m.pick : '');
  if (m.intent === 'dance') return 'danced with ' + (m.name ? name : name.toLowerCase());
  return 'said hi to ' + name;
};

/** S12 — tonight, as this phone remembers it. */
export function Tonight({ show, phase, night, live, kept, name, onBack, onKeep, onOpen, onName, onSave }) {
  const pi = Math.max(0, PHASES.indexOf(phase));
  const stored = Object.values(night?.matches || {});
  const items = [
    ...(night?.events || []).map((e) => ({ at: e.at, text: e.text })),
    // A meeting found by both is met, when it was found; a match never found keeps its own line.
    ...stored.map((m) => metItem(m) || { at: m.at, text: matchLine(m) }),
  ];
  if (phase === 'AFTER') {
    const end = new Date();
    const { end: endMins } = timesOf(show);
    end.setHours(Math.floor(endMins / 60) % 24, endMins % 60, 0, 0);
    if (end.getTime() <= Date.now()) items.push({ at: end.getTime(), text: 'lights up' });
  }
  items.sort((a, b) => a.at - b.at);
  const byPhase = PHASES.map((p) => items.filter((it) => phaseOf(show, new Date(it.at)) === p));
  const keptCount = stored.filter((m) => m.kept).length;
  const earlier = kept.filter((k) => k.night !== tonightKey());

  return (
    <div className="scr">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ margin: '6px 0 3px' }}>Tonight</h1>
      <div className="tnum" aria-live="polite" style={{ font: 'var(--num)', color: 'var(--text-2)', marginBottom: 18 }}>
        {metCount(stored)} met · {keptCount} kept
      </div>
      <div className="scroll" style={{ gap: 0 }}>
        {PHASES.map((p, i) => {
          const reached = i <= pi;
          const its = reached ? byPhase[i] : [];
          return (
            <div key={p} className="moment">
              <span className="rail">
                <i style={{ background: reached ? '#fff' : 'rgba(255,255,255,.18)' }} />
                <b style={{ minHeight: reached && its.length > 1 ? 34 : 14 }} />
              </span>
              <span className="items">
                <span className="label" style={{ color: reached ? '#fff' : 'var(--text-2)' }}>{p}</span>
                {its.map((it) => <span key={it.at + it.text} className="body muted tnum">{hhmm(it.at)} · {it.text}</span>)}
              </span>
            </div>
          );
        })}

        {phase === 'AFTER' ? (
          <div className="keeps">
            <div className="h2">Keep anyone?</div>
            <div className="small" style={{ marginTop: 4 }}>only if you both do. nothing is shared otherwise.</div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {live.length === 0 ? <span className="small" style={{ paddingTop: 8 }}>nobody to keep tonight — that's fine too.</span> : null}
              {live.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" className="keeprow" style={{ flex: 1, minWidth: 0 }} aria-pressed={!!m.kept} onClick={() => onKeep(m, !m.kept)}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: (HUE[m.intent] || HUE.hi).c }} />
                  <span style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span className="body">{matchName(m)}</span>
                    {m.keptByBoth && m.contact ? <span className="small" style={{ color: 'var(--ok)', overflowWrap: 'anywhere' }}>{m.contact}</span> : null}
                  </span>
                  <span className="micro" style={{ color: m.kept ? 'var(--ok)' : 'var(--text-3)' }}>{m.keptByBoth ? 'BOTH KEPT' : m.kept ? 'KEPT' : 'KEEP'}</span>
                </button>
                {m.keptByBoth && m.contact ? <SaveCard onSave={() => onSave(m)} label={'Save ' + matchName(m) + ' to your contacts'} /> : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="small" style={{ padding: '2px 0 18px' }}>the night's still on — this fills up as you go.</div>
        )}

        {live.length && phase !== 'AFTER' ? (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
            {live.map((m) => (
              <button key={m.id} type="button" className="qrow" onClick={() => onOpen(m)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: (HUE[m.intent] || HUE.hi).c }} />
                  <span style={{ color: '#fff' }}>{matchName(m)}</span>
                </span>
                <Icon name="chevron_right" size={18} color="var(--text-3)" />
              </button>
            ))}
          </div>
        ) : null}

        {earlier.length ? (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label">kept from other nights</span>
            {earlier.map((k) => (
              <div key={k.night + k.id} className="row" style={{ gap: 4, padding: '12px 16px' }}>
                <span className="body">{k.name || 'someone'}</span>
                <span className="small" style={{ color: 'var(--ok)', overflowWrap: 'anywhere', userSelect: 'all' }}>{k.contact}</span>
                <span className="small">{k.night}{k.venue ? ' · ' + k.venue : ''}</span>
                {k.contact ? <span style={{ alignSelf: 'flex-start' }}><SaveCard onSave={() => onSave(k)} label={'Save ' + (k.name || 'them') + ' to your contacts'} /></span> : null}
              </div>
            ))}
          </div>
        ) : null}

        <button type="button" className="qrow" style={{ marginTop: 18, marginBottom: 20 }} onClick={onName}>
          <span>Matches call you <span style={{ color: '#fff' }}>{name || '—'}</span></span>
          <span className="micro">CHANGE</span>
        </button>
      </div>
    </div>
  );
}

/** S13 — invisible. Nothing is broadcasting, and it stays that way until you say. */
export function Quiet({ paired, onBackOn, onBlock, onReport, onLeft }) {
  const rows = [
    { label: 'Block someone', onTap: onBlock },
    { label: 'Report something', onTap: onReport },
    { label: "I've left the venue", onTap: onLeft },
  ];
  return (
    <div className="scr tall">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
        <Icon name="visibility_off" size={40} color="#6E6D77" style={{ marginBottom: 8 }} />
        <span className="h1">You're invisible.</span>
        <span className="lede muted">Nothing is broadcasting.</span>
        {paired ? <span className="lede muted">Your wristband is dark too. Hold its side button to come back.</span> : null}
      </div>
      <div style={{ paddingBottom: 12 }}>
        <Cta plain onClick={onBackOn}>TURN BACK ON</Cta>
      </div>
      <div style={{ paddingBottom: 26 }}>
        {rows.map((r) => (
          <button key={r.label} type="button" className="qrow" onClick={r.onTap}>
            <span>{r.label}</span>
            <Icon name="chevron_right" size={18} color="var(--text-3)" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** "I've left", carried until the relay has heard it (spec §2). */
export function Leaving({ offline }) {
  return (
    <div className="scr tall">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
        <Icon name="logout" size={40} color="#6E6D77" style={{ marginBottom: 8 }} />
        <span className="h1">Leaving…</span>
        <span className="lede muted">{offline ? 'You’ll be taken out as soon as there’s signal.' : 'Taking you out of the room.'}</span>
      </div>
    </div>
  );
}
