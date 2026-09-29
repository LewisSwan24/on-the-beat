// ON THE BEAT — the staff page's service worker (docs/superpowers/specs/2026-09-29-staff-push-design.md §1). It
// shows a new report's notification and opens the page when one is tapped. It keeps nothing, so there is no fetch
// handler: the staff page is live or nothing.

const TAG = 'otb-reports';

self.addEventListener('install', () => { self.skipWaiting(); });

/** New report · <venue>, and how many are open. What cannot be read still says New report. */
function noticeOf(data) {
  const venue = data && typeof data.venue === 'string' ? data.venue.slice(0, 80) : '';
  const open = data && Number.isInteger(data.open) && data.open > 0 ? data.open : 0;
  return {
    title: venue ? 'New report · ' + venue : 'New report',
    body: open === 1 ? '1 open — tap to see it' : open > 1 ? open + ' open — tap to see them' : 'Tap to see the list',
  };
}

self.addEventListener('push', (e) => {
  let data = null;
  try {
    data = e.data ? e.data.json() : null;
  } catch {
    data = null;
  }
  const { title, body } = noticeOf(data);
  // Safari takes the permission back from a site whose push shows nothing: every push shows one.
  e.waitUntil(self.registration.showNotification(title, { body, tag: TAG, renotify: true, icon: '/icon-192.png', data: { url: '/staff' } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
    const page = all.find((c) => new URL(c.url).pathname.startsWith('/staff'));
    return page ? page.focus() : self.clients.openWindow('/staff');
  }));
});
