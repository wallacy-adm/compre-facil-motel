self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'CompraFácil', body: event.data.text() }; }

  const url = data.url || '/';

  event.waitUntil(
    // Conta quantas notificações já estão abertas para calcular o badge correto
    self.registration.getNotifications().then(existing => {
      const badgeCount = existing.length + 1; // +1 pela nova notificação
      if ('setAppBadge' in self.navigator) {
        self.navigator.setAppBadge(badgeCount).catch(() => {});
      }
      return self.registration.showNotification(data.title || 'CompraFácil', {
        body: data.body || '',
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        tag: data.tag || 'comprafacil',
        renotify: true,
        data: { url }
      });
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    // Atualiza badge ao fechar notificação (desconta 1 pois esta foi fechada)
    self.registration.getNotifications().then(remaining => {
      // remaining não inclui a que acabou de ser fechada
      if (remaining.length === 0) {
        if ('clearAppBadge' in self.navigator) {
          self.navigator.clearAppBadge().catch(() => {});
        } else if ('setAppBadge' in self.navigator) {
          self.navigator.setAppBadge(0).catch(() => {});
        }
      } else {
        if ('setAppBadge' in self.navigator) {
          self.navigator.setAppBadge(remaining.length).catch(() => {});
        }
      }
    }).then(() =>
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        for (const c of list) {
          if (c.url.startsWith(self.location.origin) && 'focus' in c) {
            c.postMessage({ type: 'NAVIGATE', url });
            return c.focus();
          }
        }
        return clients.openWindow(url);
      })
    )
  );
});
