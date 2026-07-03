import { state } from "../state.js";
import { el, sanitizeUrl, getYoutubeEmbedUrl } from "../utils/sanitize.js";
import { STAGES } from "../state.js";
import { listMessages, sendMessage, subscribeToTicket } from "../support.js";

import { loadAdminStats } from "./stats.js";
import {
  listAllContents,
  getContent,
  saveContent,
  deleteContent,
  listSections,
  saveSection,
  deleteSection,
  listMedia,
  saveMedia,
  deleteMedia,
} from "./content-editor.js";
import { listUsers, updateUserStage } from "./user-manager.js";
import {
  listAllTickets,
  listUsersForPicker,
  openTicketForUser,
  assignTicketToSupervisor,
  setTicketStatus,
  deleteTicket,
} from "./support-manager.js";
import {
  downloadCsv,
  downloadJson,
  exportUsers,
  exportLessons,
  exportSections,
  exportMedia,
  exportProgress,
  exportTickets,
  exportTicketMessages,
  exportFullBackup,
} from "./export.js";

const $ = (sel) => document.querySelector(sel);

const TABS = [
  { key: "stats", label: "📊 الإحصائيات" },
  { key: "content", label: "📚 المحتوى" },
  { key: "users", label: "👥 المستخدمون" },
  { key: "support", label: "💬 الدعم" },
  { key: "export", label: "📤 تصدير البيانات" },
];

let activeTab = "stats";
let adminTicketUnsubscribe = null;
let toastFn = () => {};

/** نقطة الدخول: تُستدعى من app.js عند فتح مسار #admin */
export function renderAdmin(toast) {
  toastFn = toast || toastFn;

  const tabsBar = $("#admin-tabs");
  if (!tabsBar.dataset.bound) {
    tabsBar.innerHTML = "";
    TABS.forEach((t) => {
      const btn = el("button", {
        className: `admin-tab${t.key === activeTab ? " active" : ""}`,
        text: t.label,
        attrs: { type: "button", "data-admin-tab": t.key },
      });
      btn.addEventListener("click", () => switchTab(t.key));
      tabsBar.appendChild(btn);
    });
    tabsBar.dataset.bound = "1";
  }

  switchTab(activeTab);
}

function switchTab(key) {
  activeTab = key;
  if (adminTicketUnsubscribe) {
    adminTicketUnsubscribe();
    adminTicketUnsubscribe = null;
  }
  document.querySelectorAll(".admin-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.adminTab === key);
  });
  const body = $("#admin-panel-body");
  body.innerHTML = "";
  body.appendChild(el("div", { className: "spinner" }));

  const renderers = {
    stats: renderStatsTab,
    content: renderContentListTab,
    users: renderUsersTab,
    support: renderSupportListTab,
    export: renderExportTab,
  };
  renderers[key](body).catch((err) => {
    body.innerHTML = "";
    body.appendChild(el("div", { className: "empty-state" }, [el("p", { text: err.message })]));
  });
}

// ================================================================
// 📊 الإحصائيات
// ================================================================
async function renderStatsTab(body) {
  const stats = await loadAdminStats();
  body.innerHTML = "";

  const cards = [
    { icon: "👥", label: "إجمالي المستخدمين", value: stats.totalUsers, sub: `${stats.males} ذكور · ${stats.females} إناث` },
    { icon: "📚", label: "إجمالي الدروس", value: stats.totalLessons },
    { icon: "✅", label: "دروس مكتملة (لكل المستخدمين)", value: stats.completedLessons },
    { icon: "💬", label: "تذاكر دعم مفتوحة", value: stats.openTickets },
  ];

  const grid = el("div", { className: "admin-stats-grid" });
  cards.forEach((c) => {
    grid.appendChild(
      el("div", { className: "admin-stat-card" }, [
        el("span", { className: "admin-stat-icon", text: c.icon }),
        el("strong", { className: "admin-stat-value", text: String(c.value) }),
        el("span", { className: "admin-stat-label", text: c.label }),
        c.sub ? el("span", { className: "admin-stat-sub", text: c.sub }) : null,
      ])
    );
  });
  body.appendChild(grid);
}

/** يبني شارة صغيرة توضّح حالة نشر الدرس: منشور / مجدول / مسودة */
function publishBadge(publishedAt) {
  if (!publishedAt) return el("span", { className: "publish-badge draft", text: "مسودة" });
  const isFuture = new Date(publishedAt).getTime() > Date.now();
  if (isFuture) {
    const label = "مجدول: " + new Date(publishedAt).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
    return el("span", { className: "publish-badge scheduled", text: label });
  }
  return el("span", { className: "publish-badge published", text: "منشور" });
}

/** يحوّل قيمة ISO المخزّنة إلى صيغة يقبلها input[type=datetime-local] بالتوقيت المحلي */
function toDatetimeLocalValue(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ================================================================
// 📚 إدارة المحتوى (CMS)
// ================================================================
async function renderContentListTab(body) {
  const contents = await listAllContents();
  body.innerHTML = "";

  const addBtn = el("button", { className: "btn btn-primary btn-sm", text: "+ درس جديد", attrs: { type: "button" } });
  addBtn.addEventListener("click", () => renderContentEditor(body, null));
  body.appendChild(el("div", { attrs: { style: "margin-bottom: var(--space-4);" } }, [addBtn]));

  if (contents.length === 0) {
    body.appendChild(el("div", { className: "empty-state" }, [el("p", { text: "لا توجد دروس بعد، ابدأ بإضافة أول درس." })]));
    return;
  }

  const table = el("div", { className: "admin-table" });
  contents.forEach((c) => {
    const row = el("div", { className: "admin-table-row" }, [
      el("div", { className: "admin-row-main" }, [
        el("strong", { text: c.title }),
        el("span", { className: "admin-row-meta" }, [
          el("span", { text: `${STAGES[c.stage]?.label || c.stage} · ${c.category || "بدون تصنيف"}` }),
          publishBadge(c.published_at),
        ]),
      ]),
    ]);
    const editBtn = el("button", { className: "btn btn-outline btn-sm", text: "تعديل", attrs: { type: "button" } });
    editBtn.addEventListener("click", () => renderContentEditor(body, c.id));
    const delBtn = el("button", { className: "btn btn-outline btn-sm admin-danger-btn", text: "حذف", attrs: { type: "button" } });
    delBtn.addEventListener("click", async () => {
      if (!confirm(`هل تريد حذف الدرس "${c.title}"؟ سيتم حذف كل فقراته ووسائطه أيضاً.`)) return;
      try {
        await deleteContent(c.id);
        toastFn("تم حذف الدرس");
        renderContentListTab(body);
      } catch (err) {
        toastFn(err.message, "error");
      }
    });
    row.appendChild(el("div", { className: "admin-row-actions" }, [editBtn, delBtn]));
    table.appendChild(row);
  });
  body.appendChild(table);
}

async function renderContentEditor(body, contentId) {
  body.innerHTML = "";
  body.appendChild(el("div", { className: "spinner" }));

  let content = { title: "", body: "", stage: "pre_engagement", category: "", gender: "both", order: 0, published_at: null };
  let sections = [];
  let media = [];
  try {
    if (contentId) {
      content = await getContent(contentId);
      sections = await listSections(contentId);
      media = await listMedia(contentId);
    }
  } catch (err) {
    toastFn(err.message, "error");
  }
  body.innerHTML = "";

  const backBtn = el("button", { className: "btn btn-outline btn-sm", text: "→ رجوع لقائمة الدروس", attrs: { type: "button" } });
  backBtn.addEventListener("click", () => renderContentListTab(body));
  body.appendChild(backBtn);

  const form = el("form", { attrs: { style: "margin-top: var(--space-4);" } });

  const titleInput = el("input", { attrs: { type: "text", required: "required", value: content.title || "" } });
  const categoryInput = el("input", { attrs: { type: "text", value: content.category || "" } });
  const orderInput = el("input", { attrs: { type: "number", value: String(content.order ?? 0) } });
  const bodyInput = el("textarea", { attrs: { rows: "3" }, text: content.body || "" });

  const stageSelect = el("select", {}, Object.entries(STAGES).map(([key, val]) =>
    el("option", { text: val.label, attrs: content.stage === key ? { value: key, selected: "selected" } : { value: key } })
  ));
  const genderSelect = el("select", {}, [
    el("option", { text: "الجنسان", attrs: content.gender === "both" ? { value: "both", selected: "selected" } : { value: "both" } }),
    el("option", { text: "ذكور فقط", attrs: content.gender === "male" ? { value: "male", selected: "selected" } : { value: "male" } }),
    el("option", { text: "إناث فقط", attrs: content.gender === "female" ? { value: "female", selected: "selected" } : { value: "female" } }),
  ]);

  form.appendChild(el("div", { className: "field" }, [el("label", { text: "عنوان الدرس" }), titleInput]));
  form.appendChild(el("div", { className: "field" }, [el("label", { text: "المرحلة" }), stageSelect]));
  form.appendChild(el("div", { className: "field" }, [el("label", { text: "التصنيف" }), categoryInput]));
  form.appendChild(el("div", { className: "field" }, [el("label", { text: "الجنس المستهدف" }), genderSelect]));
  form.appendChild(el("div", { className: "field" }, [el("label", { text: "الترتيب" }), orderInput]));
  form.appendChild(
    el("div", { className: "field" }, [
      el("label", { text: "ملخص/نص احتياطي (يظهر إن لم تُضف فقرات)" }),
      bodyInput,
    ])
  );

  const publishInput = el("input", {
    attrs: { type: "datetime-local", value: toDatetimeLocalValue(content.published_at) },
  });
  form.appendChild(
    el("div", { className: "field" }, [
      el("label", { text: "تاريخ ووقت النشر (اتركه فارغاً لحفظ الدرس كمسودة غير ظاهرة للطلاب)" }),
      publishInput,
      publishBadge(content.published_at),
    ])
  );

  const saveBtn = el("button", { className: "btn btn-primary", text: "حفظ بيانات الدرس", attrs: { type: "submit" } });
  form.appendChild(saveBtn);
  body.appendChild(form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    try {
      const payload = {
        title: titleInput.value.trim(),
        stage: stageSelect.value,
        category: categoryInput.value.trim(),
        gender: genderSelect.value,
        order: Number(orderInput.value) || 0,
        body: bodyInput.value.trim() || titleInput.value.trim(),
        published_at: publishInput.value ? new Date(publishInput.value).toISOString() : null,
      };
      if (contentId) payload.id = contentId;
      const saved = await saveContent(payload);
      contentId = saved.id;
      toastFn("تم حفظ الدرس بنجاح");
      renderSectionsAndMedia(body, contentId, sections, media);
    } catch (err) {
      toastFn(err.message, "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  if (contentId) {
    renderSectionsAndMedia(body, contentId, sections, media);
  } else {
    body.appendChild(
      el("p", { className: "admin-hint", text: "احفظ بيانات الدرس أولاً لتتمكن من إضافة الفقرات والروابط." })
    );
  }
}

function renderSectionsAndMedia(container, contentId, sections, media) {
  const existing = container.querySelector(".admin-sections-media");
  if (existing) existing.remove();

  const wrap = el("div", { className: "admin-sections-media" });

  // ---- الفقرات والعناوين ----
  wrap.appendChild(el("h3", { text: "الفقرات والعناوين", attrs: { style: "margin-top: var(--space-6);" } }));
  wrap.appendChild(
    el("p", {
      className: "admin-hint",
      text: "يمكنك استخدام وسوم HTML أساسية لتنسيق النص: <b> غامق</b>، <i> مائل</i>، <u> تحته خط</u>، <a href=\"...\"> رابط</a>، <ul><li> قوائم</li></ul>، <br> سطر جديد. أي وسم آخر (مثل script) سيُحذف تلقائياً حفاظاً على الأمان.",
    })
  );
  
  const sectionsList = el("div", { className: "admin-subitems" });
  sections
    .sort((a, b) => a.order - b.order)
    .forEach((s) => sectionsList.appendChild(sectionRow(sectionsList, contentId, s)));
  wrap.appendChild(sectionsList);

  const addSectionBtn = el("button", { className: "btn btn-outline btn-sm", text: "+ إضافة فقرة/عنوان", attrs: { type: "button" } });
  addSectionBtn.addEventListener("click", () => {
    sectionsList.appendChild(sectionRow(sectionsList, contentId, { id: null, type: "paragraph", body: "", order: sectionsList.children.length }));
  });
  wrap.appendChild(addSectionBtn);

  // ---- الوسائط والروابط ----
  wrap.appendChild(el("h3", { text: "روابط الفيديو والملفات", attrs: { style: "margin-top: var(--space-6);" } }));
  const mediaList = el("div", { className: "admin-subitems" });
  media
    .sort((a, b) => a.order - b.order)
    .forEach((m) => mediaList.appendChild(mediaRow(mediaList, contentId, m)));
  wrap.appendChild(mediaList);

  const addMediaBtn = el("button", { className: "btn btn-outline btn-sm", text: "+ إضافة رابط", attrs: { type: "button" } });
  addMediaBtn.addEventListener("click", () => {
    mediaList.appendChild(mediaRow(mediaList, contentId, { id: null, type: "youtube", title: "", url: "", order: mediaList.children.length }));
  });
  wrap.appendChild(addMediaBtn);

  // ---- زر "حفظ كل الفقرات والروابط دفعة واحدة" ----
  const saveAllBtn = el("button", { className: "btn btn-primary", text: "💾 حفظ كل الفقرات والروابط دفعة واحدة", attrs: { type: "button", style: "margin-top: var(--space-4);" } });
  saveAllBtn.addEventListener("click", async () => {
    saveAllBtn.disabled = true;
    try {
      const sectionButtons = Array.from(sectionsList.querySelectorAll(".admin-subitem-row")).map(row => {
        const btn = row.querySelector(".btn-primary");
        return btn;
      }).filter(Boolean);
      
      const mediaButtons = Array.from(mediaList.querySelectorAll(".admin-subitem-row")).map(row => {
        const btn = row.querySelector(".btn-primary");
        return btn;
      }).filter(Boolean);

      const allButtons = [...sectionButtons, ...mediaButtons];
      
      if (allButtons.length === 0) {
        toastFn("لا يوجد فقرات أو روابط للحفظ");
        saveAllBtn.disabled = false;
        return;
      }

      // محاكاة نقرة "حفظ" على كل صف بالتتابع
      for (const btn of allButtons) {
        btn.click();
        // تأخير بسيط بين النقرات لتجنب تزامن الطلبات الزائد
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      toastFn("✅ تم حفظ كل الفقرات والروابط بنجاح");
    } catch (err) {
      toastFn("خطأ في حفظ بعض العناصر: " + err.message, "error");
    } finally {
      saveAllBtn.disabled = false;
    }
  });
  wrap.appendChild(saveAllBtn);

  container.appendChild(wrap);
}

function sectionRow(listEl, contentId, s) {
  const typeSelect = el("select", {}, [
    el("option", { text: "فقرة نصية", attrs: s.type === "paragraph" ? { value: "paragraph", selected: "selected" } : { value: "paragraph" } }),
    el("option", { text: "عنوان فرعي", attrs: s.type === "header" ? { value: "header", selected: "selected" } : { value: "header" } }),
  ]);
  const bodyInput = el("textarea", { attrs: { rows: "4", placeholder: "النص هنا... (يدعم وسوم HTML بسيطة)" }, text: s.body || "" });
  const saveBtn = el("button", { className: "btn btn-primary btn-sm", text: "حفظ", attrs: { type: "button" } });
  const delBtn = el("button", { className: "btn btn-outline btn-sm admin-danger-btn", text: "حذف", attrs: { type: "button" } });

  const row = el("div", { className: "admin-subitem-row" }, [typeSelect, bodyInput, el("div", { className: "admin-row-actions" }, [saveBtn, delBtn])]);

  // مستمع لتتبّع التغييرات غير المحفوظة
  bodyInput.addEventListener("input", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  typeSelect.addEventListener("change", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  saveBtn.addEventListener("click", async () => {
    try {
      const payload = { content_id: contentId, type: typeSelect.value, body: bodyInput.value.trim(), order: s.order || 0 };
      if (s.id) payload.id = s.id;
      const saved = await saveSection(payload);
      s.id = saved.id;
      toastFn("تم حفظ الفقرة");
      // إعادة الزر لحالته الطبيعية بعد النجاح
      saveBtn.textContent = "حفظ";
      saveBtn.classList.remove("btn-accent");
    } catch (err) {
      toastFn(err.message, "error");
    }
  });

  delBtn.addEventListener("click", async () => {
    try {
      if (s.id) await deleteSection(s.id);
      row.remove();
      toastFn("تم الحذف");
    } catch (err) {
      toastFn(err.message, "error");
    }
  });

  return row;
}

function mediaRow(listEl, contentId, m) {
  const typeSelect = el("select", {}, [
    el("option", { text: "فيديو يوتيوب", attrs: m.type === "youtube" ? { value: "youtube", selected: "selected" } : { value: "youtube" } }),
    el("option", { text: "ملف PDF", attrs: m.type === "pdf" ? { value: "pdf", selected: "selected" } : { value: "pdf" } }),
    el("option", { text: "رابط عام", attrs: m.type === "link" ? { value: "link", selected: "selected" } : { value: "link" } }),
  ]);
  const titleInput = el("input", { attrs: { type: "text", placeholder: "عنوان الرابط", value: m.title || "" } });
  const urlInput = el("input", { attrs: { type: "url", placeholder: "https://...", value: m.url || "" } });
  const saveBtn = el("button", { className: "btn btn-primary btn-sm", text: "حفظ", attrs: { type: "button" } });
  const delBtn = el("button", { className: "btn btn-outline btn-sm admin-danger-btn", text: "حذف", attrs: { type: "button" } });

  const row = el("div", { className: "admin-subitem-row" }, [
    typeSelect,
    titleInput,
    urlInput,
    el("div", { className: "admin-row-actions" }, [saveBtn, delBtn]),
  ]);

  // مستمع لتتبّع التغييرات غير المحفوظة
  urlInput.addEventListener("input", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  titleInput.addEventListener("input", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  typeSelect.addEventListener("change", () => {
    saveBtn.textContent = "⚠️ حفظ (تغييرات غير محفوظة)";
    saveBtn.classList.add("btn-accent");
  });

  saveBtn.addEventListener("click", async () => {
    const cleanUrl = sanitizeUrl(urlInput.value.trim());
    if (cleanUrl === "#") {
      toastFn("رابط غير صالح", "error");
      return;
    }
    // تحقق من صحة رابط يوتيوب قبل الحفظ
    if (typeSelect.value === "youtube" && !getYoutubeEmbedUrl(urlInput.value.trim())) {
      toastFn("⚠️ هذا الرابط لن يظهر كفيديو مضمّن — تأكد أنه رابط يوتيوب صحيح", "error");
      return;
    }
    try {
      const payload = { content_id: contentId, type: typeSelect.value, title: titleInput.value.trim(), url: cleanUrl, order: m.order || 0 };
      if (m.id) payload.id = m.id;
      const saved = await saveMedia(payload);
      m.id = saved.id;
      toastFn("تم حفظ الرابط");
      // إعادة الزر لحالته الطبيعية بعد النجاح
      saveBtn.textContent = "حفظ";
      saveBtn.classList.remove("btn-accent");
    } catch (err) {
      toastFn(err.message, "error");
    }
  });

  delBtn.addEventListener("click", async () => {
    try {
      if (m.id) await deleteMedia(m.id);
      row.remove();
      toastFn("تم الحذف");
    } catch (err) {
      toastFn(err.message, "error");
    }
  });

  return row;
}

// ================================================================
// 👥 إدارة المستخدمين
// ================================================================
async function renderUsersTab(body) {
  const users = await listUsers();
  body.innerHTML = "";

  if (users.length === 0) {
    body.appendChild(el("div", { className: "empty-state" }, [el("p", { text: "لا يوجد مستخدمون بعد." })]));
    return;
  }

  const table = el("div", { className: "admin-table" });
  users.forEach((u) => {
    const stageSelect = el("select", {}, Object.entries(STAGES).map(([key, val]) =>
      el("option", { text: val.label, attrs: u.stage === key ? { value: key, selected: "selected" } : { value: key } })
    ));
    const saveBtn = el("button", { className: "btn btn-primary btn-sm", text: "حفظ", attrs: { type: "button" } });
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        await updateUserStage(u.id, stageSelect.value);
        toastFn(`تم تحديث مرحلة ${u.display_name || "المستخدم"}`);
      } catch (err) {
        toastFn(err.message, "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    const row = el("div", { className: "admin-table-row" }, [
      el("div", { className: "admin-row-main" }, [
        el("strong", { text: u.display_name || "بدون اسم" }),
        el("span", { className: "admin-row-meta", text: `${u.gender === "female" ? "أنثى" : "ذكر"}${u.is_supervisor ? " · مشرف" : ""}` }),
      ]),
      el("div", { className: "admin-row-actions" }, [stageSelect, saveBtn]),
    ]);
    table.appendChild(row);
  });
  body.appendChild(table);
}

// ================================================================
// 💬 إدارة الدعم الفني
// ================================================================
async function renderSupportListTab(body) {
  const [tickets, users] = await Promise.all([listAllTickets(), listUsersForPicker()]);
  body.innerHTML = "";

  const newTicketForm = el("form", { className: "admin-inline-form" });
  const userSelect = el("select", {}, users.map((u) => el("option", { text: u.display_name || "مستخدم", attrs: { value: u.id } })));
  const subjectInput = el("input", { attrs: { type: "text", placeholder: "عنوان التذكرة...", required: "required" } });
  const openBtn = el("button", { className: "btn btn-primary btn-sm", text: "فتح تذكرة للمستخدم", attrs: { type: "submit" } });
  newTicketForm.appendChild(userSelect);
  newTicketForm.appendChild(subjectInput);
  newTicketForm.appendChild(openBtn);
  body.appendChild(newTicketForm);

  newTicketForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await openTicketForUser(userSelect.value, subjectInput.value.trim());
      subjectInput.value = "";
      toastFn("تم فتح التذكرة");
      renderSupportListTab(body);
    } catch (err) {
      toastFn(err.message, "error");
    }
  });

  if (tickets.length === 0) {
    body.appendChild(el("div", { className: "empty-state" }, [el("p", { text: "لا توجد تذاكر دعم بعد." })]));
    return;
  }

  const list = el("div", { attrs: { style: "margin-top: var(--space-4);" } });
  tickets.forEach((t) => {
    const info = el("div", { attrs: { style: "cursor:pointer; flex:1;" } }, [
      el("span", { text: t.subject }),
      el("div", { className: "admin-row-meta", text: t.user_display_name }),
    ]);
    info.addEventListener("click", () => renderAdminTicketChat(body, t));

    const delBtn = el("button", { className: "btn btn-outline btn-sm admin-danger-btn", text: "حذف", attrs: { type: "button" } });
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`هل تريد حذف تذكرة "${t.subject}" نهائياً؟`)) return;
      try {
        await deleteTicket(t.id);
        toastFn("تم حذف التذكرة");
        renderSupportListTab(body);
      } catch (err) {
        toastFn(err.message, "error");
      }
    });

    const item = el("div", { className: "ticket-item" }, [
      info,
      el("span", { className: `ticket-status ${t.status}`, text: t.status === "open" ? "مفتوحة" : "مغلقة" }),
      delBtn,
    ]);
    list.appendChild(item);
  });
  body.appendChild(list);
}

async function renderAdminTicketChat(body, ticket) {
  body.innerHTML = "";

  const backBtn = el("button", { className: "btn btn-outline btn-sm", text: "→ رجوع لكل التذاكر", attrs: { type: "button" } });
  backBtn.addEventListener("click", () => renderSupportListTab(body));
  body.appendChild(backBtn);

  body.appendChild(
    el("div", { attrs: { style: "display:flex; align-items:center; justify-content:space-between; margin: var(--space-4) 0;" } }, [
      el("h3", { text: `${ticket.subject} — ${ticket.user_display_name}` }),
      el("span", { className: `ticket-status ${ticket.status}`, text: ticket.status === "open" ? "مفتوحة" : "مغلقة" }),
    ])
  );

  const closeBtn = el("button", {
    className: "btn btn-outline btn-sm",
    text: ticket.status === "open" ? "إغلاق التذكرة" : "إعادة فتح التذكرة",
    attrs: { type: "button" },
  });
  closeBtn.addEventListener("click", async () => {
    try {
      await setTicketStatus(ticket.id, ticket.status === "open" ? "closed" : "open");
      ticket.status = ticket.status === "open" ? "closed" : "open";
      toastFn("تم تحديث حالة التذكرة");
      renderAdminTicketChat(body, ticket);
    } catch (err) {
      toastFn(err.message, "error");
    }
  });
  body.appendChild(closeBtn);

  const deleteBtn = el("button", {
    className: "btn btn-outline btn-sm admin-danger-btn",
    text: "حذف التذكرة نهائياً",
    attrs: { type: "button", style: "margin-inline-start: var(--space-2);" },
  });
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`هل تريد حذف تذكرة "${ticket.subject}" نهائياً؟`)) return;
    try {
      await deleteTicket(ticket.id);
      toastFn("تم حذف التذكرة");
      renderSupportListTab(body);
    } catch (err) {
      toastFn(err.message, "error");
    }
  });
  body.appendChild(deleteBtn);

  const thread = el("div", { className: "chat-thread", attrs: { style: "margin-top: var(--space-4);" } });
  body.appendChild(thread);

  function appendBubble(msg) {
    const isMe = msg.sender_id === state.session.user.id;
    thread.appendChild(el("div", { className: `chat-bubble ${isMe ? "me" : "them"}`, text: msg.message }));
    thread.scrollTop = thread.scrollHeight;
  }

  try {
    const messages = await listMessages(ticket.id);
    messages.forEach(appendBubble);
    thread.scrollTop = thread.scrollHeight;
  } catch (err) {
    toastFn(err.message, "error");
  }

  if (adminTicketUnsubscribe) adminTicketUnsubscribe();
  adminTicketUnsubscribe = subscribeToTicket(ticket.id, appendBubble);

  const form = el("form", { attrs: { style: "display:flex; gap: var(--space-2); margin-top: var(--space-3);" } });
  const input = el("input", { attrs: { type: "text", placeholder: "اكتب ردك...", required: "required", style: "flex:1; padding:12px 14px; border:1.5px solid var(--color-border); border-radius: var(--radius-sm);" } });
  const sendBtn = el("button", { className: "btn btn-primary", text: "إرسال", attrs: { type: "submit" } });
  form.appendChild(input);
  form.appendChild(sendBtn);
  body.appendChild(form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await sendMessage(ticket.id, text);
      if (!ticket.supervisor_id) {
        await assignTicketToSupervisor(ticket.id, state.session.user.id);
        ticket.supervisor_id = state.session.user.id;
      }
    } catch (err) {
      toastFn(err.message, "error");
    }
  });
}

// ================================================================
// 📤 تصدير البيانات
// ================================================================
async function renderExportTab(body) {
  body.innerHTML = "";
  body.appendChild(
    el("p", {
      className: "admin-hint",
      text: "تصدير بيانات الجداول كملفات CSV (لفتحها في Excel) أو نسخة احتياطية كاملة بصيغة JSON. ملاحظة: جدول المذكرات (journal_entries) خاص تماماً ولا يمكن للمشرف الوصول إليه، لذلك غير متاح للتصدير.",
    })
  );

  const items = [
    { label: "المستخدمون (profiles)", filename: "profiles.csv", loader: exportUsers },
    { label: "الدروس (contents)", filename: "contents.csv", loader: exportLessons },
    { label: "فقرات الدروس (content_sections)", filename: "content_sections.csv", loader: exportSections },
    { label: "روابط ووسائط الدروس (content_media)", filename: "content_media.csv", loader: exportMedia },
    { label: "تقدّم المستخدمين (user_progress)", filename: "user_progress.csv", loader: exportProgress },
    { label: "تذاكر الدعم (support_tickets)", filename: "support_tickets.csv", loader: exportTickets },
    { label: "رسائل التذاكر (ticket_messages)", filename: "ticket_messages.csv", loader: exportTicketMessages },
  ];

  const grid = el("div", { className: "admin-export-grid" });
  items.forEach((item) => {
    const btn = el("button", { className: "btn btn-outline btn-sm", text: `تصدير: ${item.label}`, attrs: { type: "button" } });
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const rows = await item.loader();
        if (rows.length === 0) {
          toastFn("لا توجد بيانات لتصديرها في هذا الجدول");
        } else {
          downloadCsv(item.filename, rows);
          toastFn("تم تصدير الملف بنجاح");
        }
      } catch (err) {
        toastFn(err.message, "error");
      } finally {
        btn.disabled = false;
      }
    });
    grid.appendChild(btn);
  });
  body.appendChild(grid);

  const backupBtn = el("button", {
    className: "btn btn-primary",
    text: "⬇️ تنزيل نسخة احتياطية كاملة (JSON)",
    attrs: { type: "button", style: "margin-top: var(--space-5);" },
  });
  backupBtn.addEventListener("click", async () => {
    backupBtn.disabled = true;
    try {
      const backup = await exportFullBackup();
      downloadJson(`backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
      toastFn("تم تنزيل النسخة الاحتياطية");
    } catch (err) {
      toastFn(err.message, "error");
    } finally {
      backupBtn.disabled = false;
    }
  });
  body.appendChild(backupBtn);
}

/** يُستدعى عند مغادرة مسار الإدارة لإيقاف اشتراك Realtime إن وجد */
export function teardownAdmin() {
  if (adminTicketUnsubscribe) {
    adminTicketUnsubscribe();
    adminTicketUnsubscribe = null;
  }
}
