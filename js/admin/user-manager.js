import { supabase } from "../supabaseClient.js";
import { friendlyError } from "../utils/sanitize.js";

export async function listUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function updateUserStage(userId, stage) {
  const { error } = await supabase.from("profiles").update({ stage }).eq("id", userId);
  if (error) throw new Error(friendlyError(error));
}
