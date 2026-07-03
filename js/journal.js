import { supabase } from "./supabaseClient.js";
import { state } from "./state.js";
import { friendlyError } from "./utils/sanitize.js";

export async function listJournalEntries() {
  const { data, error } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("user_id", state.session.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function addJournalEntry({ title, body, mood }) {
  const { error } = await supabase.from("journal_entries").insert({
    user_id: state.session.user.id,
    title,
    body,
    mood,
  });
  if (error) throw new Error(friendlyError(error));
}

export async function deleteJournalEntry(id) {
  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", state.session.user.id);
  if (error) throw new Error(friendlyError(error));
}
