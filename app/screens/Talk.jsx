import { useEffect, useState } from 'react';
import { HUE, TALK } from '../copy.js';
import { holdScreen, reducedMotion } from '../lib/device.js';
import { NOTE_MAX } from '../lib/talk.js';
import { hhmm } from '../lib/phase.js';

/** Between MEET and FOUND: a few words to the people you met about where you are — a ready line, or your own. */
export function Talk({ talk, hue, onSend }) {
  const [text, setText] = useState('');
  const send = (said) => {
    const t = said.trim();
    if (!t) return;
    onSend(t.slice(0, NOTE_MAX));
    setText('');
  };
  return (
    <section className="talk" style={{ '--c': (HUE[hue] || HUE.hi).c }} aria-label={TALK.title}>
      <div className="h2">{TALK.title}</div>
      <div className="small" style={{ marginTop: 2 }}>{TALK.sub}</div>
      {talk.notes.length ? (
        <ol className="notes" aria-live="polite">
          {talk.notes.map((n) => (
            <li key={n.at + n.text} className={n.mine ? 'mine' : ''}>
              <span className="micro">{n.mine ? TALK.you : n.name} · {hhmm(n.at)}</span>
              <span className="body">{n.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="ready">
        {TALK.ready.map((line) => (
          <button key={line} type="button" className="chip" onClick={() => send(line)}>{line}</button>
        ))}
      </div>
      <form className="say" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <div className="field">
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX))} maxLength={NOTE_MAX}
            placeholder={TALK.placeholder} aria-label={TALK.placeholder} enterKeyHint="send" />
        </div>
        <button type="submit" className="send" disabled={!text.trim()}>{TALK.send}</button>
      </form>
    </section>
  );
}

/** The number, as big as the phone can show it, in the card's colour: held up over a crowd. */
export function HoldUp({ number, hue, onClose }) {
  useEffect(() => holdScreen(), []);
  const h = HUE[hue] || HUE.hi;
  return (
    <button type="button" className={'holdup' + (reducedMotion() ? '' : ' pulse')} onClick={onClose}
      style={{ '--c': h.c, '--g': h.g }} aria-label={'Meeting number ' + number + '. ' + TALK.holdUpSub}>
      <span className="n tnum">{number}</span>
      <span className="micro">{TALK.holdUpSub}</span>
    </button>
  );
}
