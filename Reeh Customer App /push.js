// push.js - background notifications (Firebase Cloud Messaging) + in-app sound
import { app, db, doc, updateDoc, arrayUnion } from "./firebase-init.js";

// Saves this phone's push token on the customer (users/{phone}.fcmTokens). Needs: permission granted + settings/app.vapidKey.
export async function registerPush(phone, brand = {}) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!("serviceWorker" in navigator) || !brand.vapidKey) return;
    // own scope, so it does not clash with any other service worker of the app
    const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js");
    const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js", { scope: "./firebase-cloud-messaging-push-scope" });
    await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: brand.vapidKey, serviceWorkerRegistration: reg });
    if (token) await updateDoc(doc(db, "users", phone), { fcmTokens: arrayUnion(token) });
  } catch (e) { console.warn("push not registered:", e.code || e.message); }
}

// Sound while the app is open: the file from Firebase, or a short built-in beep if none / blocked.
export function playNotifySound(url) {
  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.16);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.16 + 0.14);
        o.start(ctx.currentTime + i * 0.16); o.stop(ctx.currentTime + i * 0.16 + 0.15);
      });
    } catch (e) { /* no audio */ }
  };
  if (!url) return beep();
  try { new Audio(url).play().catch(beep); } catch (e) { beep(); }
  try { navigator.vibrate?.([150, 80, 150]); } catch (e) { /* ignore */ }
}
