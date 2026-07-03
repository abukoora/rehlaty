import { supabase } from "../supabaseClient.js";
import { friendlyError } from "../utils/sanitize.js";

// ---------------------------------------------------------------
// أدوات التصدير العامة
// ---------------------------------------------------------------
function toCsv(rows) {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    const clean = s.replace(/"/g, '""');
    return /[",\n]/.test(clean) ? `"${clean}"` : clean;
  };
  const lines = [headers.join(",")];
  rows.forEach((r) => lines.push(headers.map((h) => escapeCell(r[h])).join(",")));
  return lines.join("\n");
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename, rows) {
  const csv = toCsv(rows);
  triggerDownload(filename, new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
}

export function downloadJson(filename, data) {
  triggerDownload(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8;" }));
}

// ---------------------------------------------------------------
// جلب الجداول (متاحة للمشرف عبر RLS)
// ملاحظة: journal_entries مستثناة عمداً — خاصة تماماً حتى عن المشرف
// ---------------------------------------------------------------
async function fetchAll(table, orderCol) {
  let query = supabase.from(table).select("*");
  if (orderCol) query = query.order(orderCol, { ascending: true });
  const { data, error } = await query;
  if (error) throw new Error(friendlyError(error));
  return data || [];
}

export const exportUsers = () => fetchAll("profiles", "created_at");
export const exportLessons = () => fetchAll("contents", "id");
export const exportSections = () => fetchAll("content_sections", "content_id");
export const exportMedia = () => fetchAll("content_media", "content_id");
export const exportProgress = () => fetchAll("user_progress", "id");
export const exportTickets = () => fetchAll("support_tickets", "created_at");
export const exportTicketMessages = () => fetchAll("ticket_messages", "created_at");

/** نسخة احتياطية كاملة (JSON) لكل الجداول المتاحة للمشرف في ملف واحد */
export async function exportFullBackup() {
  const [users, lessons, sections, media, progress, tickets, messages] = await Promise.all([
    exportUsers(),
    exportLessons(),
    exportSections(),
    exportMedia(),
    exportProgress(),
    exportTickets(),
    exportTicketMessages(),
  ]);
  return {
    exported_at: new Date().toISOString(),
    profiles: users,
    contents: lessons,
    content_sections: sections,
    content_media: media,
    user_progress: progress,
    support_tickets: tickets,
    ticket_messages: messages,
  };
}
