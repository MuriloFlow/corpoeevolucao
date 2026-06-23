import { apiErrorResponse, ApiError, requireRole } from "@/lib/server/supabase-admin";
import { todayInBrasilia } from "@/lib/brazil-date";
import { ensureStudentAttendancesForDate } from "@/lib/server/class-attendance";
import { createContractSigningLink, ensurePendingContractForStudent, resolveAppOrigin } from "@/lib/server/student-onboarding";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00-03:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function saoPauloDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  return `${year}-${month}-${day}`;
}

function weekStartFor(dateStr: string) {
  const value = new Date(`${dateStr}T12:00:00-03:00`);
  return addDays(dateStr, -((value.getDay() + 6) % 7));
}

function isDateBetween(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function classMet(name?: string | null) {
  const text = (name || "").toLowerCase();
  if (text.includes("jump")) return 7.5;
  if (text.includes("fit") || text.includes("dance") || text.includes("danca")) return 6.5;
  if (text.includes("funcional") || text.includes("cross")) return 6.2;
  if (text.includes("muscul")) return 5;
  if (text.includes("pilates") || text.includes("yoga")) return 3.2;
  return 5.5;
}

function estimateCalories(weightKg: number, minutes: number, className?: string | null) {
  return Math.max(0, Math.round((classMet(className) * 3.5 * weightKg * minutes) / 200));
}

function buildActivitySummary(
  dateStr: string,
  attendanceHistory: any[] = [],
  recentCheckins: any[] = [],
  student: any = {},
  weeklyClasses: any[] = [],
  activeEnrollment: any = null,
) {
  const activityDates = new Set<string>();
  let confirmedClasses = 0;
  let allowedCheckins = 0;
  const weight = Number(student?.weight || 70);
  const weekStart = weekStartFor(dateStr);
  const weekEnd = addDays(weekStart, 6);
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(weekStart, -1);
  const weeklyClassDays = new Set((weeklyClasses || [])
    .map((item: any) => item.class_schedule?.day_of_week)
    .filter((day: unknown) => typeof day === "number"));
  const plan = Array.isArray(activeEnrollment?.plan) ? activeEnrollment.plan[0] : activeEnrollment?.plan;
  const weeklyGoal = Math.max(1, Number(plan?.weekly_limit || weeklyClassDays.size || weeklyClasses.length || 3));

  const totals = {
    weeklyCompletedActivities: 0,
    previousWeeklyCompletedActivities: 0,
    weeklyAllowedCheckins: 0,
    previousWeeklyAllowedCheckins: 0,
    weeklyCalories: 0,
    previousWeeklyCalories: 0,
    weeklyActiveMinutes: 0,
    previousWeeklyActiveMinutes: 0,
  };
  const datesWithClassCaloriesThisWeek = new Set<string>();
  const datesWithClassCaloriesLastWeek = new Set<string>();

  for (const attendance of attendanceHistory) {
    if (attendance.status === "confirmed" || attendance.status === "attended") {
      confirmedClasses += 1;
      if (attendance.date) activityDates.add(attendance.date);
      const date = attendance.date as string;
      const minutes = Number(attendance.class_schedule?.class_type?.duration_minutes || 60);
      const className = attendance.class_schedule?.class_type?.name || null;
      if (isDateBetween(date, weekStart, weekEnd)) {
        totals.weeklyCompletedActivities += 1;
        totals.weeklyActiveMinutes += minutes;
        totals.weeklyCalories += estimateCalories(weight, minutes, className);
        datesWithClassCaloriesThisWeek.add(date);
      } else if (isDateBetween(date, previousWeekStart, previousWeekEnd)) {
        totals.previousWeeklyCompletedActivities += 1;
        totals.previousWeeklyActiveMinutes += minutes;
        totals.previousWeeklyCalories += estimateCalories(weight, minutes, className);
        datesWithClassCaloriesLastWeek.add(date);
      }
    }
  }

  for (const checkin of recentCheckins) {
    if (checkin.status === "allowed") {
      allowedCheckins += 1;
      if (checkin.checked_at) {
        const date = saoPauloDateKey(checkin.checked_at);
        activityDates.add(date);
        if (isDateBetween(date, weekStart, weekEnd)) {
          totals.weeklyAllowedCheckins += 1;
          if (!datesWithClassCaloriesThisWeek.has(date)) {
            totals.weeklyCompletedActivities += 1;
            totals.weeklyActiveMinutes += 50;
            totals.weeklyCalories += estimateCalories(weight, 50, "Treino livre");
            datesWithClassCaloriesThisWeek.add(date);
          }
        } else if (isDateBetween(date, previousWeekStart, previousWeekEnd)) {
          totals.previousWeeklyAllowedCheckins += 1;
          if (!datesWithClassCaloriesLastWeek.has(date)) {
            totals.previousWeeklyCompletedActivities += 1;
            totals.previousWeeklyActiveMinutes += 50;
            totals.previousWeeklyCalories += estimateCalories(weight, 50, "Treino livre");
            datesWithClassCaloriesLastWeek.add(date);
          }
        }
      }
    }
  }

  let streakDays = 0;
  for (let cursor = dateStr; activityDates.has(cursor); cursor = addDays(cursor, -1)) {
    streakDays += 1;
  }

  return {
    streakDays,
    confirmedClasses,
    allowedCheckins,
    weeklyGoal,
    weekStart,
    weekEnd,
    ...totals,
    weeklyCaloriesDelta: totals.weeklyCalories - totals.previousWeeklyCalories,
    weeklyActivitiesDelta: totals.weeklyCompletedActivities - totals.previousWeeklyCompletedActivities,
    activityDates: [...activityDates].sort(),
  };
}

async function mergeNotificationReadState(admin: any, studentId: string, notifications: any[] = []) {
  const notificationIds = notifications.map((notification) => notification.id).filter(Boolean);
  if (!notificationIds.length) return [];

  const { data: reads, error } = await admin
    .from("student_notification_reads")
    .select("notification_id")
    .eq("student_id", studentId)
    .in("notification_id", notificationIds);

  if (error) {
    console.warn("Student notification read state unavailable:", error.message);
    return notifications.map((notification) => ({ ...notification, read: Boolean(notification.read) }));
  }

  const readIds = new Set((reads || []).map((item: { notification_id: string }) => item.notification_id));
  return notifications.map((notification) => ({ ...notification, read: Boolean(notification.read || readIds.has(notification.id)) }));
}

export async function GET(request: Request) {
  try {
    const { admin, user } = await requireRole(request, ["student"]);
    const { data: student, error } = await admin
      .from("students")
      .select("*")
      .eq("profile_id", user.id)
      .single();

    if (error || !student) throw new ApiError("Cadastro de aluno nao vinculado ao portal.", 404);
    await ensurePendingContractForStudent(admin, student.id);

    const dateStr = todayInBrasilia();
    const historyStart = addDays(dateStr, -30);
    const [
      attendances,
      { data: weeklyClasses },
      { data: payments },
      { data: contracts },
      { data: notifications },
      { data: attendanceHistory },
      { data: auditedOccurrences },
      { data: recentCheckins },
      { data: activeEnrollments },
    ] = await Promise.all([
      ensureStudentAttendancesForDate(admin, student.id, dateStr),
      admin
        .from("student_classes")
        .select("id, class_schedule_id, class_schedule:class_schedules(id, time, day_of_week, capacity, active, class_type:class_types(id, name, color, duration_minutes), instructor:profiles(id, full_name))")
        .eq("student_id", student.id),
      admin
        .from("payments")
        .select("id, reference, total_amount, status, due_date, paid_at, pix_code, pix_qr_base64")
        .eq("student_id", student.id)
        .neq("status", "cancelled")
        .order("due_date", { ascending: false })
        .limit(12),
      admin
        .from("contracts")
        .select("id, enrollment_id, status, signed_at, created_at, plan:plans(name)")
        .eq("student_id", student.id)
        .order("created_at", { ascending: false })
        .limit(12),
      admin
        .from("notifications")
        .select("id, title, message, read, created_at")
        .or(`target_type.eq.all,target_id.eq.${student.id}`)
        .order("created_at", { ascending: false })
        .limit(80),
      admin
        .from("class_attendances")
        .select("id, date, status, class_schedule:class_schedules(id, time, day_of_week, active, class_type:class_types(id, name, color, duration_minutes), instructor:profiles(id, full_name))")
        .eq("student_id", student.id)
        .gte("date", historyStart)
        .lte("date", dateStr)
        .order("date", { ascending: true }),
      admin
        .from("class_occurrence_audits")
        .select("class_schedule_id, date, status")
        .in("status", ["nullified", "inactivated"])
        .gte("date", historyStart)
        .lte("date", dateStr),
      admin
        .from("checkins")
        .select("id, status, unit, checked_at")
        .eq("student_id", student.id)
        .gte("checked_at", `${historyStart}T00:00:00.000Z`)
        .order("checked_at", { ascending: false })
        .limit(80),
      admin
        .from("enrollments")
        .select("id, status, start_date, end_date, plan:plans(id, name, weekly_limit)")
        .eq("student_id", student.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const activeEnrollment = Array.isArray(activeEnrollments) ? activeEnrollments[0] ?? null : null;
    const ignoredOccurrenceKeys = new Set((auditedOccurrences || []).map((occurrence: any) =>
      `${occurrence.class_schedule_id}:${occurrence.date}`
    ));
    const validAttendances = (attendances || []).filter((attendance: any) =>
      !ignoredOccurrenceKeys.has(`${attendance.class_schedule_id}:${attendance.date}`)
    );
    const validAttendanceHistory = (attendanceHistory || []).filter((attendance: any) =>
      !ignoredOccurrenceKeys.has(`${attendance.class_schedule_id}:${attendance.date}`)
    );
    const pendingContract = (contracts || []).find((contract: any) =>
      contract.status === "pending" && contract.enrollment_id === activeEnrollment?.id
    ) ?? null;
    const portalNotifications = await mergeNotificationReadState(admin, student.id, notifications || []);
    const requiredContract = pendingContract
      ? {
          id: pendingContract.id,
          plan: pendingContract.plan ?? null,
          created_at: pendingContract.created_at,
          signingUrl: await createContractSigningLink(admin, pendingContract.id, resolveAppOrigin(request)),
        }
      : null;

    return Response.json({
      student,
      attendances: validAttendances,
      weeklyClasses: (weeklyClasses || []).filter((item: any) => item.class_schedule?.active !== false),
      payments: payments || [],
      contracts: contracts || [],
      notifications: portalNotifications,
      attendanceHistory: validAttendanceHistory,
      recentCheckins: recentCheckins || [],
      activitySummary: buildActivitySummary(dateStr, validAttendanceHistory, recentCheckins || [], student, weeklyClasses || [], activeEnrollment),
      requiredContract,
    });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}
