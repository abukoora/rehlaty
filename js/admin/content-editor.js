import { supabase } from "../supabaseClient.js";
import { friendlyError } from "../utils/sanitize.js";

// ---------------------------------------------------------------
// الدروس (contents)
// ---------------------------------------------------------------
export async function listAllContents() {
  const { data, error } = await supabase
    .from("contents")
    .select("*")
    .order("stage", { ascending: true })
    .order("order", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function getContent(id) {
  const { data, error } = await supabase.from("contents").select("*").eq("id", id).single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** ينشئ درساً جديداً أو يحدّث درساً موجوداً حسب وجود id */
export async function saveContent(payload) {
  const { data, error } = await supabase.from("contents").upsert(payload).select().single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function deleteContent(id) {
  const { error } = await supabase.from("contents").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
}

// ---------------------------------------------------------------
// فقرات/عناوين الدرس (content_sections)
// ---------------------------------------------------------------
export async function listSections(contentId) {
  const { data, error } = await supabase
    .from("content_sections")
    .select("*")
    .eq("content_id", contentId)
    .order("order", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function saveSection(payload) {
  const { data, error } = await supabase.from("content_sections").upsert(payload).select().single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function deleteSection(id) {
  const { error } = await supabase.from("content_sections").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
}

// ---------------------------------------------------------------
// روابط ووسائط الدرس (content_media)
// ---------------------------------------------------------------
export async function listMedia(contentId) {
  const { data, error } = await supabase
    .from("content_media")
    .select("*")
    .eq("content_id", contentId)
    .order("order", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function saveMedia(payload) {
  const { data, error } = await supabase.from("content_media").upsert(payload).select().single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function deleteMedia(id) {
  const { error } = await supabase.from("content_media").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error));
}
