// ============================================================
// 🤖 المساعد الذكي — زر عائم (FAB) ونافذة محادثة
// يعمل في وضعين:
//   - lesson: داخل صفحة الدرس، يجيب من محتوى هذا الدرس فقط
//   - global: من الصفحة الرئيسية، يبحث عبر كل الدروس المنشورة
// الاتصال بـ Mistral يتم بالكامل من داخل Supabase Edge Function
// (ai-assistant) — لا يوجد أي مفتاح API في كود الواجهة الأمامية.
// ============================================================
import { supabase } from "./supabaseClient.js";

const $ = (sel) => document.querySelector(sel);

let currentMode = "global";
let currentContentId = null;
let currentLessonTitle = "";
let sending = false;

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text) node.textContent = opts.text;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  children.forEach((c) => c && node.appendChild(c));
  return node;
}

function scrollChatToBottom() {
  const box = $("#ai-chat-messages");
  if (box) box.scrollTop = box.scrollHeight;
}

function appendMessage(role, text) {
  const box = $("#ai-chat-messages");
  if (!box) return;
  const bubble = el("div", { className: `ai-msg ai-msg-${role}` });
  bubble.textContent = text;
  box.appendChild(bubble);
  scrollChatToBottom();
  return bubble;
}

function appendTyping() {
  const box = $("#ai-chat-messages");
  const bubble = el("div", { className: "ai-msg ai-msg-bot ai-msg-typing", attrs: { id: "ai-typing" } }, [
    el("span", { className: "dot" }),
    el("span", { className: "dot" }),
    el("span", { className: "dot" }),
  ]);
  box.appendChild(bubble);
  scrollChatToBottom();
}

function removeTyping() {
  const t = $("#ai-typing");
  if (t) t.remove();
}

export function openAssistant(mode, { contentId = null, lessonTitle = "" } = {}) {
  currentMode = mode;
  currentContentId = contentId;
  currentLessonTitle = lessonTitle;

  $("#ai-assistant-title").textContent = mode === "lesson" ? `مساعد الدرس: ${lessonTitle}` : "مساعد رحلة الحياة الزوجية";
  $("#ai-assistant-subtitle").textContent =
    mode === "lesson" ? "اسأل عن أي جزء من هذا الدرس (النص أو الفيديو أو الملفات المرفقة)" : "اسأل عن أي موضوع داخل دروس التطبيق";
  $("#ai-chat-messages").innerHTML = "";
  appendMessage("bot", mode === "lesson" ? "أهلاً بك! اسألني عن محتوى هذا الدرس وسأجيبك من مصادره مباشرة." : "أهلاً بك! اسألني عن أي موضوع تعلمته الدروس، وسأجيبك مع ذكر مصدر الإجابة.");

  $("#ai-assistant-modal").classList.remove("hidden");
  setTimeout(() => $("#ai-chat-input")?.focus(), 100);
}

export function closeAssistant() {
  $("#ai-assistant-modal").classList.add("hidden");
}

async function sendQuestion(question) {
  if (sending) return;
  sending = true;
  const sendBtn = $("#ai-chat-send");
  sendBtn.disabled = true;
  appendMessage("user", question);
  appendTyping();

  try {
    const payload = { mode: currentMode, question };
    if (currentMode === "lesson") payload.content_id = currentContentId;

    const { data, error } = await supabase.functions.invoke("ai-assistant", { body: payload });
    removeTyping();

    if (error) {
      appendMessage("bot", "حدث خطأ أثناء الاتصال بالمساعد الذكي، حاول مرة أخرى.");
      return;
    }
    if (data?.error) {
      appendMessage("bot", data.error);
      return;
    }

    const bubble = appendMessage("bot", data.answer);
    if (data.answered === false && bubble) bubble.classList.add("ai-msg-fallback");
  } catch (err) {
    removeTyping();
    appendMessage("bot", "تعذّر الوصول إلى المساعد الذكي حالياً، تحقق من الاتصال بالإنترنت وحاول مجدداً.");
  } finally {
    sending = false;
    sendBtn.disabled = false;
  }
}

export function initAssistant() {
  // زر إغلاق النافذة
  $("#ai-assistant-close")?.addEventListener("click", closeAssistant);
  $("#ai-assistant-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "ai-assistant-modal") closeAssistant();
  });

  // إرسال السؤال
  const form = $("#ai-chat-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#ai-chat-input");
    const value = input.value.trim();
    if (!value) return;
    input.value = "";
    sendQuestion(value);
  });

  // الزر العائم العام (الصفحة الرئيسية)
  $("#global-ai-fab")?.addEventListener("click", () => openAssistant("global"));

  // الزر العائم داخل صفحة الدرس
  $("#lesson-ai-fab")?.addEventListener("click", () => {
    const title = $("#lesson-title")?.textContent || "";
    openAssistant("lesson", { contentId: window.__currentLessonId ?? null, lessonTitle: title });
  });
}
