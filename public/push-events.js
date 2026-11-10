/* Loaded by the generated Workbox service worker. No credentials live here. */
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch { /* always show a visible notification */ }
    const target = new URL(payload.url || './#/reminders', self.registration.scope);
    const safe = target.origin === self.location.origin && target.pathname.startsWith(new URL(self.registration.scope).pathname);
    await self.registration.showNotification(payload.title || '律 · 事务提醒', {
      body: payload.body || '总裁，您有一项事务需要留意。',
      icon: new URL('icons/icon-192.png', self.registration.scope).href,
      tag: payload.tag || 'assistant-reminder',
      data: { url: safe ? target.href : self.registration.scope },
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || self.registration.scope);
    if (target.origin !== self.location.origin) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(w => w.url.startsWith(self.registration.scope));
    if (existing) { await existing.navigate(target.href); await existing.focus(); }
    else await self.clients.openWindow(target.href);
  })());
});
// iOS may invalidate a subscription while the app is closed. Login is deliberately
// required to register its replacement on the next visit; no long-lived auth in SW.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(self.clients.matchAll({type:'window'}).then(windows => {
    for (const client of windows) client.postMessage({type:'push-subscription-changed'});
  }));
});
