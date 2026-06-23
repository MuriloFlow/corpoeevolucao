import "server-only";

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/server/supabase-admin";

type StudentIdentity = {
  id: string;
  full_name: string;
  email: string | null;
  profile_id: string | null;
};

type ContractPlan = { name?: string | null } | { name?: string | null }[] | null;

export type PendingContractInfo = {
  id: string;
  planName: string;
  created: boolean;
};

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function resolveAppOrigin(request: Request) {
  let origin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (!origin && process.env.VERCEL_URL) origin = `https://${process.env.VERCEL_URL}`;
  if (!origin) origin = new URL(request.url).origin;
  if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
    origin = "https://corpoeevolucao.vercel.app";
  }
  return origin.replace(/\/+$/, "");
}

function readPlanName(plan: ContractPlan, fallback = "Plano contratado") {
  const resolved = Array.isArray(plan) ? plan[0] : plan;
  return resolved?.name || fallback;
}

export async function ensureStudentPortalAccount(admin: SupabaseClient, student: StudentIdentity) {
  if (!student.email) throw new ApiError("Cadastre o e-mail do aluno antes de liberar o portal.", 400);

  let profileId = student.profile_id;
  if (profileId) return { profileId, created: false };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: student.email,
    email_confirm: true,
    user_metadata: { full_name: student.full_name },
  });
  if (created.user) profileId = created.user.id;
  if (createError && !createError.message.toLowerCase().includes("already")) throw createError;

  if (!profileId) {
    const { data: existing } = await admin.from("profiles").select("id").eq("email", student.email).single();
    profileId = existing?.id || null;
  }
  if (!profileId) throw new ApiError("Nao foi possivel vincular o aluno ao portal.", 500);

  await admin.from("profiles").update({ role: "student", active: true, full_name: student.full_name }).eq("id", profileId);
  await admin.from("students").update({ profile_id: profileId }).eq("id", student.id);
  return { profileId, created: true };
}

export async function createPasswordSetupLink(admin: SupabaseClient, email: string, origin: string, nextUrl?: string | null) {
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${origin}/reset-password` },
  });
  if (linkError || !linkData.properties) {
    throw new ApiError("Nao foi possivel gerar o link de criacao de senha.", 500);
  }

  const actionUrl = linkData.properties.action_link ? new URL(linkData.properties.action_link) : null;
  const token =
    linkData.properties.hashed_token ||
    actionUrl?.searchParams.get("token") ||
    actionUrl?.searchParams.get("token_hash");
  if (!token) throw new ApiError("Nao foi possivel gerar o token de criacao de senha.", 500);

  const resetUrl = new URL(`${origin}/reset-password`);
  resetUrl.searchParams.set("token", token);
  if (nextUrl) resetUrl.searchParams.set("next", nextUrl);
  return resetUrl.toString();
}

export async function ensurePendingContractForStudent(admin: SupabaseClient, studentId: string): Promise<PendingContractInfo | null> {
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id, plan_id, plan:plans(name)")
    .eq("student_id", studentId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!enrollment) return null;

  await admin
    .from("contracts")
    .update({ status: "cancelled" })
    .eq("student_id", studentId)
    .eq("status", "pending")
    .neq("enrollment_id", enrollment.id);

  const { data: existingContract } = await admin
    .from("contracts")
    .select("id, status, plan:plans(name)")
    .eq("enrollment_id", enrollment.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingContract?.status === "pending") {
    return {
      id: existingContract.id,
      planName: readPlanName(existingContract.plan, readPlanName(enrollment.plan)),
      created: false,
    };
  }
  if (existingContract?.status === "signed") return null;

  const planName = readPlanName(enrollment.plan);
  const { data: createdContract, error: createError } = await admin
    .from("contracts")
    .insert({
      student_id: studentId,
      plan_id: enrollment.plan_id,
      enrollment_id: enrollment.id,
      document_text: `Termo de adesao ao plano ${planName}.`,
      status: "pending",
      signed_at: null,
    })
    .select("id")
    .single();

  if (createError || !createdContract) {
    throw new ApiError("Nao foi possivel gerar o contrato pendente do aluno.", 500);
  }

  return {
    id: createdContract.id,
    planName,
    created: true,
  };
}

export async function createContractSigningLink(admin: SupabaseClient, contractId: string, origin: string) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await admin.from("contract_signing_requests").update({ used_at: new Date().toISOString() }).eq("contract_id", contractId).is("used_at", null);
  const { data: signingRequest, error: signingError } = await admin
    .from("contract_signing_requests")
    .insert({ contract_id: contractId, token_hash: hashToken(rawToken), expires_at: expiresAt })
    .select("id")
    .single();
  if (signingError || !signingRequest) {
    throw new ApiError("A migracao operacional ainda nao foi aplicada. Execute database/migrations/002_studio_operations.sql.", 503);
  }

  return `${origin}/assinar/${rawToken}`;
}
