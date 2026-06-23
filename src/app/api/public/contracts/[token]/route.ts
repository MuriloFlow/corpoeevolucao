import crypto from "node:crypto";
import { apiErrorResponse, ApiError, getAdminClient } from "@/lib/server/supabase-admin";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadSigningRequest(token: string) {
  const admin = getAdminClient();
  const { data: signing, error } = await admin
    .from("contract_signing_requests")
    .select("id, contract_id, expires_at, used_at")
    .eq("token_hash", hashToken(token))
    .single();
  if (error || !signing) throw new ApiError("Link de assinatura inválido.", 404);
  if (signing.used_at) throw new ApiError("Este link de assinatura já foi utilizado.", 409);
  if (new Date(signing.expires_at).getTime() < Date.now()) throw new ApiError("Este link de assinatura expirou.", 410);
  return { admin, signing };
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { admin, signing } = await loadSigningRequest(token);
    const [{ data: contract }, { data: settings }] = await Promise.all([
      admin.from("contracts").select("id, status, document_text, student:students(full_name), plan:plans(name)").eq("id", signing.contract_id).single(),
      admin.from("settings").select("studio_name, contract_template_path, contract_template_name").eq("id", "studio").single(),
    ]);
    if (!contract) throw new ApiError("Contrato não encontrado.", 404);
    const student = Array.isArray(contract.student) ? contract.student[0] : contract.student;
    const plan = Array.isArray(contract.plan) ? contract.plan[0] : contract.plan;
    let documentUrl: string | null = null;
    if (settings?.contract_template_path) {
      const { data } = await admin.storage.from("contract-templates").createSignedUrl(settings.contract_template_path, 60 * 60);
      documentUrl = data?.signedUrl || null;
    }
    return Response.json({
      contract: {
        studentName: student?.full_name || "Aluno",
        planName: plan?.name || "Plano contratado",
        documentText: contract.document_text,
        documentUrl,
        documentName: settings?.contract_template_name || null,
        studioName: settings?.studio_name || "Corpo & Evolução",
        expiresAt: signing.expires_at,
      },
    });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { admin, signing } = await loadSigningRequest(token);
    const body = await request.json() as {
      cpf?: unknown;
      signature?: unknown;
      signatureImage?: unknown;
      accepted?: unknown;
      readToEnd?: unknown;
    };
    const cpf = typeof body.cpf === "string" ? body.cpf.replace(/\D/g, "") : "";
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    const signatureImage = typeof body.signatureImage === "string" ? body.signatureImage : "";
    const validSignatureImage = /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(signatureImage)
      && signatureImage.length >= 500
      && signatureImage.length <= 900_000;
    if (
      cpf.length !== 11 ||
      signature.length < 3 ||
      body.accepted !== true ||
      body.readToEnd !== true ||
      !validSignatureImage
    ) {
      throw new ApiError("Leia o contrato até o fim, confirme o CPF e faça sua assinatura na tela.", 400);
    }

    const { data: contract } = await admin.from("contracts").select("id, student:students(cpf, full_name)").eq("id", signing.contract_id).single();
    const student = Array.isArray(contract?.student) ? contract.student[0] : contract?.student;
    if (!contract || !student || student.cpf.replace(/\D/g, "") !== cpf) throw new ApiError("O CPF informado não corresponde ao titular do contrato.", 403);

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    const signedAt = new Date().toISOString();
    const signatureData = JSON.stringify({
      name: signature,
      cpfLast4: cpf.slice(-4),
      acceptedAt: signedAt,
      image: signatureImage,
      evidence: {
        readToEnd: true,
        userAgent: request.headers.get("user-agent")?.slice(0, 300) || null,
      },
    });
    const { data: signedContract, error } = await admin.from("contracts").update({ status: "signed", signed_at: signedAt, ip_address: ip, signature_data: signatureData }).eq("id", contract.id).eq("status", "pending").select("id").single();
    if (error || !signedContract) throw new ApiError("O contrato não está mais disponível para assinatura.", 409);
    await admin.from("contract_signing_requests").update({ used_at: signedAt }).eq("id", signing.id).is("used_at", null);
    return Response.json({ ok: true, signedAt });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}
