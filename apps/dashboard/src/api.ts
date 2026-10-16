import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { projectOrigin, type MemoryRow, type Membership, type Role } from "./model";

// Всички заявки към базата. Правилата за достъп (RLS) решават кой какво вижда:
// таблото само показва; дори грешка тук не може да покаже чужди данни.

export interface MeetingRow {
  id: string;
  meeting_code: string;
  started_at: string;
  saved_at: string;
  lines: { speaker: "owner" | "counterpart"; text: string; at: number }[];
}

export interface ProposalRow {
  id: string;
  subject: string;
  fact: string;
  quote: string | null;
  meeting_id: string | null;
  created_at: string;
}

export interface MemberRow {
  user_id: string;
  role: Role;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  created_at: string;
}

const url = projectOrigin(__SUPABASE_URL__);
export const configured = url !== "" && __SUPABASE_KEY__.startsWith("sb_publishable_");
export const supabase: SupabaseClient | null = configured ? createClient(url, __SUPABASE_KEY__) : null;

function db(): SupabaseClient {
  if (!supabase) throw new Error("Таблото не е настроено (.env: SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY).");
  return supabase;
}

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function sendLoginLink(email: string): Promise<void> {
  const { error } = await db().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await db().auth.signOut();
}

/** Фирмите на влезлия, след като приеме чакащите покани. */
export async function myMemberships(userId: string): Promise<Membership[]> {
  await db().rpc("accept_invitations");
  const rows = check(
    await db().from("members").select("org_id, role, orgs(name, retention_days)").eq("user_id", userId),
  ) as unknown as { org_id: string; role: Role; orgs: { name: string; retention_days: number } | null }[];
  return rows.map((r) => ({ orgId: r.org_id, role: r.role, orgName: r.orgs?.name ?? "", retentionDays: r.orgs?.retention_days ?? 30 }));
}

export async function createOrg(name: string): Promise<void> {
  check(await db().rpc("create_org", { org_name: name.trim() }));
}

export async function purgeExpired(): Promise<number> {
  return (check(await db().rpc("purge_expired_meetings")) as number) ?? 0;
}

export async function counts(orgId: string): Promise<{ meetings: number; proposals: number; memories: number }> {
  const count = async (table: string, extra?: (q: any) => any) => {
    let query = db().from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
    if (extra) query = extra(query);
    const { count: n, error } = await query;
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const [meetings, proposals, memories] = await Promise.all([
    count("meetings"),
    count("memory_proposals", (q) => q.eq("status", "pending")),
    count("memories"),
  ]);
  return { meetings, proposals, memories };
}

export async function listMeetings(orgId: string, limit = 100): Promise<MeetingRow[]> {
  return check(
    await db().from("meetings").select("id, meeting_code, started_at, saved_at, lines").eq("org_id", orgId).order("saved_at", { ascending: false }).limit(limit),
  ) as MeetingRow[];
}

export async function deleteMeeting(id: string): Promise<void> {
  check(await db().from("meetings").delete().eq("id", id));
}

export async function listProposals(orgId: string): Promise<ProposalRow[]> {
  return check(
    await db().from("memory_proposals").select("id, subject, fact, quote, meeting_id, created_at").eq("org_id", orgId).eq("status", "pending").order("created_at"),
  ) as ProposalRow[];
}

/** „Запомни“: фактът (по избор поправен) влиза в паметта, предложението се отбелязва. */
export async function approveProposal(orgId: string, proposal: ProposalRow, userId: string, fact = proposal.fact, subject = proposal.subject): Promise<void> {
  check(
    await db().from("memories").insert({ org_id: orgId, subject: subject.trim(), fact: fact.trim(), source_meeting_id: proposal.meeting_id, approved_by: userId }),
  );
  check(await db().from("memory_proposals").update({ status: "approved", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", proposal.id));
}

export async function rejectProposal(proposalId: string, userId: string): Promise<void> {
  check(await db().from("memory_proposals").update({ status: "rejected", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", proposalId));
}

export async function listMemories(orgId: string): Promise<MemoryRow[]> {
  return check(
    await db().from("memories").select("id, subject, fact, approved_at, source_meeting_id").eq("org_id", orgId).order("approved_at", { ascending: false }),
  ) as MemoryRow[];
}

export async function addMemory(orgId: string, subject: string, fact: string, userId: string): Promise<void> {
  check(await db().from("memories").insert({ org_id: orgId, subject: subject.trim(), fact: fact.trim(), approved_by: userId }));
}

export async function updateMemory(id: string, fact: string): Promise<void> {
  check(await db().from("memories").update({ fact: fact.trim() }).eq("id", id));
}

export async function deleteMemory(id: string): Promise<void> {
  check(await db().from("memories").delete().eq("id", id));
}

/** GDPR: всичко запомнено за един човек или фирма (паметта и чакащите предложения). */
export async function forgetSubject(orgId: string, subject: string): Promise<void> {
  check(await db().from("memories").delete().eq("org_id", orgId).eq("subject", subject));
  check(await db().from("memory_proposals").delete().eq("org_id", orgId).eq("subject", subject));
}

export async function setRetention(orgId: string, days: number): Promise<void> {
  check(await db().from("orgs").update({ retention_days: days }).eq("id", orgId));
}

export async function listMembers(orgId: string): Promise<MemberRow[]> {
  return check(await db().from("members").select("user_id, role, created_at").eq("org_id", orgId).order("created_at")) as MemberRow[];
}

export async function listInvitations(orgId: string): Promise<InvitationRow[]> {
  return check(await db().from("invitations").select("id, email, role, created_at").eq("org_id", orgId).order("created_at")) as InvitationRow[];
}

export async function invite(orgId: string, email: string, role: Role, userId: string): Promise<void> {
  check(await db().from("invitations").insert({ org_id: orgId, email: email.trim().toLowerCase(), role, invited_by: userId }));
}

export async function cancelInvitation(id: string): Promise<void> {
  check(await db().from("invitations").delete().eq("id", id));
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  check(await db().from("members").delete().eq("org_id", orgId).eq("user_id", userId));
}
