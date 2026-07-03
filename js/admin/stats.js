import { supabase } from "../supabaseClient.js";
import { friendlyError } from "../utils/sanitize.js";

/** يجلب إحصائيات لوحة تحكم المشرف: المستخدمون، الدروس المكتملة، تذاكر الدعم المفتوحة */
export async function loadAdminStats() {
  const [usersRes, completedRes, openTicketsRes, lessonsRes] = await Promise.all([
    supabase.from("profiles").select("gender"),
    supabase.from("user_progress").select("id", { count: "exact", head: true }).eq("completed", true),
    supabase.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("contents").select("id", { count: "exact", head: true }),
  ]);

  if (usersRes.error) throw new Error(friendlyError(usersRes.error));
  if (completedRes.error) throw new Error(friendlyError(completedRes.error));
  if (openTicketsRes.error) throw new Error(friendlyError(openTicketsRes.error));
  if (lessonsRes.error) throw new Error(friendlyError(lessonsRes.error));

  const males = usersRes.data.filter((p) => p.gender === "male").length;
  const females = usersRes.data.filter((p) => p.gender === "female").length;

  return {
    totalUsers: usersRes.data.length,
    males,
    females,
    completedLessons: completedRes.count ?? 0,
    openTickets: openTicketsRes.count ?? 0,
    totalLessons: lessonsRes.count ?? 0,
  };
}
