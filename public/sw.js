// v4.0 — badge via IndexedDB (contador preciso, independente de notificações abertas)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ── BADGE COUNTER via IndexedDB ──────────────────────────────────────────
// Mantém contador persistente no SW — não depende de getNotifications()
function openBadgeDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cf_badge_db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function getBadgeCount() {
  try {
    const db = await openBadgeDB();
    return new Promise(resolve => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get('badge');
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
}

async function saveBadgeCount(n) {
  try {
    const db = await openBadgeDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(n, 'badge');
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch {}
}

async function updateBadge(delta) {
  const next = Math.max(0, (await getBadgeCount()) + delta);
  await saveBadgeCount(next);
  try {
    if (next === 0) {
      if ('clearAppBadge' in self.navigator) await self.navigator.clearAppBadge();
    } else {
      if ('setAppBadge' in self.navigator) await self.navigator.setAppBadge(next);
    }
  } catch {}
  return next;
}

// ── PUSH ─────────────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'CompraFácil', body: event.data.text() }; }
  const url = data.url || '/';

  event.waitUntil(
    updateBadge(+1).then(() =>
      self.registration.showNotification(data.title || 'CompraFácil', {
        body: data.body || '',
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        tag: data.tag || 'comprafacil',
        renotify: true,
        data: { url }
      })
    )
  );
});

// ── NOTIFICATION CLICK ───────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    updateBadge(-1).then(() =>
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

// ── NOTIFICATION CLOSE (swipe/dismiss sem clicar) ────────────────────────
self.addEventListener('notificationclose', event => {
  event.waitUntil(updateBadge(-1));
});

// ── BADGE MESSAGES ───────────────────────────────────────────────────────
// SET_BADGE  → define a contagem exata (ex: 3 pedidos pendentes)
// RESET_BADGE → zera (só no logout)
self.addEventListener('message', event => {
  if (event.data?.type === 'SET_BADGE') {
    const count = Math.max(0, Number(event.data.count) || 0);
    event.waitUntil(
      saveBadgeCount(count).then(async () => {
        try {
          if (count === 0) {
            if ('clearAppBadge' in self.navigator) await self.navigator.clearAppBadge();
          } else {
            if ('setAppBadge' in self.navigator) await self.navigator.setAppBadge(count);
          }
        } catch {}
      })
    );
  }
  if (event.data?.type === 'RESET_BADGE') {
    event.waitUntil(
      saveBadgeCount(0).then(async () => {
        try {
          if ('clearAppBadge' in self.navigator) await self.navigator.clearAppBadge();
        } catch {}
      })
    );
  }
});
