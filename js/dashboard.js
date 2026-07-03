import { supabase } from "./supabaseClient.js";
import { state, notify, STAGES, completionPercent } from "./state.js";
import { friendlyError } from "./utils/sanitize.js";

/** يجلب محتوى المرحلة الحالية فقط (فلترة يدوية إلزامية رغم أن RLS تسمح بالكل) */
export async function loadContents() {
  const stage = state.profile.stage;
  const gender = state.profile.gender;

  const { data, error } = await supabase
    .from("contents")
    .select("*")
    .eq("stage", stage)
    .in("gender", [gender, "both"])
    .order("order", { ascending: true });

  if (error) throw new Error(friendlyError(error));
  state.contents = data || [];
  notify();
  return state.contents;
}

export async function loadProgress() {
  const { data, error } = await supabase
    .from("user_progress")
    .select("content_id")
    .eq("user_id", state.session.user.id);

  if (error) throw new Error(friendlyError(error));
  state.progressByContentId = new Map(data.map((r) => [r.content_id, true]));
  notify();
}

export async function markComplete(contentId) {
  const { error } = await supabase
    .from("user_progress")
    .upsert(
      { user_id: state.session.user.id, content_id: contentId, completed: true },
      { onConflict: "user_id,content_id" }
    );
  if (error) throw new Error(friendlyError(error));
  state.progressByContentId.set(contentId, true);
  notify();
}

/** يجلب فقرات ووسائط درس معيّن (تُعرض داخل صفحة الدرس بعد النص الأساسي) */
export async function loadLessonDetails(contentId) {
  const [sectionsRes, mediaRes] = await Promise.all([
    supabase.from("content_sections").select("*").eq("content_id", contentId).order("order", { ascending: true }),
    supabase.from("content_media").select("*").eq("content_id", contentId).order("order", { ascending: true }),
  ]);
  if (sectionsRes.error) throw new Error(friendlyError(sectionsRes.error));
  if (mediaRes.error) throw new Error(friendlyError(mediaRes.error));
  return { sections: sectionsRes.data || [], media: mediaRes.data || [] };
}

export function getStageLabel(stageKey) {
  return STAGES[stageKey]?.label || stageKey;
}

export function getProgressSummary() {
  return {
    percent: completionPercent(),
    total: state.contents.length,
    done: state.contents.filter((c) => state.progressByContentId.has(c.id)).length,
  };
}
