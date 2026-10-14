import { useEffect, useMemo, useState } from 'react';
import { CARDS } from '../../relay/cards.js';
import { POSTER } from '../copy.js';
import { phaseLine } from '../lib/phase.js';
import { qrMatrix, qrPath } from '../lib/qr.js';
import { hereLine, posterTimes, venueFromPath } from './live.js';

const EVERY_MS = 20_000;   // the relay is asked this often; the phase line moves with the clock in between

/** The code into the app: this site's own address, so a poster on the relay's origin always points at its own app. */
function Code({ at }) {
  const qr = useMemo(() => qrMatrix(at), [at]);
  if (!qr) return null;
  const box = qr.size + 8;
  return (
    <svg className="pqr" viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label={'QR code for ' + at}>
      <rect width={box} height={box} fill="#fff" />
      <path d={qrPath(qr)} fill="#000" />
    </svg>
  );
}

/** Tonight at this venue, as the relay last said: the act, the phase, how many play, the times. */
function Tonight({ show, offline, now }) {
  const times = posterTimes(show);
  const here = hereLine(show.here);
  return (
    <section className="ptonight" aria-live="polite">
      <span className="label">{POSTER.tonight}{offline ? ' · ' + POSTER.offline : ''}</span>
      {show.act ? <span className="pact">{show.act}</span> : null}
      {show.venue ? <span className="lede">{show.venue}</span> : null}
      <span className="pphase">{phaseLine(show, now)}</span>
      {here ? <span className="phere"><span className="pdot-live" aria-hidden="true" />{here}</span> : null}
      {times.length ? (
        <div className="ptimes">
          {times.map(([label, t]) => (
            <span key={label} className="ptime"><span className="micro">{label}</span><span className="tnum">{t}</span></span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** No venue in the address, or one the relay does not list: tonight's venues, each a link to its own poster. */
function Pick({ shows, unknown }) {
  return (
    <section className="ptonight">
      <span className="label">{unknown ? POSTER.unknown : POSTER.pick}</span>
      <div className="ppick">
        {shows.map((s) => (
          <a key={s.id} href={'/poster/' + encodeURIComponent(s.id)} className="ppick-row">
            <span className="h2">{s.act || s.venue}</span>
            <span className="small">{s.venue}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function Poster() {
  const venue = venueFromPath(location.pathname);
  const at = location.origin + '/';
  const [show, setShow] = useState(null);
  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [shows, setShows] = useState([]);
  const [now, setNow] = useState(() => new Date());

  // Tonight, from the relay, every EVERY_MS. A failed ask keeps what was last said and says it is reconnecting.
  useEffect(() => {
    if (!venue) return undefined;
    let gone = false;
    const ask = async () => {
      try {
        const res = await fetch('/api/poster?v=' + encodeURIComponent(venue), { signal: AbortSignal.timeout(8000) });
        if (gone) return;
        if (res.status === 404) { setMissing(true); setOffline(false); return; }
        if (!res.ok) throw new Error('status ' + res.status);
        const next = await res.json();
        if (gone) return;
        setShow(next);
        setMissing(false);
        setOffline(false);
      } catch {
        if (!gone) setOffline(true);
      }
    };
    ask();
    const t = setInterval(ask, EVERY_MS);
    return () => { gone = true; clearInterval(t); };
  }, [venue]);

  // With no venue, or one not listed: tonight's list to choose from.
  useEffect(() => {
    if (venue && !missing) return;
    fetch('/api/shows').then((r) => r.json()).then((list) => setShows(Array.isArray(list) ? list : [])).catch(() => {});
  }, [venue, missing]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.title = (show?.act ? show.act + ' · ' : '') + 'On The Beat';
  }, [show?.act]);

  return (
    <main className="poster">
      <span className="glow" aria-hidden="true" style={{ background: 'radial-gradient(circle,#0C9DE2 0%,rgba(12,157,226,0) 68%)', left: '-6%', top: '-4%' }} />
      <span className="glow" aria-hidden="true" style={{ background: 'radial-gradient(circle,#C79A1E 0%,rgba(199,154,30,0) 68%)', right: '-8%', top: '18%' }} />
      <span className="glow" aria-hidden="true" style={{ background: 'radial-gradient(circle,#A93FD9 0%,rgba(169,63,217,0) 68%)', left: '22%', top: '46%' }} />

      <section className="phead">
        <h1 className="ptitle">{POSTER.title}</h1>
        <span className="ptag">{POSTER.tag}</span>
      </section>

      <section className="pbody">
        <ol className="psteps">
          {POSTER.steps.map((s) => (
            <li key={s.n} className="pstep">
              <span className="pn" aria-hidden="true">{s.n}</span>
              <span className="pstep-text">
                <span className="h2">{s.head}</span>
                <span className="small">{s.sub}</span>
                {s.n === '2' ? (
                  <span className="pcards">
                    {CARDS.map((c) => (
                      <span key={c.id} className="pcard" style={{ '--c': c.c, '--g': c.g }}>
                        <span className="pcard-name">{c.band}</span>
                        <span className="pcard-sub">{POSTER.cards[c.id]}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        <div className="pscan">
          <Code at={at} />
          <span className="pscan-word">{POSTER.scan}</span>
          <span className="small tnum">{location.host}</span>
        </div>
      </section>

      <section className="pnotes">
        <span className="small">{POSTER.band}</span>
        <span className="small">{POSTER.quiet}</span>
      </section>

      {venue && show && !missing ? <Tonight show={show} offline={offline} now={now} /> : null}
      {!venue || missing ? <Pick shows={shows} unknown={missing} /> : null}
    </main>
  );
}
