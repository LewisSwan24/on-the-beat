// ON THE BEAT — the wristband guide (docs/superpowers/specs/2026-10-13-wristband-guide-design.md): the practice after a
// first pairing, and the page to look things up. Every word is in app/copy.js (GUIDE).

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { GUIDE, HUE } from '../copy.js';
import { GUIDE_SOUNDS, PRACTICE_STEPS, bandLive, snapshot, stepDone, usualKeys } from '../lib/guide.js';
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
      <div className="guide-top">
        <Back onClick={() => onEnd('back')} />
        <button type="button" className="guide-leave" onClick={() => onEnd('later')}>{words.leave}</button>
      </div>
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
      {step !== 'meet' && <div className="guide-foot"><button type="button" className="link" onClick={next}>{words.skip}</button></div>}
    </div>
  );
}

/**
 * One screen of the wristband as the guide shows it: one dark face, its big word first, the rest after a slash.
 * A word in lower case is not on the screen but says what is there ("your card", "a number").
 */
function MiniFace({ words }) {
  return (
    <span className="mini-face">{words.map((w, i) => (
      <Fragment key={w}>
        {i > 0 && <span className="mini-sep" aria-hidden="true">/</span>}
        <span className={/^[a-z]/.test(w) ? 'mini-hint' : i === 0 ? 'mini-big' : 'mini-small'}>{w}</span>
      </Fragment>
    ))}</span>
  );
}

/** One part of the guide page, folded to its title until it is tapped. */
function Part({ id, children }) {
  const label = GUIDE.parts.find(([p]) => p === id)[1];
  return <details id={'guide-' + id} className="guide-part"><summary>{label}</summary>{children}</details>;
}

/** The page to look things up: six parts, a chip to jump to each, and PRACTISE AGAIN when paired. */
export function BandGuide({ onBack, onPractise }) {
  const speaker = useMemo(() => createSpeaker(), []);
  const play = (name) => { speaker.unlock(); setTimeout(() => speaker.play(name), 30); };
  const lead = (t) => (/[.?!]$/.test(t) ? t : t + '.');   // "Not yours?" keeps its own mark
  return (
    <div className="scr guide guide-page">
      <Back onClick={onBack} />
      <h1 className="h1">{GUIDE.page.title}</h1>
      <p className="small">{GUIDE.page.sub}</p>
      <BandDrawing />
      <div className="guide-essentials">
        <h2>{GUIDE.essentials.title}</h2>
        {GUIDE.essentials.groups.map((g) => (
          <div key={g.title}>
            <h3>{g.title}</h3>
            <dl className="guide-keys">{g.rows.map((r) => (
              <Fragment key={r.says}>
                <dt>{r.keys.map((k) => <span key={k} className="key-name">{k}</span>)}</dt>
                <dd>{r.on && <MiniFace words={r.on} />}{r.says}</dd>
              </Fragment>
            ))}</dl>
          </div>
        ))}
      </div>
      <Part id="start"><ol>{GUIDE.start.map(([t, d]) => <li key={t}><b>{lead(t)}</b> {d}</li>)}</ol></Part>
      <Part id="pair"><ol>{GUIDE.pair.map(([t, d]) => <li key={t}><b>{lead(t)}</b> {d}</li>)}</ol></Part>
      <Part id="buttons">
        <div className="guide-usual"><p>{GUIDE.usual}</p><p>{GUIDE.anyScreen}</p></div>
        {GUIDE.groups.map(([id, title, open]) => (
          <details key={id} className="guide-group" open={!!open}>
            <summary>{title}</summary>
            {GUIDE.screens.filter((r) => r.group === id).map((r) => {
              const keys = usualKeys(r);
              const quiet = keys.length === 1 && !keys[0][0];   // nothing of its own: said beside the screen, not under it
              return (
                <div key={r.face.join('|')} className={'guide-row' + (quiet ? ' quiet' : '')}>
                  <MiniFace words={r.face} />
                  {quiet ? <span className="guide-none">{keys[0][1]}</span> : (
                    <dl className="guide-keys">{keys.map(([k, d]) => (
                      <Fragment key={k + d}><dt>{k.split(' / ').map((n) => <span key={n} className="key-name">{n}</span>)}</dt><dd>{d}</dd></Fragment>
                    ))}</dl>
                  )}
                </div>
              );
            })}
          </details>
        ))}
      </Part>
      <Part id="lights">
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
      </Part>
      <Part id="meeting"><ul>{GUIDE.meeting.map((l) => <li key={l}>{l}</li>)}</ul></Part>
      <Part id="trouble">
        {GUIDE.trouble.map(([see, why, todo]) => (
          <details key={see}><summary>{see}</summary><p className="small">{why}</p><p className="body">{todo}</p></details>
        ))}
      </Part>
      {onPractise && <Cta hue="hi" onClick={onPractise}>{GUIDE.page.again}</Cta>}
    </div>
  );
}
