// messenger.js - assistant chat: Hi -> language choice (3 languages) -> live agent
import {
  db, doc, getDoc, getDocs, setDoc, addDoc, collection, query, where, orderBy, limit, limitToLast, onSnapshot, serverTimestamp, writeBatch,
  esc, toDate, getSession, toast, loadBranding, confirmBox, choiceBox
} from "./firebase-init.js";

const $ = (id) => document.getElementById(id);
const phone = getSession();
if (!phone) location.replace("index.html");

$("back").onclick = () => (history.length > 1 ? history.back() : (location.href = "index.html"));

const chatRef = doc(db, "chats", phone || "x");
const msgsCol = collection(db, "chats", phone || "x", "messages");

// Used when botConfig/main is missing in Firebase. Everything here can be changed in Firebase.
const DEFAULTS = {
  greetingWords: ["hi", "hii", "hello", "hey", "hai", "வணக்கம்", "ஹாய்", "ஹலோ", "හායි", "හෙලෝ", "ආයුබෝවන්"],
  greeting: {
    ta: "வணக்கம்! உங்களுக்கு உதவி தேவைப்படும் மொழியை தெரிவு செய்யவும்.",
    en: "Hello! Please choose the language you need help in.",
    si: "ආයුබෝවන්! ඔබට උදව් අවශ්‍ය භාෂාව තෝරන්න."
  },
  languages: [
    { code: "ta", label: "தமிழ்" },
    { code: "en", label: "English" },
    { code: "si", label: "සිංහල" }
  ],
  connecting: {
    ta: "வணக்கம், நான் உதவ தயாராக இருக்கிறேன். தற்போது நேரலை Agent உடன் இணைக்கிறேன்.",
    en: "Hello, I'm ready to help. Connecting you to a live agent now.",
    si: "ආයුබෝවන්, මම උදව් කිරීමට සූදානම්. දැන් ඔබව සජීවී නියෝජිතයෙකු සමඟ සම්බන්ධ කරමි."
  },
  fallback: {
    ta: 'தொடங்க "Hi" என்று தட்டச்சு செய்யவும்.',
    en: 'Type "Hi" to start.',
    si: 'ආරම්භ කිරීමට "Hi" ටයිප් කරන්න.'
  }
};

let cfg = DEFAULTS;
let chat = {};
let user = {};
let busy = false;
let lastMsgs = [];
let brand = {}, firstChatSnap = true, firstMsgSnap = true;
let typingOn = false, typingTimer = null, lastTypeMark = 0, lastTypedAt = 0;
let selecting = false, allSelected = false;
const selected = new Set();


async function init() {
  try {
    const [c, u, br] = await Promise.all([getDoc(doc(db, "botConfig", "main")), getDoc(doc(db, "users", phone)), loadBranding()]);
    if (c.exists()) cfg = { ...DEFAULTS, ...c.data() };
    user = u.data() || {};
    brand = br || {};
  } catch (e) { console.error(e); }
  drawMe();

  // chat state: status banner + "agent is typing" (a new adminTypingAt value = typing again)
  onSnapshot(chatRef, (s) => {
    chat = s.data() || {};
    const mark = toDate(chat.adminTypingAt)?.getTime() || 0;
    if (mark && mark !== lastTypeMark) { lastTypeMark = mark; if (!firstChatSnap) showTyping(); }
    firstChatSnap = false;
    renderBanner(); renderMsgs();
  });

  onSnapshot(query(msgsCol, orderBy("createdAt", "asc"), limitToLast(200)), (s) => {
    lastMsgs = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!firstMsgSnap) {
      s.docChanges().forEach((ch) => {
        if (ch.type === "added" && ch.doc.data().sender !== "customer") { hideTyping(); playSound("receive"); }
      });
    }
    firstMsgSnap = false;
    [...selected].forEach((id) => { if (!lastMsgs.some((m) => m.id === id)) selected.delete(id); });
    updateSelCount();
    renderMsgs();
  });

  $("composer").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("text").value.trim();
    if (!text || busy) return;
    $("text").value = "";
    playSound("send");
    await handleInput(text);
  };
  // the agent sees "customer is typing" while a person is talking to them
  $("text").addEventListener("input", () => {
    if (!["waiting", "live"].includes(chat.status) || Date.now() - lastTypedAt < 2500) return;
    lastTypedAt = Date.now();
    setDoc(chatRef, { customerTypingAt: serverTimestamp() }, { merge: true }).catch(() => {});
  });
  setupSelection();
}

function drawMe() {
  $("me-name").textContent = user.name || "My profile";
  $("me-phone").textContent = phone;
  $("me-av").innerHTML = (user.photoUrl || user.photoBase64) ? `<img src="${esc((user.photoUrl || user.photoBase64))}" alt="">` : esc((user.name || "R").charAt(0).toUpperCase());
}

/* ---------- typing indicator ---------- */
function showTyping() {
  typingOn = true; renderMsgs();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(hideTyping, 5000);
}
function hideTyping() { clearTimeout(typingTimer); if (typingOn) { typingOn = false; renderMsgs(); } }

/* ---------- sounds (files come from Firebase: settings/app) ---------- */
function beep(kind) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    (kind === "send" ? [660] : [880, 1175]).forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.16, ctx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.13);
      o.start(ctx.currentTime + i * 0.15); o.stop(ctx.currentTime + i * 0.15 + 0.14);
    });
  } catch (e) { /* no audio */ }
}
function playSound(kind) {
  const url = kind === "send" ? brand.messageSendSoundUrl : brand.messageReceiveSoundUrl;
  if (url) { try { new Audio(url).play().catch(() => beep(kind)); return; } catch (e) { /* fall back */ } }
  beep(kind);
}

/* ---------- writing ---------- */
const addMsg = (sender, text, extra = {}) =>
  addDoc(msgsCol, { sender, text, createdAt: serverTimestamp(), ...extra });

const touchChat = (data) =>
  setDoc(chatRef, { phone, customerName: user.name || "", updatedAt: serverTimestamp(), ...data }, { merge: true });

const joinLangs = (obj) => ["ta", "en", "si"].map((k) => obj?.[k]).filter(Boolean).join("\n\n");

/* ---------- bot logic ---------- */
const isGreeting = (t) => {
  const x = t.toLowerCase().replace(/[!.?\s]+/g, " ").trim();
  return (cfg.greetingWords || []).some((w) => x === String(w).toLowerCase() || x.startsWith(String(w).toLowerCase() + " "));
};
const matchLang = (t) => {
  const x = t.trim().toLowerCase();
  return (cfg.languages || []).find((l) => l.code.toLowerCase() === x || l.label.toLowerCase() === x);
};

async function handleInput(text) {
  busy = true;
  try {
    await addMsg("customer", text);
    await touchChat({ lastMessage: text, lastSender: "customer", unreadAdmin: true });
    const st = chat.status || "closed";
    if (st === "waiting" || st === "live") return;           // a human takes over
    if (st === "language") {
      const l = matchLang(text);
      if (l) return connect(l);
      return sendLanguageChoice();                            // ask again
    }
    if (isGreeting(text)) return sendLanguageChoice();
    await addMsg("bot", joinLangs(cfg.fallback));
  } catch (e) { console.error(e); toast("Could not send. Try again."); }
  finally { busy = false; }
}

async function sendLanguageChoice() {
  await addMsg("bot", joinLangs(cfg.greeting), { options: cfg.languages });
  await touchChat({ status: "language" });
}

async function pickLanguage(l) {          // tapped a language button
  if (busy) return;
  busy = true;
  playSound("send");
  try {
    await addMsg("customer", l.label);
    await touchChat({ lastMessage: l.label, lastSender: "customer", unreadAdmin: true });
    await connect(l);
  } catch (e) { console.error(e); toast("Could not send. Try again."); }
  finally { busy = false; }
}

async function connect(l) {
  await addMsg("bot", cfg.connecting?.[l.code] || cfg.connecting?.en || "");
  await touchChat({ status: "waiting", language: l.code, adminCall: true, callRequestedAt: serverTimestamp() });
  // "call" for the admin: a ringing entry the admin side listens to
  await addDoc(collection(db, "adminCalls"), {
    phone, customerName: user.name || "", language: l.code, status: "ringing", createdAt: serverTimestamp()
  });
}

/* ---------- rendering ---------- */
function renderBanner() {
  const b = $("banner"), st = chat.status;
  const map = {
    waiting: ["Waiting for a live agent…", ""],
    live: ["Live agent connected", "live"],
    closed: ['Chat ended. Type "Hi" to start again.', "ended"]
  };
  const m = map[st];
  b.hidden = !m;
  if (m) {
    b.className = "banner-state " + m[1];
    b.innerHTML = esc(m[0]) + (st === "waiting" ? ' <button class="btn btn-sm" id="to-menu" type="button">Main menu</button>' : "");
    const tm = $("to-menu"); if (tm) tm.onclick = restartFromMenu;
  }
  $("status-line").textContent = st === "live" ? "Live agent" : st === "waiting" ? "Connecting…" : "Assistant";
}

// while still waiting for an agent: go back to the beginning (language choice)
async function restartFromMenu() {
  const ok = await confirmBox({ title: "Main menu", message: "Go back to the start of the chat? Your request to the agent will be cancelled.", okText: "Main menu", cancelText: "Stay" });
  if (!ok || busy) return;
  busy = true;
  try { await touchChat({ adminCall: false }); await sendLanguageChoice(); }
  catch (e) { console.error(e); toast("Could not restart. Try again."); }
  finally { busy = false; }
}

function renderMsgs() {
  const box = $("msgs");
  if (!lastMsgs.length) { box.innerHTML = `<div class="empty">Type <b>Hi</b> to start chatting.</div>`; return; }
  const lastIdx = lastMsgs.length - 1;
  box.classList.toggle("selecting", selecting);
  box.innerHTML = lastMsgs.map((m, i) => {
    const t = toDate(m.createdAt);
    const time = t ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const who = m.sender === "bot" ? "Assistant" : m.sender === "admin" ? "Agent" : "";
    const opts = i === lastIdx && m.options && chat.status === "language"
      ? `<div class="opts">${m.options.map((o, k) => `<button class="btn btn-ghost" data-lang="${k}">${esc(o.label)}</button>`).join("")}</div>` : "";
    return `<div class="msg ${esc(m.sender)} ${selected.has(m.id) ? "picked" : ""}" data-id="${esc(m.id)}">
      ${who ? `<span class="who">${who}</span>` : ""}
      <div class="bubble">${esc(m.text)}</div>${opts}
      <span class="time">${time}</span></div>`;
  }).join("") + (typingOn ? '<div class="msg admin typing"><span class="who">Agent</span><div class="bubble"><i></i><i></i><i></i></div></div>' : "");
  const opts = lastMsgs[lastIdx]?.options;
  box.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => pickLanguage(opts[Number(b.dataset.lang)])));
  box.scrollTop = box.scrollHeight;
}

/* ---------- press and hold your own message -> Select / Delete ---------- */
const mine = (id) => lastMsgs.find((m) => m.id === id && m.sender === "customer");

function setupSelection() {
  const box = $("msgs");
  let timer = null, fired = false, sx = 0, sy = 0;
  box.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".msg.customer");
    if (!el || selecting) return;
    sx = e.clientX; sy = e.clientY; fired = false;
    timer = setTimeout(() => { fired = true; openMenu(el.dataset.id); }, 550);
  });
  box.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(timer); timer = null; } });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => box.addEventListener(ev, () => { clearTimeout(timer); timer = null; }));
  box.addEventListener("contextmenu", (e) => { if (e.target.closest(".msg.customer")) e.preventDefault(); });
  box.addEventListener("click", (e) => {
    if (fired) { fired = false; return; }
    if (!selecting || e.target.closest("[data-lang]")) return;
    const el = e.target.closest(".msg.customer");
    if (el) toggle(el.dataset.id);
  });

  $("sel-cancel").onclick = () => setSelecting(false);
  $("sel-all").onclick = () => {
    allSelected = true;
    lastMsgs.filter((m) => m.sender === "customer").forEach((m) => selected.add(m.id));
    updateSelCount(); renderMsgs();
  };
  $("sel-copy").onclick = async () => {
    const text = [...selected].map((id) => mine(id)?.text).filter(Boolean).join("\n");
    if (!text) return toast("Select a message first");
    try { await navigator.clipboard.writeText(text); toast("Copied"); } catch (e) { toast("Could not copy"); }
  };
  $("sel-del").onclick = () => removeMessages([...selected], allSelected);
}

async function openMenu(id) {
  const act = await choiceBox({ title: "Message", options: [{ label: "Select", value: "select", kind: "primary" }, { label: "Delete", value: "delete", kind: "danger" }] });
  if (act === "delete") return removeMessages([id], false);
  if (act === "select") { setSelecting(true); toggle(id); }
}
function setSelecting(on) {
  selecting = on; allSelected = false; selected.clear();
  $("top-bar").hidden = on; $("sel-bar").hidden = !on;
  updateSelCount(); renderMsgs();
}
function toggle(id) {
  allSelected = false;
  selected.has(id) ? selected.delete(id) : selected.add(id);
  updateSelCount(); renderMsgs();
}
function updateSelCount() { $("sel-count").textContent = (allSelected ? "All" : selected.size) + " selected"; }

async function removeMessages(ids, everything) {
  if (!ids.length) return toast("Select a message first");
  const text = everything ? "Delete ALL the messages you sent?" : ids.length === 1 ? "Delete this message?" : `Delete ${ids.length} messages?`;
  if (!(await confirmBox({ title: "Delete", message: text + " This cannot be undone.", okText: "Delete", cancelText: "Cancel" }))) return;
  try {
    if (everything) {                      // also the ones that are not on screen
      for (;;) {
        const s = await getDocs(query(msgsCol, where("sender", "==", "customer"), limit(450)));
        if (!s.docs.length) break;
        const b = writeBatch(db); s.docs.forEach((d) => b.delete(d.ref)); await b.commit();
      }
    } else {
      for (let i = 0; i < ids.length; i += 400) {
        const b = writeBatch(db);
        ids.slice(i, i + 400).forEach((id) => b.delete(doc(db, "chats", phone, "messages", id)));
        await b.commit();
      }
    }
    setSelecting(false);
    toast("Deleted");
  } catch (e) { console.error(e); toast("Could not delete (" + (e.code || e.message) + ")"); }
}

// start the page only after every function and constant above is defined
init();
