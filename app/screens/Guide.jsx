// ON THE BEAT — the wristband guide (docs/superpowers/specs/2026-10-13-wristband-guide-design.md): the practice after a
// first pairing, and the page to look things up. Every word is in app/copy.js (GUIDE).

import { useEffect, useMemo, useRef, useState } from 'react';
import { GUIDE, HUE } from '../copy.js';
import { GUIDE_SOUNDS, PRACTICE_STEPS, bandLive, snapshot, stepDone } from '../lib/guide.js';
import { createSpeaker } from '../lib/speaker.js';
import { Back, Cta, Ghost, Icon } from '../ui.jsx';

/** A StickC Plus held landscape: the screen, FACE beside it, SIDE on its edge, POWER opposite. `lit` names a button. */
export function BandDrawing({ lit = null, hue = 'hi', face = '' }) {
  const glow = HUE[hue]?.c || '#fff';
  const on = (k) => (lit === k ? glow : 'rgba(255,255,255,.28)');
  return (
    <svg viewBox="0 0 240 124" className="guide-band" role="img" aria-label={'wristband' + (lit ? ', ' + lit + ' button' : '')}>
      <rect x="20" y="16" width="200" height="88" rx="18" fill="#1b1b1f" stroke="rgba(255,255,255,.18)" />
      <rect x="40" y="30" width="118" height="60" rx="6" fill="#000" />
      <text x="99" y="65" textAnchor="middle" fontSize="13" fill="#fff" fontFamily="inherit">{face}</text>
      <rect x="172" y="44" width="34" height="32" rx="8" fill={on('FACE')} />
      <text x="189" y="96" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,.7)">FACE</text>
      <rect x="70" y="9" width="70" height="7" rx="3" fill={on('SIDE')} />
      <text x="105" y="7" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,.7)">SIDE</text>
      <rect x="96" y="104" width="22" height="6" rx="3" fill={on('POWER')} />
      <text x="107" y="120" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,.7)">POWER</text>
    </svg>
  );
}

const BUTTON_OF = { wake: 'FACE', card: 'SIDE', dark: 'FACE', back: 'SIDE', meet: null };
const FACE_OF = { wake: 'READY', card: 'SIDE: NEXT', dark: 'NOT NOW', back: 'HOLD SIDE', meet: '27' };

/**
 * The practice: five steps with the real buttons. Steps 2–4 tick from the relay's view, only from the wrist. Every way
 * out goes through onEnd, which puts the card and NOT NOW back and ends the practice (App.jsx endPractice).
 */
export function Practice({ view, onEnd, onTest }) {
  const [i, setI] = useState(0);
  const [notYet, setNotYet] = useState(false);
  const step = PRACTICE_STEPS[i];
  // Each step is measured from its own start: the snapshot carries the step it was taken for, so the render that moves
  // to a new step never judges it against the last one's.
  const start = useRef({ i: 0, at: snapshot(view) });
  useEffect(() => { start.current = { i, at: snapshot(view) }; setNotYet(false); }, [i]);   // eslint-disable-line react-hooks/exhaustive-deps
  const live = bandLive(view);
  const done = !!step && start.current.i === i && stepDone(step, start.current.at, view);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setI((n) => n + 1), 900);
    return () => clearTimeout(t);
  }, [done]);
  const next = () => setI((n) => n + 1);
  const words = GUIDE.practice;
  if (!step) {
    return (
      <div className="scr guide">
        <Icon name="check_circle" size={40} />
        <h1 className="h1">{words.end.title}</h1>
        <p className="small">{words.end.sub}</p>
        <Cta hue="hi" onClick={() => onEnd('done')}>{words.done}</Cta>
      </div>
    );
  }
  const s = words.steps[step];
  const checked = step === 'card' || step === 'dark' || step === 'back';
  return (
    <div className="scr guide">
      <Back onClick={() => onEnd('back')} />
      <p className="small">{words.sub}</p>
      <h1 className="h1">{(i + 1) + '. ' + s.title}</h1>
      <BandDrawing lit={BUTTON_OF[step]} hue={view?.me?.armed || 'hi'} face={FACE_OF[step]} />
      <p className="body">{s.do}</p>
      <p className="small">{s.back}</p>
      {done && <p className="guide-tick" role="status"><Icon name="check_circle" /> {s.title}</p>}
      {step === 'wake' && (
        <>
          <Cta hue="hi" onClick={next}>{s.yes}</Cta>
          <Ghost onClick={() => setNotYet(true)}>{s.no}</Ghost>
          {notYet && <p className="small">{s.notYet} <button type="button" className="link" onClick={onTest}>TEST THE LIGHT</button></p>}
        </>
      )}
      {checked && !live && <><p className="small">{words.away}</p><Cta hue="hi" onClick={next}>{words.gotIt}</Cta></>}
      {step === 'meet' && <Cta hue="hi" onClick={next}>{words.gotIt}</Cta>}
      <div className="guide-foot">
        {step !== 'meet' ? <button type="button" className="link" onClick={next}>{words.skip}</button> : <span />}
        <button type="button" className="link" onClick={() => onEnd('later')}>{words.later}</button>
      </div>
    </div>
  );
}

/** The page to look things up: six parts, a chip to jump to each, and PRACTISE AGAIN when paired. */
export function BandGuide({ onBack, onPractise }) {
  const speaker = useMemo(() => createSpeaker(), []);
  const play = (name) => { speaker.unlock(); setTimeout(() => speaker.play(name), 30); };
  const jump = (id) => document.getElementById('guide-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const Words = ({ children }) => <span className="band-words">{children}</span>;
  const cell = (s) => s || '—';
  const lead = (t) => (/[.?!]$/.test(t) ? t : t + '.');   // "Not yours?" keeps its own mark
  return (
    <div className="scr guide guide-page">
      <Back onClick={onBack} />
      <h1 className="h1">{GUIDE.page.title}</h1>
      <p className="small">{GUIDE.page.sub}</p>
      <nav className="guide-chips">{GUIDE.parts.map(([id, label]) => <button type="button" key={id} onClick={() => jump(id)}>{label}</button>)}</nav>
      <BandDrawing />
      <section id="guide-start"><h2>START</h2><ol>{GUIDE.start.map(([t, d]) => <li key={t}><b>{lead(t)}</b> {d}</li>)}</ol></section>
      <section id="guide-pair"><h2>PAIR</h2><ol>{GUIDE.pair.map(([t, d]) => <li key={t}><b>{lead(t)}</b> {d}</li>)}</ol></section>
      <section id="guide-buttons">
        <h2>BUTTONS</h2>
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead><tr><th>the wristband shows</th>{GUIDE.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{GUIDE.screens.map((r) => (
              <tr key={r.face.join('|')}>
                <td>{r.face.map((w) => <Words key={w}>{w}</Words>)}</td>
                <td>{cell(r.facePress)}</td><td>{cell(r.faceHold)}</td><td>{cell(r.sidePress)}</td><td>{cell(r.sideHold)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="small">{GUIDE.anyScreen}</p>
      </section>
      <section id="guide-lights">
        <h2>LIGHTS &amp; SOUNDS</h2>
        <ul className="guide-rows">
          {Object.entries(GUIDE.lights.cards).map(([id, says]) => (
            <li key={id}><span className="swatch" style={{ background: HUE[id].c }} />{says}</li>
          ))}
          {GUIDE.lights.rows.map(([what, says]) => <li key={what}><span><b>{what}</b> — {says}</span></li>)}
          {GUIDE_SOUNDS.map((r) => (
            <li key={r.sound}>
              <button type="button" className="guide-play" aria-label={'play ' + r.sound} onClick={() => play(r.sound)}><Icon name="volume_up" /></button>
              <span>{r.says}</span>
            </li>
          ))}
        </ul>
      </section>
      <section id="guide-meeting"><h2>MEETING</h2><ul>{GUIDE.meeting.map((l) => <li key={l}>{l}</li>)}</ul></section>
      <section id="guide-trouble">
        <h2>TROUBLE</h2>
        {GUIDE.trouble.map(([see, why, todo]) => (
          <details key={see}><summary>{see}</summary><p className="small">{why}</p><p className="body">{todo}</p></details>
        ))}
      </section>
      {onPractise && <Cta hue="hi" onClick={onPractise}>{GUIDE.page.again}</Cta>}
    </div>
  );
}
