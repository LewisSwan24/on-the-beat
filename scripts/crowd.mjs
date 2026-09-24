// A demo crowd: a few people who are not people, for showing the app with one
// phone. Operator-only — nothing in the app starts this, and every one of them
// says "demo" in their name, so a match with one can never pass for a real one.
//
//   node scripts/crowd.mjs [venue] [how many] [relay]
//   node scripts/crowd.mjs roundhouse-bruno-mars 3 ws://localhost:8790
//
// Each of them shows blue, picks a track, waves back at anyone who waves, likes
// every pick on the wall (so liking theirs back makes a match), and keeps
// anyone they match with. They never dance: a clip would be made up.

import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const [venue = 'roundhouse-bruno-mars', count = '3', relay = 'ws://localhost:8790'] = process.argv.slice(2);
const NAMES = ['Mia', 'Jo', 'Sam', 'Priya', 'Tom', 'Ade'];
const TRACKS = ['Treasure', '24K Magic', 'Grenade', "That's What I Like", 'Just the Way You Are', 'Locked Out of Heaven'];

function person(i) {
  const name = NAMES[i % NAMES.length] + ' · demo';
  const me = randomBytes(16).toString('hex');
  const done = new Set();
  let ws;

  const later = (fn) => setTimeout(fn, 1200 + Math.random() * 1800);
  const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  function open() {
    ws = new WebSocket(relay + '/api/ws');
    ws.on('open', () => {
      send({ t: 'join', venue, me });
      send({ t: 'profile', name, contact: 'demo only — not a real person' });
      send({ t: 'arm', intent: 'hi' });
      send({ t: 'pick', track: TRACKS[i % TRACKS.length] });
      console.log(name, 'is in', venue);
    });
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t !== 'view') return;
      for (const p of m.view.near) {
        if (p.wavedAtYou && !p.waved && !done.has('w' + p.handle)) {
          done.add('w' + p.handle);
          later(() => { send({ t: 'wave', handle: p.handle }); console.log(name, 'waved back'); });
        }
      }
      for (const w of m.view.wall) {
        if (!w.liked && !done.has('l' + w.handle + w.pick)) {
          done.add('l' + w.handle + w.pick);
          later(() => send({ t: 'like', handle: w.handle }));
        }
      }
      for (const x of m.view.matches) {
        if (!x.kept && !done.has('k' + x.id)) {
          done.add('k' + x.id);
          later(() => { send({ t: 'keep', match: x.id, on: true }); console.log(name, 'matched and kept', x.id); });
        }
      }
    });
    ws.on('close', () => setTimeout(open, 2000));
    ws.on('error', () => {});
  }
  open();
  setInterval(() => send({ t: 'ping' }), 2000);
}

for (let i = 0; i < Number(count); i += 1) person(i);
