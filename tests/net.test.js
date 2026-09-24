// ON THE BEAT — the phone's line: what it re-says, in what order, and what a page load sends.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** A socket that records what is sent on it, opened by hand. */
class FakeSocket {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeSocket.all.push(this); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

let connect;
beforeEach(async () => {
  FakeSocket.all = [];
  globalThis.WebSocket = FakeSocket;
  globalThis.location = { protocol: 'http:', host: 'relay.test' };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  ({ connect } = await import('../app/lib/net.js'));
});
const lines = [];
afterEach(() => { for (const n of lines.splice(0)) n.close(); });
const open = (opts = {}) => { const n = connect({ venue: 'v', me: 'a'.repeat(32), ...opts }); lines.push(n); return n; };

test('a page load queues nothing: what it holds goes out only as again copies, in order, claim first', () => {
  const n = open();
  n.keep('arm', { t: 'arm', intent: null, seq: 7 });
  n.keep('pick', { t: 'pick', track: 'Treasure' });
  n.keep('profile', { t: 'profile', name: 'Rae', contact: '' });
  n.keep('invisible', { t: 'invisible', on: false, seq: 7 });
  n.keep('pair', { t: 'pair', band: 'b'.repeat(32), secret: 'c'.repeat(32) });
  const [sock] = FakeSocket.all;
  assert.deepEqual(sock.sent, [], 'nothing before the socket opens');
  sock.open();
  assert.deepEqual(sock.sent.map((m) => m.t), ['join', 'pair', 'invisible', 'profile', 'pick', 'arm']);
  assert.ok(sock.sent.slice(1).every((m) => m.again === true), 'every fact is marked again');
  assert.equal(sock.sent[0].quiet, undefined, 'a visible phone joins without quiet');
});

test('a phone holding NOT NOW joins with quiet', () => {
  const n = open();
  n.keep('invisible', { t: 'invisible', on: true, seq: 9 });
  FakeSocket.all[0].open();
  assert.equal(FakeSocket.all[0].sent[0].quiet, true);
});

test('offline, NOT NOW is queued and also re-said; after the again copies, the queue', () => {
  const n = open();
  n.say('invisible', { t: 'invisible', on: true, seq: 11 });
  assert.equal(n.live(), false);
  FakeSocket.all[0].open();
  assert.deepEqual(FakeSocket.all[0].sent.map((m) => [m.t, !!m.again]), [['join', false], ['invisible', true], ['invisible', false]]);
});

test('a leave is re-said on every connection until it is forgotten', () => {
  const n = open();
  n.keep('leave', { t: 'leave' });
  FakeSocket.all[0].open();
  assert.equal(FakeSocket.all[0].sent.at(-1).t, 'leave');
  n.forget('leave');
  n.close();
});
