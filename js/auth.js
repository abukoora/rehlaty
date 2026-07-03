import { supabase } from "./supabaseClient.js";
import { state, notify } from "./state.js";
import { friendlyError } from "./utils/sanitize.js";

export async function signUp({ email, password, displayName, gender }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName, gender }, // يلتقطها trigger handle_new_user
    },
  });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  notify();
}

export async function loadProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw new Error(friendlyError(error));
  state.profile = data;
  notify();
  return data;
}

export async function updateProfileStage(newStage) {
  const { error } = await supabase
    .from("profiles")
    .update({ stage: newStage })
    .eq("id", state.session.user.id);
  if (error) throw new Error(friendlyError(error));
  state.profile.stage = newStage;
  notify();
}

export async function updateProfileName(newName) {
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: newName })
    .eq("id", state.session.user.id);
  if (error) throw new Error(friendlyError(error));
  state.profile.display_name = newName;
  notify();
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/#reset-password`,
  });
  if (error) throw new Error(friendlyError(error));
}

/** يراقب حالة الجلسة تلقائياً (تسجيل دخول/خروج) */
export function initAuthListener(onChange) {
  supabase.auth.getSession().then(({ data }) => {
    state.session = data.session;
    onChange(state.session);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    onChange(session);
  });
}
