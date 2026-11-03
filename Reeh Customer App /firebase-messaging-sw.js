// firebase-messaging-sw.js (admin) - shows the alert in the phone's notification bar while the admin app is closed
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDjgYmpI5ULWsMeLMcFfgJQv0yycKzlxeY",
  authDomain: "reeh-cloud.firebaseapp.com",
  projectId: "reeh-cloud",
  storageBucket: "reeh-cloud.firebasestorage.app",
  messagingSenderId: "612108884872",
  appId: "1:612108884872:web:e366868cab113c4b1ab83d"
});
const messaging = firebase.messaging();
const BASE = self.location.href.replace(/[^/]*$/, "");

// the Cloud Function sends data-only messages, so the notification is drawn here
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const call = d.kind === "call";
  return self.registration.showNotification(d.title || "Reeh Cloud Admin", {
    body: d.body || "",
    icon: BASE + "icon-192.png",
    badge: BASE + "icon-192.png",
    vibrate: call ? [400, 200, 400, 200, 400] : [200, 100, 200],
    tag: d.tag || undefined,
    renotify: true,                 // ring again even if the same chat sends more
    requireInteraction: call,       // a customer waiting stays on screen until you tap it
    data: { link: d.link || "messenger.html" }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || "messenger.html", BASE).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { if (c.navigate) c.navigate(url); return c.focus(); }
    return clients.openWindow(url);
  }));
});
