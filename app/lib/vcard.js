// ON THE BEAT — a kept contact as a card the phone's own contacts app can take (vCard 3.0, RFC 2426).
//
// Made on the phone from what it already holds: the name and the contact both people chose to keep. Nothing is sent
// anywhere. A contact is whatever the other person typed ("@handle, number, anything"), so it is read for what it
// looks like: a phone number goes in as a number, an address with an @ and a dot as an email, a web address as a URL,
// and anything else (a handle) as a note, where nothing is guessed about it.

const PHONE = /^\+?[\d\s().-]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_LIKE = /^https?:\/\/\S+$/i;
const MAX_OCTETS = 75;

/** What kind of contact this is: 'tel', 'email', 'url' or 'note'. */
export function contactKind(contact) {
  const c = String(contact || '').trim();
  if (EMAIL.test(c)) return 'email';
  if (URL_LIKE.test(c)) return 'url';
  if (PHONE.test(c) && c.replace(/\D/g, '').length >= 6) return 'tel';
  return 'note';
}

/** A value as vCard text: backslashes, commas, semicolons and line breaks escaped. */
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '').replace(/,/g, '\\,').replace(/;/g, '\\;');

/** A content line folded at 75 octets, never inside a character, each continuation starting with a space. */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let octets = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? MAX_OCTETS - 1 : MAX_OCTETS;   // a continuation's leading space counts
    if (octets + n > limit) { out.push(cur); cur = ''; octets = 0; }
    cur += ch;
    octets += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * The card for one kept person: { name, contact, venue, night } as the phone keeps them (store.js noteMatch()).
 * `night` is the YYYY-MM-DD the night is filed under.
 */
export function vcardOf({ name, contact, venue, night }) {
  const shown = String(name || '').trim() || 'Someone';
  const c = String(contact || '').trim();
  const place = String(venue || '').trim();
  const met = 'Met' + (place ? ' at ' + place : '') + (night ? ' on ' + night : '') + ', through On The Beat.';
  const kind = contactKind(c);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + esc(shown), 'N:;' + esc(shown) + ';;;'];
  if (kind === 'tel') lines.push('TEL;TYPE=CELL:' + esc(c));
  else if (kind === 'email') lines.push('EMAIL;TYPE=INTERNET:' + esc(c));
  else if (kind === 'url') lines.push('URL:' + esc(c));
  lines.push('NOTE:' + esc(kind === 'note' && c ? 'Contact: ' + c + '\n' + met : met));
  lines.push('END:VCARD');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** A file name for the card: the person's name, kept to letters, digits, spaces and dashes. */
export function vcardName(name) {
  const base = String(name || '').normalize('NFKD').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 40);
  return (base || 'contact') + '.vcf';
}

/**
 * Hand the card to the phone: the share sheet where the browser can share a file (a phone's contacts app is there),
 * a download otherwise. Resolves 'shared', 'saved' or 'cancelled'.
 */
export async function saveCard(kept, { nav = globalThis.navigator, doc = globalThis.document } = {}) {
  const text = vcardOf(kept);
  const fileName = vcardName(kept.name);
  const type = 'text/vcard';
  try {
    const file = new File([text], fileName, { type });
    if (nav?.canShare?.({ files: [file] })) {
      await nav.share({ files: [file] });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
    // Anything else: fall through to a download.
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000)?.unref?.();   // unref: under node's tests, not in a browser
  return 'saved';
}
