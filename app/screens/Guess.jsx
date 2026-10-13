import { useEffect, useRef, useState } from 'react';
import { someone } from '../copy.js';
import { CHECK_MS, checking, quizNow, scoreText } from '../lib/guess.js';
import { Back, Icon, More } from '../ui.jsx';

/** One question's options: pick one, or, once answered, see which was right. */
function Options({ options, chosen, result, onChoose }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map((o, i) => {
        const cls = result ? (i === result.answer ? 'opt right' : i === result.choice ? 'opt wrong' : 'opt') : 'opt';
        return (
          <button key={o} type="button" className={cls} aria-pressed={!result && chosen === i} disabled={!!result} onClick={() => onChoose(i)}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** LET'S GUESS — tonight's questions, one at a time. An answer is final, and only the relay knows the right one. */
export function Quiz({ quiz, offline, onBack, onAnswer, onTeams }) {
  const now = quizNow(quiz);
  const answeredN = quiz?.answered?.length ?? 0;
  const [chosen, setChosen] = useState(null);
  const [sent, setSent] = useState(null);    // the question this phone locked, and when
  const [, tick] = useState(0);
  // A locked answer that is never heard of stops being checked after CHECK_MS: draw again then.
  useEffect(() => {
    if (!sent) return undefined;
    const t = setTimeout(() => tick((n) => n + 1), CHECK_MS + 50);
    return () => clearTimeout(t);
  }, [sent]);
  const [review, setReview] = useState(null); // an answered question shown with how it went, until NEXT
  const seen = useRef(answeredN);
  useEffect(() => {
    if (answeredN > seen.current) { setReview(answeredN - 1); setChosen(null); }
    seen.current = answeredN;
  }, [answeredN]);

  if (!now) {
    return (
      <div className="scr">
        <Back onClick={onBack} />
        <div className="empty">
          <span className="h2">No quiz here tonight.</span>
          <span className="body muted">LET'S GUESS needs tonight's questions, and this venue has none.</span>
        </div>
      </div>
    );
  }

  if (review !== null && quiz.answered[review]) {
    const r = quiz.answered[review];
    const last = review + 1 >= now.total;
    return (
      <div className="scr">
        <Back onClick={onBack} />
        <span className="micro" style={{ color: 'var(--guess)', marginTop: 6 }}>question {review + 1} of {now.total}</span>
        <h1 className="h1" style={{ margin: '6px 0 16px' }}>{quiz.questions[review].q}</h1>
        <Options options={quiz.questions[review].options} result={r} />
        <div className="row" role="status" style={{ marginTop: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderColor: r.right ? 'var(--ok)' : 'var(--stop)' }}>
          {r.right ? <Icon name="check_circle" size={19} color="var(--ok)" /> : <Icon name="cancel" size={19} color="var(--stop)" />}
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="h2">{r.right ? 'Right!' : 'Not this one.'}</span>
            {r.fact ? <span className="small">{r.fact}</span> : null}
          </span>
        </div>
        <div style={{ marginTop: 'auto', padding: '16px 0 20px' }}>
          {last
            ? <button type="button" className="cta" style={{ '--c': 'var(--guess)' }} onClick={onTeams}>FIND A TEAMMATE · {scoreText(now.score)}</button>
            : <button type="button" className="cta" style={{ '--c': 'var(--guess)' }} onClick={() => setReview(null)}>NEXT QUESTION</button>}
        </div>
      </div>
    );
  }

  if (now.done) {
    return (
      <div className="scr">
        <Back onClick={onBack} />
        <h1 className="h1" style={{ margin: '6px 0 8px' }}>You got {scoreText(now.score)}.</h1>
        <span className="body muted">Now find a teammate: someone else here who finished. Nobody sees your answers, only your score.</span>
      </div>
    );
  }

  const waiting = checking(sent, quiz, Date.now(), offline);
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <span className="micro" style={{ color: 'var(--guess)', marginTop: 6 }}>question {now.index + 1} of {now.total}</span>
      <h1 className="h1" style={{ margin: '6px 0 16px' }}>{now.current.q}</h1>
      <Options options={now.current.options} chosen={chosen} onChoose={(i) => !waiting && setChosen(i)} />
      <div style={{ marginTop: 'auto', padding: '16px 0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {waiting ? <span className="small" role="status">{offline ? 'Saved. It’ll check when you’re back.' : 'Checking…'}</span> : null}
        <button type="button" className="cta" style={{ '--c': 'var(--guess)' }} disabled={chosen === null || waiting}
          onClick={() => { setSent({ index: now.index, at: Date.now() }); onAnswer(now.index, chosen); }}>
          LOCK IT IN
        </button>
        <span className="small">nobody sees your answers. only your score, once you finish.</span>
      </div>
    </div>
  );
}

/** LET'S GUESS's list — people who finished and want a teammate, by score. Team up, and if they team up back, you meet. */
export function Teams({ teams, score, onBack, onTeam, onMore }) {
  const [pending, setPending] = useState({});
  useEffect(() => setPending({}), [teams]);
  const asked = (t) => !!(pending[t.handle] || t.asked);
  return (
    <div className="scr">
      <Back onClick={onBack} />
      <h1 className="h1" style={{ margin: '6px 0 4px' }}>Find a teammate</h1>
      <span className="small" style={{ marginBottom: 12 }}>
        {score ? 'you got ' + scoreText(score) + '. ' : ''}a team-up both ways is a match — then a name, and where to meet.
      </span>
      <div className="scroll">
        {teams.length === 0 ? (
          <div className="empty">
            <span className="h2">Nobody else has finished yet.</span>
            <span className="body muted">Stay armed and they'll show up here.</span>
          </div>
        ) : null}
        {teams.map((t) => {
          const on = asked(t);
          return (
            <div key={t.handle} className="row" style={{ gap: 9, borderColor: on ? 'var(--guess)' : undefined }}>
              <div className="person" style={{ gap: 9 }}>
                <Icon name="quiz" size={19} color="var(--guess)" />
                <span className="h2" style={{ flex: 1, minWidth: 0 }}>{scoreText(t.score)}</span>
                <More className="more" onClick={() => onMore(t.handle, someone(t.band))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingRight: 6 }}>
                <span className="small">{on ? 'You asked to team up' : someone(t.band)}</span>
                <button type="button" className="btn-s" aria-pressed={on} disabled={on}
                  onClick={() => { setPending((p) => ({ ...p, [t.handle]: true })); onTeam(t.handle); }}
                  style={{ margin: '-6px 0', '--c': on ? 'var(--guess)' : 'var(--line)', '--f': on ? 'var(--guess)' : '#fff' }}>
                  {on ? 'ASKED' : 'TEAM UP?'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
