import { apiErrorResponse, ApiError, requireRole } from "@/lib/server/supabase-admin";
import { todayInBrasilia } from "@/lib/brazil-date";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00-03:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateDayOfWeek(date: string) {
  return new Date(`${date}T12:00:00-03:00`).getDay();
}

export async function GET(request: Request) {
  try {
    const { admin } = await requireRole(request, ["admin", "receptionist", "professor"]);
    const url = new URL(request.url);
    const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days") || 120)));
    const endDate = todayInBrasilia();
    const startDate = addDays(endDate, -(days - 1));
    const currentTime = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());

    const [
      { data: schedules, error: schedulesError },
      { data: attendances, error: attendanceError },
      { data: audits, error: auditError },
    ] = await Promise.all([
      admin
        .from("class_schedules")
        .select("*, class_type:class_types(*), instructor:profiles(id, full_name)")
        .order("time", { ascending: true }),
      admin
        .from("class_attendances")
        .select("class_schedule_id, date, status")
        .gte("date", startDate)
        .lte("date", endDate),
      admin
        .from("class_occurrence_audits")
        .select("*")
        .gte("date", startDate)
        .lte("date", endDate),
    ]);

    if (schedulesError) throw schedulesError;
    if (attendanceError) throw attendanceError;
    if (auditError) {
      throw new ApiError("A migração de auditoria de presenças ainda não foi aplicada.", 503);
    }

    const attendanceMap = new Map<string, { total: number; confirmed: number; missed: number }>();
    for (const attendance of attendances ?? []) {
      const key = `${attendance.class_schedule_id}:${attendance.date}`;
      const totals = attendanceMap.get(key) ?? { total: 0, confirmed: 0, missed: 0 };
      totals.total += 1;
      if (["confirmed", "attended"].includes(attendance.status)) totals.confirmed += 1;
      if (["cancelled", "missed"].includes(attendance.status)) totals.missed += 1;
      attendanceMap.set(key, totals);
    }

    const auditMap = new Map((audits ?? []).map((audit) => [
      `${audit.class_schedule_id}:${audit.date}`,
      audit,
    ]));
    const occurrences = [];

    for (const schedule of schedules ?? []) {
      for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
        if (dateDayOfWeek(date) !== schedule.day_of_week) continue;
        if (date === endDate && String(schedule.time || "00:00").slice(0, 5) > currentTime) continue;
        const key = `${schedule.id}:${date}`;
        const totals = attendanceMap.get(key) ?? { total: 0, confirmed: 0, missed: 0 };
        const audit = auditMap.get(key);
        occurrences.push({
          id: audit?.id,
          class_schedule_id: schedule.id,
          date,
          status: audit?.status ?? "normal",
          reason: audit?.reason ?? null,
          affected_students: audit?.affected_students ?? 0,
          audited_at: audit?.audited_at ?? null,
          audited_by: audit?.audited_by ?? null,
          class_schedule: schedule,
          attendance_total: totals.total,
          confirmed_total: totals.confirmed,
          missed_total: totals.missed,
        });
      }
    }

    occurrences.sort((a, b) =>
      `${b.date}${b.class_schedule?.time || ""}`.localeCompare(`${a.date}${a.class_schedule?.time || ""}`),
    );
    return Response.json({ occurrences });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}

export async function POST(request: Request) {
  try {
    const { admin, profile } = await requireRole(request, ["admin"]);
    const body = await request.json() as {
      classScheduleId?: unknown;
      date?: unknown;
      status?: unknown;
      reason?: unknown;
    };
    const classScheduleId = typeof body.classScheduleId === "string" ? body.classScheduleId : "";
    const date = typeof body.date === "string" ? body.date : "";
    const status = typeof body.status === "string" ? body.status : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    if (!classScheduleId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError("Aula ou data inválida.", 400);
    }
    if (!["normal", "nullified", "inactivated"].includes(status)) {
      throw new ApiError("Status de auditoria inválido.", 400);
    }
    if (status !== "normal" && reason.length < 3) {
      throw new ApiError("Informe o motivo da anulação ou inativação.", 400);
    }

    const { data, error } = await admin.rpc("audit_class_occurrence", {
      p_class_schedule_id: classScheduleId,
      p_date: date,
      p_status: status,
      p_reason: reason || null,
      p_audited_by: profile.id,
    });
    if (error) throw new ApiError(error.message, 500);
    return Response.json({ occurrence: data });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}
