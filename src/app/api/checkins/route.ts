import { apiErrorResponse, ApiError, requireRole, getClientIp, logAudit } from "@/lib/server/supabase-admin";
import { todayInBrasilia } from "@/lib/brazil-date";

const recentLocks = new Map<string, number>();

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function todayDate() {
  return todayInBrasilia(); // Data no fuso de Brasília (UTC-3)
}

function paymentPriority(status?: string | null) {
  if (status === "paid") return 3;
  if (status === "pending") return 2;
  if (status === "expired") return 1;
  return 0;
}

function newestTimestamp(row: { due_date?: string | null; created_at?: string | null; paid_at?: string | null }) {
  return `${row.due_date || ""}|${row.paid_at || ""}|${row.created_at || ""}`;
}

async function resolveCurrentEnrollment(admin: any, studentId: string) {
  const today = todayDate();
  const { data: enrollments } = await admin
    .from("enrollments")
    .select("*, plan:plans(id, name, weekly_limit, duration_days, price)")
    .eq("student_id", studentId)
    .in("status", ["active", "suspended"])
    .order("created_at", { ascending: false });

  const rows = enrollments ?? [];
  const expired = rows.filter((item: any) => item.status === "active" && item.end_date && item.end_date < today);
  if (expired.length) {
    await admin.from("enrollments").update({ status: "expired" }).in("id", expired.map((item: any) => item.id));
  }

  const current = rows
    .filter((item: any) => item.status === "active" && (!item.end_date || item.end_date >= today))
    .sort((a: any, b: any) => {
      const dateCompare = String(b.start_date || "").localeCompare(String(a.start_date || ""));
      return dateCompare || String(b.created_at || "").localeCompare(String(a.created_at || ""));
    })[0] ?? null;

  const staleActiveIds = rows
    .filter((item: any) => item.status === "active" && item.id !== current?.id)
    .map((item: any) => item.id);
  if (staleActiveIds.length) {
    await admin.from("enrollments").update({ status: "cancelled" }).in("id", staleActiveIds);
    await admin
      .from("payments")
      .update({ status: "cancelled", method: null, paid_at: null })
      .in("enrollment_id", staleActiveIds)
      .in("status", ["pending", "expired"]);
  }

  return current;
}

async function resolveCurrentPayment(admin: any, enrollmentId: string) {
  const { data: payments } = await admin
    .from("payments")
    .select("*")
    .eq("enrollment_id", enrollmentId)
    .order("due_date", { ascending: false })
    .order("created_at", { ascending: false });

  const rows = payments ?? [];
  const operational = rows
    .filter((item: any) => ["paid", "pending", "expired"].includes(String(item.status)))
    .sort((a: any, b: any) => {
      const dateCompare = newestTimestamp(b).localeCompare(newestTimestamp(a));
      return dateCompare || paymentPriority(b.status) - paymentPriority(a.status);
    });

  return operational[0] ?? rows[0] ?? null;
}

export async function POST(request: Request) {
  try {
    const { admin, profile: operator } = await requireRole(request, ["admin", "receptionist", "professor"]);
    const ip = getClientIp(request);
    const body = await request.json() as { code?: unknown; unit?: unknown; manualName?: unknown };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const manualName = typeof body.manualName === "string" ? body.manualName.trim().slice(0, 120) : "";
    const unit = typeof body.unit === "string" && body.unit.trim() ? body.unit.trim().slice(0, 100) : "Matriz";
    if (manualName) {
      if (!["admin", "receptionist"].includes(String(operator.role))) {
        throw new ApiError("Apenas administradores e recepcionistas podem liberar manualmente.", 403);
      }

      const reason = `Liberacao manual para ${manualName} pela recepcao.`;
      const { data: checkin, error } = await admin.from("checkins").insert({
        student_id: null,
        enrollment_id: null,
        status: "allowed",
        reason,
        unit,
      }).select("*").single();
      if (error || !checkin) throw new ApiError("Nao foi possivel registrar a liberacao manual.", 500);

      await logAudit(admin, {
        userId: operator.id,
        action: "INSERT",
        entity: "checkins",
        entityId: checkin.id,
        details: {
          manual_name: manualName,
          status: checkin.status,
          reason,
        },
        ip,
      });

      return Response.json({
        ...checkin,
        student: { id: "manual", full_name: manualName },
        enrollment: null,
        payment: null,
        duplicate: false,
        manual: true,
      }, { status: 201 });
    }

    if (!code) throw new ApiError("Informe o codigo do aluno.");

    let studentQuery = await admin.from("students").select("*").eq("qr_code", code).maybeSingle();
    if (!studentQuery.data && isUuid(code)) studentQuery = await admin.from("students").select("*").eq("id", code).maybeSingle();
    const student = studentQuery.data;

    const enrollment = student ? await resolveCurrentEnrollment(admin, student.id) : null;
    const payment = enrollment ? await resolveCurrentPayment(admin, enrollment.id) : null;
    const { data: currentContract } = enrollment
      ? await admin
          .from("contracts")
          .select("id, status, created_at")
          .eq("enrollment_id", enrollment.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    const today = todayDate();
    const enrollmentExpired = Boolean(enrollment?.end_date && enrollment.end_date < today);
    const paymentPending = payment?.status === "pending";
    const paymentOverdue = Boolean(paymentPending && payment?.due_date && payment.due_date < today);

    if (enrollment?.id && enrollmentExpired) {
      await admin.from("enrollments").update({ status: "expired" }).eq("id", enrollment.id);
    }

    if (payment?.id && paymentOverdue) {
      await admin.from("payments").update({ status: "expired" }).eq("id", payment.id);
      payment.status = "expired";
    }

    let reason = !student
      ? "Codigo nao encontrado."
      : student.status !== "active"
        ? "Aluno inativo ou bloqueado."
        : !enrollment
          ? "Aluno sem matricula ativa."
          : enrollmentExpired
            ? "Matricula expirada. Renove o plano antes de liberar a catraca."
            : !payment
              ? "Nenhum pagamento encontrado para esta matricula. Regularize na recepcao."
              : payment.status === "expired"
                ? "Pagamento expirado ou vencido. Acesso bloqueado ate regularizacao."
                : payment.status === "pending"
                  ? "Pagamento pendente. Receba o pagamento na recepcao antes de liberar a catraca."
                  : payment.status !== "paid"
                    ? "Pagamento nao confirmado. Acesso bloqueado."
                    : !currentContract || currentContract.status !== "signed"
                      ? "Contrato pendente de assinatura. Assine no portal antes de liberar a catraca."
                    : null;

    let allowed = !reason;

    if (allowed && student) {
      const todayDateStr = todayDate();
      
      // 1. Validate Max 2 checkins per day
      const { count: checkinsToday } = await admin.from("checkins")
        .select("*", { count: "exact", head: true })
        .eq("student_id", student.id)
        .eq("status", "allowed")
        .gte("checked_at", `${todayDateStr}T00:00:00.000Z`)
        .lte("checked_at", `${todayDateStr}T23:59:59.999Z`);
        
      if (checkinsToday !== null && checkinsToday >= 2) {
        allowed = false;
        reason = "Limite diario atingido. Permitido no maximo 2 check-ins por dia.";
      }
      
      // Aula confirmada no portal nao bloqueia a catraca. A regra de acesso fica em matricula e pagamento.
    }

    if (allowed && student) {
      const windowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recent } = await admin.from("checkins")
        .select("*")
        .eq("student_id", student.id)
        .eq("status", "allowed")
        .gte("checked_at", windowStart)
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lockUntil = recentLocks.get(student.id) || 0;
      if (recent || lockUntil > Date.now()) {
        const existing = recent || { id: `duplicate-${student.id}`, student_id: student.id, enrollment_id: enrollment?.id, status: "allowed", unit, checked_at: new Date().toISOString() };
        return Response.json({
          ...existing,
          student,
          enrollment,
          payment,
          duplicate: true,
          reason: "Check-in ja confirmado nos ultimos 5 minutos. Nenhum novo registro foi criado.",
        });
      }
      recentLocks.set(student.id, Date.now() + 5 * 60 * 1000);
    }

    // Reason is already populated above

    const { data: checkin, error } = await admin.from("checkins").insert({
      student_id: student?.id || null,
      enrollment_id: enrollment?.id || null,
      status: allowed ? "allowed" : "denied",
      reason,
      unit,
    }).select("*").single();
    if (error || !checkin) {
      if (student) recentLocks.delete(student.id);
      throw new ApiError("Nao foi possivel registrar o check-in.", 500);
    }

    // Audit log
    await logAudit(admin, {
      userId: operator.id,
      action: "INSERT",
      entity: "checkins",
      entityId: checkin.id,
      details: {
        student_name: student?.full_name || "Desconhecido",
        status: checkin.status,
        reason: checkin.reason,
      },
      ip,
    });

    return Response.json({ ...checkin, student, enrollment, payment, duplicate: false }, { status: 201 });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}
