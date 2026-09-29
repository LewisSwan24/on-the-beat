#!/usr/bin/env python3
# ON THE BEAT — the venue walk, as numbers instead of impressions.
#
# One wristband, carried through the venue while the markers stand where they
# would on the night. Every few seconds this types `near` at the band's
# console and records what its last listen heard — the other bands and the
# markers, each with its dBm — plus anything the walker types here to say
# where they are ("at the bar", "under the balcony"). At the end it writes a
# CSV, a JSONL of the raw samples and one self-contained HTML page: a curve
# per source over time, against the two lines the relay actually uses
# (relay/room.js): a marker names its area at MARK_FLOOR (-56 dBm) or louder,
# and the name holds while the marker is at MARK_HOLD_FLOOR (-60 dBm) or
# louder and no other is 4 dB louder. So the walk says, per spot: does the
# marker that should name it clear -56 there, and does the wrong one stay
# under -60?
#
# Usage (PlatformIO's python is the one with pyserial):
#   C:\Users\<you>\.platformio\penv\Scripts\python.exe ^
#     scripts\venue-walk.py COM9 10 --out walks
#   ...then walk, and type a line here at each spot you reach. `quit` ends
#   the walk early; the outputs are written either way.
#
# The band only listens once every 10 s (HEAR_EVERY_MS, band_logic.h), so the
# default sample every 5 s sees each listen about twice; a sample whose listen
# is the one already recorded is dropped. --fake exercises the whole pipeline
# with generated snapshots and needs no band and no pyserial.

import argparse
import csv
import json
import math
import os
import random
import re
import sys
import threading
import time
from datetime import datetime

MARK_FLOOR = -56       # a marker at or above this names its area (relay/room.js)
MARK_HOLD_FLOOR = -60  # the name holds at or above this (floor minus the 4 dB hold)

RE_STATE = re.compile(r'^near\s+(.*?);\s+on the air as\s+([0-9a-f]{12});\s+(\d+)\s+beacons sent,\s+(\d+)\s+refused')
RE_NOLISTEN = re.compile(r'^\s+no listen yet\s*$')
RE_LISTEN = re.compile(r'^\s+last listen\s+(\d+)\s+s ago,\s+channel\s+(\d+):\s+(heard.*)$')
RE_HEARD = re.compile(r'^\s+([0-9a-f]{12})\s+(-?\d+)\s+dBm\s*$')
RE_MARK = re.compile(r'^\s+marker\s+(\w+)\s+(-?\d+)\s+dBm\s*$')

PALETTE = ['#e4572e', '#2e86ab', '#7b9e3f', '#a24bd6', '#d6a24b', '#4bd6c8',
           '#d64b8f', '#6f7bd6', '#b5d64b', '#d66f4b']


class Snapshot:
    """One `near` answer, parsed: the state, the listen it shows, and what it heard."""

    def __init__(self, at):
        self.at = at            # epoch seconds, when the sample was taken
        self.state = ''         # "beaconing and listening", or why not
        self.air = ''           # the band's own radio address
        self.ago = None         # "last listen N s ago"; None until one arrives
        self.channel = None
        self.heard = []         # [(air12, rssi), ...] strongest first, at most five
        self.marks = []         # [(area, rssi), ...]
        self.other = []         # console lines that were not part of a near answer

    @property
    def listen_at(self):
        return None if self.ago is None else int(self.at) - self.ago

    def key(self):
        """The same listen, sampled twice: same second, same content."""
        return (self.listen_at, tuple(self.heard), tuple(self.marks))

    def empty(self):
        return self.ago is None


def feed(snap, line):
    """Add one console line to the snapshot being assembled. True if it belonged."""
    m = RE_STATE.match(line)
    if m:
        snap.state, snap.air = m.group(1).strip(), m.group(2)
        return True
    if RE_NOLISTEN.match(line):
        return True
    m = RE_LISTEN.match(line)
    if m:
        snap.ago, snap.channel = int(m.group(1)), int(m.group(2))
        return True
    m = RE_HEARD.match(line)
    if m:
        snap.heard.append((m.group(1), int(m.group(2))))
        return True
    m = RE_MARK.match(line)
    if m:
        snap.marks.append((m.group(1), int(m.group(2))))
        return True
    if line:
        snap.other.append(line)
    return False


class BandConsole:
    """The band's serial console: a reader thread keeps every line; near() asks one."""

    def __init__(self, port, baud=115200):
        import serial  # only a real band needs pyserial
        self.ser = serial.Serial()
        self.ser.port = port
        self.ser.baudrate = baud
        self.ser.timeout = 0.2
        self.ser.dtr = False   # set before open: the band must not be reset by the port
        self.ser.rts = False
        self.ser.open()
        self.lines = []        # [(t, text)] not yet taken by near()
        self.lock = threading.Lock()
        self.alive = True
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        while self.alive:
            try:
                raw = self.ser.readline()
            except OSError:
                break
            if raw:
                text = raw.decode('utf-8', 'replace').strip()
                with self.lock:
                    self.lines.append((time.time(), text))

    def take(self):
        with self.lock:
            out, self.lines = self.lines, []
        return out

    def near(self, settle=0.8, cap=4.0):
        """Type `near`, then collect lines until the answer has been quiet for settle."""
        self.take()                       # whatever the console said on its own
        self.ser.write(b'near\n')
        snap = Snapshot(time.time())
        t0, last = time.time(), time.time()
        got_any = False
        while time.time() - t0 < cap:
            time.sleep(0.05)
            for _, text in self.take():
                feed(snap, text)
                got_any = True
                last = time.time()
            if got_any and time.time() - last > settle:
                break
        return snap

    def close(self):
        self.alive = False
        try:
            self.ser.close()
        except OSError:
            pass


class FakeConsole:
    """--fake: the console of a band on a generated floor, printing exactly the
    lines reportNear() in firmware/src/main.cpp prints — the state line, the
    last-listen line, one line per band and per marker heard — plus the odd
    `on the wi-fi` a real console mixes in between answers. Every line goes
    through feed(), the parser a real band's bytes go through, so the fake
    holds the parser too. Like a real band it repeats its last listen until
    the next one ends (every 10 s there, every WINDOW_S here), which is the
    duplicate the walk drops."""

    WINDOW_S = 3

    def __init__(self, seed=7):
        self.rng = random.Random(seed)
        self.t0 = time.time()
        self.bands = [('aa11bb22cc33', -49), ('dd44ee55ff66', -63), ('0123456789ab', -71)]
        self.marks = [('bar', -54), ('stage', -62)]
        self.window = -1
        self.content = ([], [])

    def _listen(self, t):
        """What one listen caught: three bands and two markers, drifting dBm, dropouts."""
        heard = []
        for air, base in self.bands:
            if self.rng.random() < 0.12:
                continue                      # a listen hears nobody it is not near
            rssi = base + 6 * math.sin(t / 9.0 + self.rng.random()) + self.rng.uniform(-2, 2)
            heard.append((air, int(max(-95, min(-35, round(rssi))))))
        marks = []
        for area, base in self.marks:
            if self.rng.random() < 0.08:
                continue
            rssi = base + 5 * math.sin(t / 14.0 + (0 if area == 'bar' else 2)) + self.rng.uniform(-2, 2)
            marks.append((area, int(max(-95, min(-35, round(rssi))))))
        heard.sort(key=lambda x: -x[1])
        return heard, marks

    def near(self, settle=0.8, cap=4.0):
        t = time.time() - self.t0
        w = int(t // self.WINDOW_S)
        if w != self.window:
            self.window = w
            self.content = self._listen(t)
        heard, marks = self.content
        ago = int(t - w * self.WINDOW_S)
        lines = ['near    beaconing and listening; on the air as ffffeeddcccc; %d beacons sent, 0 refused' % (130 + w)]
        if heard or marks:
            lines.append('        last listen %d s ago, channel 11: heard' % ago)
            lines += ['        %s  %d dBm' % hm for hm in heard]
            lines += ['        marker %s  %d dBm' % mm for mm in marks]
        else:
            lines.append('        last listen %d s ago, channel 11: heard nobody' % ago)
        lines.append('on the wi-fi')          # chatter between answers, as on a real console
        snap = Snapshot(time.time())
        for line in lines:
            feed(snap, line)
        time.sleep(0.05)
        return snap

    def close(self):
        pass


class Walker:
    """What the walker types on this keyboard: a label for where they now are."""

    def __init__(self):
        self.notes = []       # [(t, text)]
        self.label = ''
        self.quit = False
        self.lock = threading.Lock()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in sys.stdin:
            text = line.strip()
            if not text:
                continue
            with self.lock:
                if text.lower() in ('quit', 'q', 'exit'):
                    self.quit = True
                    return
                self.notes.append((time.time(), text))
                self.label = text

    def at(self, t):
        with self.lock:
            notes = list(self.notes)
        return notes

    def label_at(self, t):
        with self.lock:
            cur = ''
            for nt, text in self.notes:
                if nt <= t:
                    cur = text
            return cur


def median(xs):
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return None
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


class Walk:
    """The samples of one walk, and the files they become."""

    def __init__(self, walker, fake=False):
        self.walker = walker
        self.fake = fake
        self.t0 = time.time()
        self.samples = []     # kept Snapshots, one per fresh listen
        self.dupe = 0         # samples dropped as the same listen again
        self.last_key = None

    def record(self, snap):
        if snap.empty():
            if snap.state:
                print('  [state] ' + snap.state)
            return
        key = snap.key()
        if key == self.last_key:
            self.dupe += 1
            return
        self.last_key = key
        snap.label = self.walker.label_at(snap.at)
        self.samples.append(snap)
        heard = ' '.join('%s@%d' % (a[:6], r) for a, r in snap.heard) or 'nobody'
        marks = ' '.join('%s@%d' % (m, r) for m, r in snap.marks) or '-'
        print('  [%6.1fs] ch%-2d %s | marks %s | %s' % (
            snap.at - self.t0, snap.channel or 0, heard, marks, snap.label or ''))

    def series(self):
        """Per source, its points over the walk: {who: [(t_s, rssi)]}, markers first."""
        out = {}
        for s in self.samples:
            for area, rssi in s.marks:
                out.setdefault('marker ' + area, []).append((s.at - self.t0, rssi))
            for air, rssi in s.heard:
                out.setdefault(air, []).append((s.at - self.t0, rssi))
        marks = {k: v for k, v in out.items() if k.startswith('marker ')}
        bands = {k: v for k, v in out.items() if not k.startswith('marker ')}
        marks.update(bands)
        return marks

    def stats(self):
        rows = []
        for who, pts in self.series().items():
            rs = [r for _, r in pts]
            rows.append({
                'who': who, 'n': len(rs), 'min': min(rs), 'med': median(rs), 'max': max(rs),
                'pct_floor': round(100.0 * sum(1 for r in rs if r >= MARK_FLOOR) / len(rs)),
                'pct_hold': round(100.0 * sum(1 for r in rs if r >= MARK_HOLD_FLOOR) / len(rs)),
            })
        return rows

    def write_jsonl(self, path):
        with open(path, 'w', encoding='utf-8') as f:
            for s in self.samples:
                f.write(json.dumps({
                    't': round(s.at - self.t0, 2),
                    'clock': datetime.fromtimestamp(s.at).strftime('%H:%M:%S'),
                    'state': s.state, 'air': s.air, 'ago': s.ago, 'channel': s.channel,
                    'heard': s.heard, 'marks': s.marks, 'label': getattr(s, 'label', ''),
                }) + '\n')

    def write_csv(self, path):
        with open(path, 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f, lineterminator='\n')   # LF everywhere, like the rest of the repo
            w.writerow(['t_s', 'clock', 'label', 'kind', 'who', 'rssi_dbm', 'channel', 'state'])
            for s in self.samples:
                clock = datetime.fromtimestamp(s.at).strftime('%H:%M:%S')
                label = getattr(s, 'label', '')
                for area, rssi in s.marks:
                    w.writerow(['%.2f' % (s.at - self.t0), clock, label, 'marker', area, rssi, s.channel, s.state])
                for air, rssi in s.heard:
                    w.writerow(['%.2f' % (s.at - self.t0), clock, label, 'band', air, rssi, s.channel, s.state])

    def write_html(self, path, notes):
        series = self.series()
        dur = max(1.0, (self.samples[-1].at - self.t0) if self.samples else 1.0)
        W, H = 960, 420
        L, R, T, B = 56, 16, 28, 40
        pw, ph = W - L - R, H - T - B
        ymin, ymax = -100.0, -30.0

        def X(t):
            return L + pw * (t / dur)

        def Y(v):
            return T + ph * ((ymax - v) / (ymax - ymin))

        esc = lambda s: (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
        parts = ['<svg width="%d" height="%d" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">' % (W, H),
                 '<rect width="%d" height="%d" fill="#fff"/>' % (W, H)]
        # grid, y axis every 10 dBm
        v = int(ymin)
        while v <= ymax:
            parts.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#eee"/>' % (L, Y(v), W - R, Y(v)))
            parts.append('<text x="%d" y="%.1f" font-size="11" fill="#666" text-anchor="end">%d</text>' % (L - 6, Y(v) + 4, v))
            v += 10
        # x grid: about eight ticks
        step = max(1, int(math.ceil(dur / 8.0 / 5.0)) * 5) if dur > 40 else max(1, int(math.ceil(dur / 8.0)))
        t = 0
        while t <= dur:
            parts.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="#f4f4f4"/>' % (X(t), T, X(t), H - B))
            parts.append('<text x="%.1f" y="%d" font-size="11" fill="#666" text-anchor="middle">%ds</text>' % (X(t), H - B + 16, t))
            t += step
        # the two lines the relay uses
        for level, name, color in ((MARK_FLOOR, 'names the area (-56)', '#c0392b'), (MARK_HOLD_FLOOR, 'holds it (-60)', '#e67e22')):
            parts.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="%s" stroke-dasharray="6 4"/>' % (L, Y(level), W - R, Y(level), color))
            parts.append('<text x="%d" y="%.1f" font-size="11" fill="%s">%s</text>' % (L + 4, Y(level) - 4, color, esc(name)))
        # annotations: where the walker said they were
        for nt, text in notes:
            x = X(nt - self.t0)
            parts.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="#bbb" stroke-dasharray="2 3"/>' % (x, T, x, H - B))
            parts.append('<text x="%.1f" y="%d" font-size="11" fill="#777" transform="rotate(-90 %.1f %d)">%s</text>'
                         % (x - 3, T + ph, x - 3, T + ph, esc(text)))
        # a curve per source, markers first (series() puts them first)
        legend = []
        for i, (who, pts) in enumerate(series.items()):
            color = PALETTE[i % len(PALETTE)]
            pts = sorted(pts)
            dots = ' '.join('%.1f,%.1f' % (X(a), Y(b)) for a, b in pts)
            parts.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="1.6"/>' % (dots, color))
            legend.append((who, color))
        parts.append('</svg>')
        svg = '\n'.join(parts)

        rows = []
        for i, st in enumerate(self.stats()):
            color = PALETTE[i % len(PALETTE)]
            rows.append('<tr><td><span class="sw" style="background:%s"></span>%s</td><td>%d</td><td>%d</td>'
                        '<td>%s</td><td>%d</td><td>%d%%</td><td>%d%%</td></tr>'
                        % (color, esc(st['who']), st['n'], st['min'], st['med'], st['max'], st['pct_floor'], st['pct_hold']))
        html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>%s</title>
<style>
 body{font-family:system-ui,sans-serif;margin:24px;color:#222}
 table{border-collapse:collapse;margin-top:16px;font-size:14px}
 td,th{border-bottom:1px solid #eee;padding:4px 10px;text-align:right}
 td:first-child,th:first-child{text-align:left}
 .sw{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;vertical-align:-1px}
 p.note{color:#666;font-size:13px;max-width:960px}
</style></head><body>
<h2>%s</h2>
%s
<table><tr><th>source</th><th>n</th><th>min</th><th>median</th><th>max</th><th>&ge; -56 (names)</th><th>&ge; -60 (holds)</th></tr>
%s
</table>
<p class="note">A marker names its area on a person's row when the relay's median of the last
30 s of that person's band's readings is -56 dBm or louder; the name holds while the marker
is -60 or louder and no other marker is 4 dB louder (relay/room.js). Curves are the raw
per-listen readings of one band, not the relay's median. %d listens kept, %d duplicate
samples dropped, walk %ds.</p>
</body></html>
""" % (esc(self.title), esc(self.title), svg, '\n'.join(rows), len(self.samples), self.dupe, int(dur))
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html)


def main(argv=None):
    ap = argparse.ArgumentParser(description='Record what one wristband hears over a venue walk, and draw it.')
    ap.add_argument('port', nargs='?', help='the band\'s console, e.g. COM9 (not needed with --fake)')
    ap.add_argument('minutes', nargs='?', type=float, default=10.0, help='how long to walk (default 10)')
    ap.add_argument('--every', type=float, default=5.0, help='seconds between `near` samples (default 5; the band listens once every 10)')
    ap.add_argument('--secs', type=float, help='walk this many seconds instead of minutes (tests)')
    ap.add_argument('--out', default='.', help='directory for walk-<stamp>.{csv,jsonl,html}')
    ap.add_argument('--fake', action='store_true', help='generated snapshots: exercises the pipeline with no band')
    ap.add_argument('--seed', type=int, default=7, help='--fake seed')
    a = ap.parse_args(argv)
    if not a.fake and not a.port:
        ap.error('a console port is needed unless --fake')
    dur = a.secs if a.secs else a.minutes * 60.0

    console = FakeConsole(a.seed) if a.fake else BandConsole(a.port)
    walker = Walker()
    walk = Walk(walker, fake=a.fake)
    print(('fake walk' if a.fake else 'walk on ' + a.port) +
          ': %.0f s, a sample every %.0f s.' % (dur, a.every))
    print('type a line to say where you are ("at the bar"); `quit` ends the walk early.')

    noted = False
    deadline = time.time() + dur
    try:
        while time.time() < deadline and not walker.quit:
            t = time.time()
            snap = console.near()
            if a.fake and not noted and t - walk.t0 > dur * 0.4:
                noted = True
                note = (t, 'at the bar (fake)')
                with walker.lock:
                    walker.notes.append(note)
                    walker.label = note[1]
            walk.record(snap)
            left = a.every - (time.time() - t)
            if left > 0:
                time.sleep(left)
    except KeyboardInterrupt:
        print('\nended by hand')
    finally:
        console.close()

    air = next((s.air for s in walk.samples if s.air), 'unknown')
    walk.title = 'Venue walk %s%s - band %s' % (
        datetime.now().strftime('%Y-%m-%d %H:%M'), ' (fake)' if a.fake else '', air)
    os.makedirs(a.out, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    base = os.path.join(a.out, 'walk-' + stamp)
    walk.write_jsonl(base + '.jsonl')
    walk.write_csv(base + '.csv')
    walk.write_html(base + '.html', walker.at(time.time()))

    print('\n%s' % walk.title)
    print('%d listens kept, %d duplicate samples dropped, %d notes.' % (
        len(walk.samples), walk.dupe, len(walker.notes)))
    if walk.samples:
        print('%-16s %4s %5s %7s %5s %8s %8s' % ('source', 'n', 'min', 'median', 'max', '>=-56', '>=-60'))
        for st in walk.stats():
            print('%-16s %4d %5d %7s %5d %7d%% %7d%%' % (
                st['who'][:16], st['n'], st['min'], st['med'], st['max'], st['pct_floor'], st['pct_hold']))
    else:
        print('nothing was heard: check the band is paired and near-listening (`near` says why not).')
    for ext in ('.jsonl', '.csv', '.html'):
        print('wrote ' + base + ext)
    return 0


if __name__ == '__main__':
    sys.exit(main())
