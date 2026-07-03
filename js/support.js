import { supabase } from "./supabaseClient.js";
import { state } from "./state.js";
import { friendlyError } from "./utils/sanitize.js";

export async function listTickets() {
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .eq("user_id", state.session.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function createTicket(subject) {
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({ user_id: state.session.user.id, subject })
    .select()
    .single();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function listMessages(ticketId) {
  const { data, error } = await supabase
    .from("ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function sendMessage(ticketId, message) {
  const { error } = await supabase.from("ticket_messages").insert({
    ticket_id: ticketId,
    sender_id: state.session.user.id,
    message,
  });
  if (error) throw new Error(friendlyError(error));
}

/** يشترك في الرسائل الجديدة لحظياً عبر Supabase Realtime */
export function subscribeToTicket(ticketId, onNewMessage) {
  const channel = supabase
    .channel(`ticket-${ticketId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "ticket_messages", filter: `ticket_id=eq.${ticketId}` },
      (payload) => onNewMessage(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
