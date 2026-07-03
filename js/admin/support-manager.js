import { supabase } from "../supabaseClient.js";
import { friendlyError } from "../utils/sanitize.js";

/** كل التذاكر مع اسم صاحب كل تذكرة (المشرف يرى الكل عبر RLS) */
export async function listAllTickets() {
  const { data: tickets, error } = await supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyError(error));

  const userIds = [...new Set(tickets.map((t) => t.user_id))];
  if (userIds.length === 0) return tickets;

  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  if (profErr) throw new Error(friendlyError(profErr));

  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  return tickets.map((t) => ({ ...t, user_display_name: nameById.get(t.user_id) || "مستخدم" }));
}

/** جميع المستخدمين (لاختيار من سيُفتح له تذكرة) */
export async function listUsersForPicker() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** المشرف يفتح تذكرة دعم نيابةً عن مستخدم */
export async function openTicketForUser(userId, subject) {
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({ user_id: userId, subject })
    .select()
    .single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** ربط التذكرة بالمشرف الحالي (يتم تلقائياً عند أول رد) */
export async function assignTicketToSupervisor(ticketId, supervisorId) {
  const { error } = await supabase
    .from("support_tickets")
    .update({ supervisor_id: supervisorId })
    .eq("id", ticketId);
  if (error) throw new Error(friendlyError(error));
}

export async function setTicketStatus(ticketId, status) {
  const { error } = await supabase.from("support_tickets").update({ status }).eq("id", ticketId);
  if (error) throw new Error(friendlyError(error));
}

/** حذف نهائي للتذكرة وكل رسائلها (ON DELETE CASCADE) */
export async function deleteTicket(ticketId) {
  const { error } = await supabase.from("support_tickets").delete().eq("id", ticketId);
  if (error) throw new Error(friendlyError(error));
}
