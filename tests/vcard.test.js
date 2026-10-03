import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactKind, saveCard, vcardName, vcardOf } from '../app/lib/vcard.js';

const lines = (card) => card.split('\r\n');
const unfold = (card) => card.replace(/\r\n /g, '');

test('a contact is read for what it looks like, and a handle is never guessed at', () => {
  assert.equal(contactKind('+61 412 345 678'), 'tel');
  assert.equal(contactKind('(07) 3365-1111'), 'tel');
  assert.equal(contactKind('mia@example.com'), 'email');
  assert.equal(contactKind('https://instagram.com/mia'), 'url');
  assert.equal(contactKind('@mia.dances'), 'note');
  assert.equal(contactKind('insta mia_d'), 'note');
  assert.equal(contactKind('12345'), 'note', 'too few digits to be a number');
  assert.equal(contactKind(''), 'note');
});

test('a card has the name, the contact where a contacts app looks for it, and where they met', () => {
  const card = vcardOf({ name: 'Mia', contact: '+61 412 345 678', venue: 'The Roundhouse, Camden', night: '2026-10-03' });
  const l = lines(card);
  assert.equal(l[0], 'BEGIN:VCARD');
  assert.equal(l[1], 'VERSION:3.0');
  assert.ok(l.includes('FN:Mia'));
  assert.ok(l.includes('N:;Mia;;;'));
  assert.ok(l.includes('TEL;TYPE=CELL:+61 412 345 678'));
  assert.ok(unfold(card).includes('NOTE:Met at The Roundhouse\\, Camden on 2026-10-03\\, through On The Beat.'));
  assert.equal(l.at(-2), 'END:VCARD');
  assert.equal(l.at(-1), '', 'it ends with a line break');
  assert.ok(!/[^\r]\n/.test(card), 'every line break is CRLF');
});

test('an email and a web address go in as themselves; a handle goes in the note', () => {
  assert.ok(lines(vcardOf({ name: 'Ben', contact: 'ben@example.com' })).includes('EMAIL;TYPE=INTERNET:ben@example.com'));
  assert.ok(lines(vcardOf({ name: 'Ben', contact: 'https://ben.example' })).includes('URL:https://ben.example'));
  const handle = unfold(vcardOf({ name: 'Ben', contact: '@ben;dj', venue: 'Moth Club', night: '2026-10-03' }));
  assert.ok(handle.includes('NOTE:Contact: @ben\\;dj\\nMet at Moth Club on 2026-10-03\\, through On The Beat.'));
  assert.ok(!/^(TEL|EMAIL|URL)/m.test(handle));
});

test('a name with no letters, or none at all, is still a card', () => {
  assert.ok(lines(vcardOf({ name: '', contact: '@x' })).includes('FN:Someone'));
  assert.equal(vcardName(''), 'contact.vcf');
  assert.equal(vcardName('Zoë / DJ'), 'Zoe  DJ.vcf');
  assert.equal(vcardName('../../etc'), 'etc.vcf', 'no path in a file name');
});

test('long lines are folded at 75 octets and never inside a character', () => {
  const card = vcardOf({ name: '美'.repeat(40), contact: '@' + 'x'.repeat(58), venue: 'Electric Ballroom, Camden', night: '2026-10-03' });
  const enc = new TextEncoder();
  for (const line of lines(card)) assert.ok(enc.encode(line).length <= 75, 'a line of ' + enc.encode(line).length + ' octets');
  assert.ok(unfold(card).includes('FN:' + '美'.repeat(40)), 'and unfolds to the whole name');
});

test('the card goes to the share sheet where a file can be shared, and is downloaded otherwise', async () => {
  const kept = { name: 'Mia', contact: '+61 412 345 678', venue: 'Moth Club', night: '2026-10-03' };
  let shared = null;
  const sharer = { canShare: ({ files }) => files.length === 1, share: async ({ files }) => { shared = files[0]; } };
  assert.equal(await saveCard(kept, { nav: sharer }), 'shared');
  assert.equal(shared.name, 'Mia.vcf');
  assert.equal(shared.type, 'text/vcard');
  assert.ok((await shared.text()).includes('TEL;TYPE=CELL:+61 412 345 678'));

  const cancelled = { canShare: () => true, share: async () => { throw Object.assign(new Error('no'), { name: 'AbortError' }); } };
  assert.equal(await saveCard(kept, { nav: cancelled }), 'cancelled');

  const clicked = [];
  const doc = {
    body: { appendChild() {} },
    createElement: () => ({ click() { clicked.push({ href: this.href, download: this.download }); }, remove() {} }),
  };
  assert.equal(await saveCard(kept, { nav: {}, doc }), 'saved');
  assert.equal(clicked.length, 1);
  assert.equal(clicked[0].download, 'Mia.vcf');
  assert.ok(clicked[0].href.startsWith('blob:'));
});
