"use client";

import { localDB } from "@/lib/localDB";
import { shouldUseLocalData, supabase } from "@/lib/supabase";
import { todayInBrasilia, currentMonthInBrasilia } from "@/lib/brazil-date";
import { getDeviceId } from "@/lib/device-id";
import type {
  AuditLog, Checkin, ClassBooking, ClassSession, ClassType, Contract, DashboardStats, Enrollment, LocalTables, NewRow,
  Notification, Payment, Plan, Profile, RevenuePoint, Student, StudioSettings, TableName, Product, Supplier,
  Receiving, ReceivingItem, Sale, SaleItem, InventoryTransaction, ClassSchedule, StudentClass, ClassAttendance,
  ClassOccurrenceAudit, ClassOccurrenceStatus, ProductVariant, StockBatch
} from "@/lib/types";
import { generateMatriculaNumber } from "@/lib/utils";

const sortDesc = <T extends { created_at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
const relation = <T extends { id: string }>(rows: T[], id?: string | null) =>
  rows.find((row) => row.id === id) ?? null;

let syncChannel: any = null;
const notifyDbChange = () => {
  if (typeof window === "undefined") return;
  if (shouldUseLocalData()) return;
  if (!syncChannel) {
    syncChannel = supabase.channel("db-sync");
    syncChannel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        syncChannel.send({ type: "broadcast", event: "DB_CHANGED" });
      }
    });
  } else if (syncChannel.state === "joined") {
    syncChannel.send({ type: "broadcast", event: "DB_CHANGED" });
  }
};

async function list<T extends TableName>(
  table: T,
  orderBy = "created_at",
): Promise<LocalTables[T][]> {
  if (shouldUseLocalData()) return localDB.get(table);
  const { data, error } = await supabase.from(table).select("*").order(orderBy, { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LocalTables[T][];
}

async function insert<T extends TableName>(table: T, values: NewRow<T>): Promise<LocalTables[T]> {
  if (shouldUseLocalData()) {
    const row = localDB.insert(table, values);
    notifyDbChange();
    return row;
  }
  const { data, error } = await supabase.from(table).insert(values).select("*").single();
  if (error) throw new Error(error.message);
  notifyDbChange();
  return data as LocalTables[T];
}

async function update<T extends TableName>(
  table: T,
  id: string,
  values: Partial<LocalTables[T]>,
): Promise<LocalTables[T]> {
  if (shouldUseLocalData()) {
    const row = localDB.update(table, id, values);
    if (!row) throw new Error("Registro nÃ£o encontrado.");
    notifyDbChange();
    return row;
  }
  const { data, error } = await supabase.from(table).update(values as never).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  notifyDbChange();
  return data as LocalTables[T];
}

async function remove<T extends TableName>(table: T, id: string) {
  if (shouldUseLocalData()) {
    localDB.delete(table, id);
    notifyDbChange();
    return true;
  }
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
  notifyDbChange();
  return true;
}

export async function getStudents(): Promise<Student[]> {
  return sortDesc(await list("students"));
}

export async function getStudentById(id: string): Promise<Student | null> {
  if (shouldUseLocalData()) return localDB.find("students", id);
  const { data, error } = await supabase.from("students").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Student | null;
}

export async function createStudent(
  values: Omit<NewRow<"students">, "qr_code" | "status" | "updated_at">,
): Promise<Student> {
  return insert("students", {
    ...values,
    status: "active",
    qr_code: `CE-${Date.now().toString(36).toUpperCase()}`,
    updated_at: new Date().toISOString(),
  });
}

export async function updateStudent(id: string, values: Partial<Student>) {
  return update("students", id, { ...values, updated_at: new Date().toISOString() });
}

async function retirePreviousActiveEnrollments(studentId: string) {
  if (!studentId) return;

  if (!shouldUseLocalData()) {
    const { data: activeEnrollments } = await supabase
      .from("enrollments")
      .select("id")
      .eq("student_id", studentId)
      .eq("status", "active");
    const ids = (activeEnrollments ?? []).map((item) => item.id);
    if (!ids.length) return;

    await supabase.from("enrollments").update({ status: "cancelled" }).in("id", ids);
    await supabase
      .from("payments")
      .update({ status: "cancelled", method: null, paid_at: null })
      .in("enrollment_id", ids)
      .in("status", ["pending", "expired"]);
    notifyDbChange();
    return;
  }

  const previous = localDB.get("enrollments").filter((item) => item.student_id === studentId && item.status === "active");
  for (const enrollment of previous) {
    localDB.update("enrollments", enrollment.id, { status: "cancelled" });
    for (const payment of localDB.get("payments").filter((item) => item.enrollment_id === enrollment.id && ["pending", "expired"].includes(item.status))) {
      localDB.update("payments", payment.id, { status: "cancelled", method: null, paid_at: null });
    }
  }
  notifyDbChange();
}

export async function releaseStudentPortal(id: string) {
  if (shouldUseLocalData()) return onboardLocalStudent(id);

  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/admin/students/${id}/portal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const payload = await response.json() as { email?: string; profileId?: string; contractSent?: boolean; contractPending?: boolean; contractCreated?: boolean; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel liberar o portal.");
  return payload;
}

export async function resetStudentPassword(id: string) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/admin/students/${id}/reset-password`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const payload = await response.json() as { email?: string; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel enviar o link de redefiniÃ§Ã£o de senha.");
  return payload;
}

/** Unified onboard: creates portal, sends password email, and prepares the pending contract. */
export async function onboardStudent(id: string) {
  if (shouldUseLocalData()) return onboardLocalStudent(id);

  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/admin/students/${id}/onboard`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const payload = await response.json() as { email?: string; profileId?: string; contractSent?: boolean; contractPending?: boolean; contractCreated?: boolean; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel realizar o onboarding.");
  return payload;
}

async function onboardLocalStudent(id: string) {
  const student = localDB.find("students", id);
  if (!student) throw new Error("Aluno nao encontrado.");
  if (!student.email) throw new Error("Cadastre o e-mail do aluno antes de liberar o portal.");

  const profileId = student.profile_id || `profile-${id}`;
  const existingProfile = localDB.find("profiles", profileId);
  if (!existingProfile) {
    await insert("profiles", {
      id: profileId,
      full_name: student.full_name,
      email: student.email,
      role: "student",
      active: true,
      password: "123456",
    } as NewRow<"profiles">);
  }
  await update("students", id, { profile_id: profileId, updated_at: new Date().toISOString() });

  const activeEnrollment = localDB
    .get("enrollments")
    .filter((item) => item.student_id === id && item.status === "active")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  let contractCreated = false;
  if (activeEnrollment) {
    const hasPendingContract = localDB
      .get("contracts")
      .some((contract) => contract.student_id === id && contract.status === "pending");
    if (!hasPendingContract) {
      const plan = localDB.find("plans", activeEnrollment.plan_id);
      await insert("contracts", {
        student_id: id,
        plan_id: activeEnrollment.plan_id,
        enrollment_id: activeEnrollment.id,
        document_text: `Termo de adesao ao plano ${plan?.name || "Plano contratado"}.`,
        status: "pending",
        signed_at: null,
        sent_at: new Date().toISOString(),
      });
      contractCreated = true;
    }
  }

  return {
    ok: true,
    email: student.email,
    profileId,
    contractSent: false,
    contractPending: Boolean(activeEnrollment),
    contractCreated,
  };
}

/** Cascade-delete a student and ALL related records (enrollments, payments, contracts, checkins, etc.) */
export async function deleteStudent(id: string) {
  if (shouldUseLocalData()) {
    // Local cascade
    const enrollments = localDB.get("enrollments").filter(e => e.student_id === id);
    for (const e of enrollments) {
      const payments = localDB.get("payments").filter(p => p.enrollment_id === e.id);
      for (const p of payments) localDB.delete("payments", p.id);
      localDB.delete("enrollments", e.id);
    }
    const contracts = localDB.get("contracts").filter(c => c.student_id === id);
    for (const c of contracts) localDB.delete("contracts", c.id);
    const checkins = localDB.get("checkins").filter(c => c.student_id === id);
    for (const c of checkins) localDB.delete("checkins", c.id);
    const studentClasses = localDB.get("student_classes").filter(sc => sc.student_id === id);
    for (const sc of studentClasses) localDB.delete("student_classes", sc.id);
    localDB.delete("students", id);
    notifyDbChange();
    return true;
  }
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/admin/students/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const payload = await response.json() as { ok?: boolean; deleted?: string; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel excluir o aluno.");
  notifyDbChange();
  return true;
}

export async function getPlans(): Promise<Plan[]> {
  return (await list("plans"))
    .filter((plan) => !plan.deleted_at)
    .sort((a, b) => Number(a.price) - Number(b.price));
}

export async function savePlan(values: Partial<Plan> & Pick<Plan, "name" | "price" | "duration_days">) {
  if (values.id) return update("plans", values.id, values);
  return insert("plans", {
    name: values.name,
    description: values.description ?? null,
    price: Number(values.price),
    duration_days: Number(values.duration_days),
    weekly_limit: Number(values.weekly_limit ?? 7),
    color: values.color ?? "#1a73e8",
    active: values.active ?? true,
    deleted_at: null,
  });
}

export async function getEnrollments(): Promise<Enrollment[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("*, student:students(id, full_name, status), plan:plans(id, name, color, price)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Enrollment[];
  }
  const students = localDB.get("students");
  const plans = localDB.get("plans");
  return sortDesc(localDB.get("enrollments")).map((row) => ({
    ...row,
    student: relation(students, row.student_id),
    plan: relation(plans, row.plan_id),
  }));
}

export async function createEnrollment(values: {
  student_id: string;
  plan_id: string | string[];
  start_date: string;
}): Promise<Enrollment> {
  let finalPlanId = typeof values.plan_id === "string" ? values.plan_id : values.plan_id[0];
  let plan = (await getPlans()).find((item) => item.id === finalPlanId);
  
  if (Array.isArray(values.plan_id) && values.plan_id.length > 1) {
    const selectedPlans = (await getPlans()).filter(p => values.plan_id.includes(p.id));
    if (selectedPlans.length > 0) {
      const combinedName = selectedPlans.map(p => p.name).join(" + ");
      const combinedPrice = selectedPlans.reduce((sum, p) => sum + Number(p.price), 0);
      const maxDuration = Math.max(...selectedPlans.map(p => p.duration_days));
      const maxLimit = Math.max(...selectedPlans.map(p => p.weekly_limit));
      plan = await insert("plans", {
        name: combinedName,
        description: "Plano combinado",
        price: combinedPrice,
        duration_days: maxDuration,
        weekly_limit: maxLimit,
        color: selectedPlans[0].color,
        active: false,
      });
      finalPlanId = plan.id;
    }
  }

  if (!plan) throw new Error("Plano nÃ£o encontrado.");
  await retirePreviousActiveEnrollments(values.student_id);
  const end = new Date(`${values.start_date}T12:00:00`);
  end.setDate(end.getDate() + plan.duration_days);
  const plain = await insert("enrollments", {
    student_id: values.student_id,
    plan_id: finalPlanId,
    start_date: values.start_date,
    matricula_number: generateMatriculaNumber(),
    status: "active",
    end_date: end.toISOString().slice(0, 10),
  });
  await insert("payments", {
    reference: `MEN-${Date.now().toString().slice(-8)}`,
    student_id: values.student_id,
    enrollment_id: plain.id,
    amount: Number(plan.price),
    discount: 0,
    fine: 0,
    total_amount: Number(plan.price),
    status: "pending",
    method: null,
    due_date: values.start_date,
    paid_at: null,
  });
  await insert("contracts", {
    student_id: values.student_id,
    plan_id: finalPlanId,
    enrollment_id: plain.id,
    document_text: `Termo de adesÃ£o ao plano ${plan.name}.`,
    status: "pending",
    signed_at: null,
  });
  const student = (await getStudents()).find((item) => item.id === values.student_id) ?? null;
  return { ...plain, student, plan };
}

export async function updateEnrollmentStatus(id: string, status: LocalTables["enrollments"]["status"]) {
  const current = shouldUseLocalData()
    ? localDB.find("enrollments", id)
    : ((await supabase.from("enrollments").select("student_id").eq("id", id).maybeSingle()).data as { student_id?: string } | null);
  if (status === "active" && current?.student_id) {
    await retirePreviousActiveEnrollments(current.student_id);
  }
  return update("enrollments", id, { status });
}

export async function editEnrollment(id: string, values: {
  plan_id: string | string[];
  start_date: string;
}): Promise<Enrollment> {
  let finalPlanId = typeof values.plan_id === "string" ? values.plan_id : values.plan_id[0];
  let plan = (await getPlans()).find((item) => item.id === finalPlanId);
  
  if (Array.isArray(values.plan_id) && values.plan_id.length > 1) {
    const selectedPlans = (await getPlans()).filter(p => values.plan_id.includes(p.id));
    if (selectedPlans.length > 0) {
      const combinedName = selectedPlans.map(p => p.name).join(" + ");
      const combinedPrice = selectedPlans.reduce((sum, p) => sum + Number(p.price), 0);
      const maxDuration = Math.max(...selectedPlans.map(p => p.duration_days));
      const maxLimit = Math.max(...selectedPlans.map(p => p.weekly_limit));
      plan = await insert("plans", {
        name: combinedName,
        description: "Plano combinado",
        price: combinedPrice,
        duration_days: maxDuration,
        weekly_limit: maxLimit,
        color: selectedPlans[0].color,
        active: false,
      });
      finalPlanId = plan.id;
    }
  }

  if (!plan) throw new Error("Plano nÃ£o encontrado.");
  const current = shouldUseLocalData()
    ? localDB.find("enrollments", id)
    : ((await supabase.from("enrollments").select("*").eq("id", id).maybeSingle()).data as LocalTables["enrollments"] | null);
  if (!current) throw new Error("Matrícula não encontrada.");

  const existingPayments = shouldUseLocalData()
    ? localDB.get("payments").filter((payment) => payment.enrollment_id === id)
    : (((await supabase.from("payments").select("*").eq("enrollment_id", id)).data ?? []) as LocalTables["payments"][]);
  const hasPaidCycle = existingPayments.some((payment) => payment.status === "paid");
  const effectiveStartDate = hasPaidCycle ? current.start_date : values.start_date;
  const end = new Date(`${effectiveStartDate}T12:00:00`);
  end.setDate(end.getDate() + plan.duration_days);
  const effectiveEndDate = hasPaidCycle ? current.end_date : end.toISOString().slice(0, 10);
  const planChanged = current.plan_id !== finalPlanId;

  const plain = await update("enrollments", id, {
    plan_id: finalPlanId,
    start_date: effectiveStartDate,
    end_date: effectiveEndDate,
  });

  const pendingPayments = existingPayments.filter((payment) => payment.status === "pending");
  for (const payment of pendingPayments) {
    const preservedAdjustments = Number(payment.discount || 0) - Number(payment.fine || 0);
    await update("payments", payment.id, {
      amount: Number(plan.price),
      total_amount: Math.max(0, Number(plan.price) - preservedAdjustments),
      due_date: hasPaidCycle ? payment.due_date : effectiveStartDate,
    });
  }

  const hasOperationalPayment = existingPayments.some((payment) =>
    ["pending", "paid", "expired"].includes(payment.status),
  );
  if (!hasOperationalPayment) {
    await insert("payments", {
      reference: `MEN-${Date.now().toString().slice(-8)}`,
      student_id: plain.student_id,
      enrollment_id: id,
      amount: Number(plan.price),
      discount: 0,
      fine: 0,
      total_amount: Number(plan.price),
      status: "pending",
      method: null,
      due_date: effectiveStartDate,
      paid_at: null,
    });
  }

  if (planChanged) {
    const contracts = shouldUseLocalData()
      ? localDB.get("contracts").filter((contract) => contract.enrollment_id === id)
      : (((await supabase.from("contracts").select("*").eq("enrollment_id", id)).data ?? []) as LocalTables["contracts"][]);
    for (const contract of contracts.filter((item) => item.status === "pending")) {
      await update("contracts", contract.id, { status: "cancelled" });
    }
    await insert("contracts", {
      student_id: plain.student_id,
      plan_id: finalPlanId,
      enrollment_id: plain.id,
      document_text: `Termo de adesão ao plano ${plan.name}.`,
      status: "pending",
      signed_at: null,
    });
  }
  
  const student = (await getStudents()).find((item) => item.id === plain.student_id) ?? null;
  return { ...plain, student, plan };
}

export async function deleteEnrollment(id: string) {
  if (!shouldUseLocalData()) {
    const { data: payments } = await supabase.from("payments").select("id, status").eq("enrollment_id", id);
    if (payments) {
      for (const pay of payments.filter((payment) => payment.status === "pending")) {
        await update("payments", pay.id, { status: "cancelled", method: null, paid_at: null });
      }
    }
    return update("enrollments", id, { status: "cancelled" });
  } else {
    const payments = localDB.get("payments").filter(p => p.enrollment_id === id);
    for (const pay of payments.filter(p => p.status === "pending")) {
      await update("payments", pay.id, { status: "cancelled", method: null, paid_at: null });
    }
    return update("enrollments", id, { status: "cancelled" });
  }
}

async function ensurePaymentsForActiveEnrollments() {
  if (!shouldUseLocalData()) {
    const [{ data: enrollments, error: enrollmentError }, { data: payments, error: paymentError }] = await Promise.all([
      supabase
        .from("enrollments")
        .select("id, student_id, plan_id, start_date, status, plan:plans(price)")
        .eq("status", "active"),
      supabase.from("payments").select("enrollment_id, status"),
    ]);
    if (enrollmentError || paymentError) return false;

    const coveredEnrollmentIds = new Set(
      (payments ?? [])
        .filter((payment: any) => ["pending", "paid", "expired"].includes(payment.status))
        .map((payment) => payment.enrollment_id),
    );
    const missing = (enrollments ?? []).filter((enrollment: any) => !coveredEnrollmentIds.has(enrollment.id));
    if (!missing.length) return false;

    const rows = missing.map((enrollment: any, index: number) => {
      const plan = Array.isArray(enrollment.plan) ? enrollment.plan[0] : enrollment.plan;
      const amount = Number(plan?.price ?? 0);
      return {
        reference: `MEN-${Date.now().toString().slice(-8)}-${index + 1}`,
        student_id: enrollment.student_id,
        enrollment_id: enrollment.id,
        amount,
        discount: 0,
        fine: 0,
        total_amount: amount,
        status: "pending",
        method: null,
        due_date: enrollment.start_date,
        paid_at: null,
      };
    });

    const { error } = await supabase.from("payments").insert(rows);
    if (!error) notifyDbChange();
    return !error;
  }

  const payments = localDB.get("payments");
  const paymentEnrollmentIds = new Set(
    payments
      .filter((payment) => ["pending", "paid", "expired"].includes(payment.status))
      .map((payment) => payment.enrollment_id),
  );
  const plans = localDB.get("plans");
  const missing = localDB
    .get("enrollments")
    .filter((enrollment) => enrollment.status === "active" && !paymentEnrollmentIds.has(enrollment.id));
  for (const enrollment of missing) {
    const plan = relation(plans, enrollment.plan_id);
    const amount = Number(plan?.price ?? 0);
    localDB.insert("payments", {
      reference: `MEN-${Date.now().toString().slice(-8)}-${enrollment.id.slice(0, 4)}`,
      student_id: enrollment.student_id,
      enrollment_id: enrollment.id,
      amount,
      discount: 0,
      fine: 0,
      total_amount: amount,
      status: "pending",
      method: null,
      due_date: enrollment.start_date,
      paid_at: null,
    });
  }
  if (missing.length) notifyDbChange();
  return missing.length > 0;
}

export async function getPayments(): Promise<Payment[]> {
  if (!shouldUseLocalData()) {
    const repaired = await ensurePaymentsForActiveEnrollments();
    const { data, error } = await supabase
      .from("payments")
      .select("*, student:students(id, full_name)")
      .order("due_date", { ascending: false });
    if (error) throw new Error(error.message);
    if (repaired && data?.length === 0) return getPayments();
    return (data ?? []) as Payment[];
  }
  await ensurePaymentsForActiveEnrollments();
  const students = localDB.get("students");
  return sortDesc(localDB.get("payments")).map((row) => ({
    ...row,
    student: relation(students, row.student_id),
  }));
}

export async function markPaymentPaid(id: string, method: NonNullable<Payment["method"]>) {
  const payment = await update("payments", id, { status: "paid", method, paid_at: new Date().toISOString() });
  notifyPaymentUpdated(payment);
  return payment;
}

export async function updatePaymentStatus(id: string, status: Payment["status"]) {
  const payment = await update("payments", id, {
    status,
    ...(status === "pending" ? { method: null, paid_at: null } : {}),
  });
  notifyPaymentUpdated(payment);
  return payment;
}

export async function createPixPayment(id: string): Promise<Payment> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/payments/${id}/pix`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const payload = await response.json() as { payment?: Payment; error?: string };
  if (!response.ok || !payload.payment) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel gerar o PIX.");
  return payload.payment;
}

export async function getCheckins(): Promise<Checkin[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("checkins")
      .select("*, student:students(id, full_name)")
      .order("checked_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map(withManualStudentName) as Checkin[];
  }
  const students = localDB.get("students");
  return [...localDB.get("checkins")]
    .sort((a, b) => b.checked_at.localeCompare(a.checked_at))
    .map((row) => withManualStudentName({ ...row, student: relation(students, row.student_id) }));
}

function withManualStudentName<T extends Checkin & { student?: any }>(checkin: T): T {
  if (checkin.student || checkin.student_id) return checkin;
  const manualName = checkin.reason?.match(/^Liberacao manual para (.+?) pela recepcao\./)?.[1];
  if (!manualName) return checkin;
  return {
    ...checkin,
    student: { id: "manual", full_name: manualName },
  };
}

function resolveLocalCurrentEnrollment(studentId: string) {
  const today = todayInBrasilia();
  const active = localDB
    .get("enrollments")
    .filter((item) => item.student_id === studentId && item.status === "active");

  for (const enrollment of active.filter((item) => item.end_date && item.end_date < today)) {
    localDB.update("enrollments", enrollment.id, { status: "expired" });
  }

  const current = active
    .filter((item) => !item.end_date || item.end_date >= today)
    .sort((a, b) => {
      const dateCompare = b.start_date.localeCompare(a.start_date);
      return dateCompare || b.created_at.localeCompare(a.created_at);
    })[0] ?? null;

  for (const enrollment of active.filter((item) => item.id !== current?.id)) {
    localDB.update("enrollments", enrollment.id, { status: "cancelled" });
    for (const payment of localDB.get("payments").filter((item) => item.enrollment_id === enrollment.id && ["pending", "expired"].includes(item.status))) {
      localDB.update("payments", payment.id, { status: "cancelled", method: null, paid_at: null });
    }
  }

  return current;
}

function resolveLocalCurrentPayment(enrollmentId: string) {
  const score = (status: string) => status === "paid" ? 3 : status === "pending" ? 2 : status === "expired" ? 1 : 0;
  const rows = localDB
    .get("payments")
    .filter((item) => item.enrollment_id === enrollmentId)
    .sort((a, b) => {
      const aDate = `${a.due_date || ""}|${a.paid_at || ""}|${a.created_at || ""}`;
      const bDate = `${b.due_date || ""}|${b.paid_at || ""}|${b.created_at || ""}`;
      return bDate.localeCompare(aDate) || score(b.status) - score(a.status);
    });

  return rows.filter((item) => ["paid", "pending", "expired"].includes(item.status))[0] ?? rows[0] ?? null;
}

export async function processCheckin(code: string): Promise<Checkin & { student?: Student | null; duplicate?: boolean; enrollment?: Enrollment | null; payment?: Payment | null }> {
  if (!shouldUseLocalData()) {
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch("/api/checkins", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ code: code.trim(), unit: "Matriz" }),
    });
    if (response.ok) {
      const checkin = await response.json() as Checkin & { student?: Student | null; duplicate?: boolean; enrollment?: Enrollment | null; payment?: Payment | null };
      await notifyCheckinCreated(checkin);
      return checkin;
    }
  }
  const students = await getStudents();
  const student = students.find((item) => item.qr_code === code.trim() || item.id === code.trim());
  const enrollment = student ? resolveLocalCurrentEnrollment(student.id) : null;
  const payment = enrollment ? resolveLocalCurrentPayment(enrollment.id) : null;
  const today = todayInBrasilia(); // Data no fuso de BrasÃ­lia
  const enrollmentExpired = Boolean(enrollment?.end_date && enrollment.end_date < today);
  const effectivePayment = payment && payment.status === "pending" && payment.due_date < today
    ? { ...payment, status: "expired" as const }
    : payment;
  const allowed = Boolean(
    student &&
    student.status === "active" &&
    enrollment &&
    !enrollmentExpired &&
    effectivePayment &&
    effectivePayment.status === "paid"
  );
  if (allowed && student) {
    const duplicateWindowStart = Date.now() - 5 * 60 * 1000;
    const recent = (await getCheckins()).find((item) =>
      item.student_id === student.id &&
      item.status === "allowed" &&
      new Date(item.checked_at).getTime() >= duplicateWindowStart
    );
    if (recent) {
      return {
        ...recent,
        student,
        enrollment,
        payment: effectivePayment,
        duplicate: true,
        reason: "Check-in jÃ¡ confirmado nos Ãºltimos 5 minutos. Nenhum novo registro foi criado.",
      };
    }
  }
  let reason = !student
    ? "CÃ³digo nÃ£o encontrado."
    : student.status !== "active"
      ? "Aluno inativo ou bloqueado."
      : !enrollment
        ? "Aluno sem matrÃ­cula ativa."
        : null;
  if (student?.status === "active" && enrollment) {
    reason = enrollmentExpired
      ? "Matricula expirada. Renove o plano antes de liberar a catraca."
      : !effectivePayment
        ? "Nenhum pagamento encontrado para esta matricula. Regularize na recepcao."
        : effectivePayment.status === "expired"
          ? "Pagamento expirado ou vencido. Acesso bloqueado ate regularizacao."
          : effectivePayment.status === "pending"
            ? "Pagamento pendente. Receba o pagamento na recepcao antes de liberar a catraca."
            : effectivePayment.status !== "paid"
              ? "Pagamento nao confirmado. Acesso bloqueado."
              : null;
  }

  const row = await insert("checkins", {
    student_id: student?.id ?? null,
    enrollment_id: enrollment?.id ?? null,
    status: allowed ? "allowed" : "denied",
    reason,
    unit: "Matriz",
    checked_at: new Date().toISOString(),
  });
  const checkin = { ...row, student, enrollment, payment: effectivePayment };
  await notifyCheckinCreated(checkin);
  return checkin;
}

export async function createManualCheckin(name: string): Promise<Checkin & { student?: { id: string; full_name: string } | null; manual?: boolean }> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Informe o nome para liberar manualmente.");

  if (!shouldUseLocalData()) {
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch("/api/checkins", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ manualName: cleanName, unit: "Matriz" }),
    });
    const payload = await response.json() as Checkin & { student?: { id: string; full_name: string } | null; manual?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Nao foi possivel registrar a liberacao manual.");
    await notifyCheckinCreated(payload);
    return payload;
  }

  const row = await insert("checkins", {
    student_id: null,
    enrollment_id: null,
    status: "allowed",
    reason: `Liberacao manual para ${cleanName} pela recepcao.`,
    unit: "Matriz",
    checked_at: new Date().toISOString(),
  });
  const checkin = { ...row, student: { id: "manual", full_name: cleanName }, manual: true };
  await notifyCheckinCreated(checkin);
  return checkin;
}

function notifyPaymentUpdated(payment: Payment) {
  if (typeof window === "undefined") return;
  const detail = { ...payment, sourceDeviceId: getDeviceId() };
  window.dispatchEvent(new CustomEvent("payment:updated", { detail }));
  for (const channelName of ["payments-realtime", "pos-terminal-channel"]) {
    const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void channel.send({ type: "broadcast", event: "PAYMENT_UPDATED", payload: detail })
        .finally(() => window.setTimeout(() => supabase.removeChannel(channel), 800));
    });
  }
}

async function notifyCheckinCreated(checkin: Checkin & { student?: Student | { id: string; full_name: string } | null; duplicate?: boolean; enrollment?: Enrollment | null; payment?: Payment | null; manual?: boolean }) {
  if (typeof window === "undefined") return;
  const detail = { ...checkin, sourceDeviceId: getDeviceId() };
  window.dispatchEvent(new CustomEvent("checkin:created", { detail }));

  await Promise.all(["checkins-panel-realtime", "checkins-camera-realtime", "checkins-realtime"].map((channelName) => new Promise<void>((resolve) => {
    const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });
    const timeout = window.setTimeout(() => {
      void supabase.removeChannel(channel);
      resolve();
    }, 1500);

    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void channel.send({ type: "broadcast", event: "CHECKIN_CREATED", payload: detail })
        .catch(() => {})
        .finally(() => {
          window.clearTimeout(timeout);
          window.setTimeout(() => supabase.removeChannel(channel), 800);
          resolve();
        });
    });
  })));
}
export async function getContracts(): Promise<Contract[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("contracts")
      .select("*, student:students(id, full_name), plan:plans(id, name)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Contract[];
  }
  const students = localDB.get("students");
  const plans = localDB.get("plans");
  return sortDesc(localDB.get("contracts")).map((row) => ({
    ...row,
    student: relation(students, row.student_id),
    plan: relation(plans, row.plan_id),
  }));
}

export async function signContract(id: string) {
  return update("contracts", id, { status: "signed", signed_at: new Date().toISOString() });
}

export async function updateContractStatus(id: string, status: Contract["status"]) {
  return update("contracts", id, {
    status,
    ...(status === "pending" ? { signed_at: null, ip_address: null, signature_data: null } : {}),
  });
}

export async function sendContractForSignature(id: string) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/contracts/${id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const payload = await response.json() as { sentTo?: string; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel enviar o contrato.");
  return payload;
}

export async function getNotifications(): Promise<Notification[]> {
  return sortDesc(await list("notifications"));
}

export async function createNotification(values: Pick<Notification, "title" | "message" | "target_type">) {
  return insert("notifications", { ...values, target_id: null, read: false });
}

export async function deleteNotification(id: string) {
  return remove("notifications", id);
}

export async function getProfiles(): Promise<Profile[]> {
  return sortDesc(await list("profiles"));
}

export async function createProfile(values: Pick<Profile, "full_name" | "email" | "role"> & { password: string }) {
  if (shouldUseLocalData()) return insert("profiles", { ...values, active: true });

  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(values),
  });
  const payload = (await response.json()) as { profile?: Profile; error?: string };
  if (!response.ok || !payload.profile) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel criar o usuÃ¡rio.");
  return payload.profile;
}

export async function deleteProfile(id: string) {
  if (shouldUseLocalData()) return remove("profiles", id);
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/admin/users/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel remover o usuÃ¡rio.");
  return true;
}

export async function getAuditLogs(): Promise<AuditLog[]> {
  if (shouldUseLocalData()) return sortDesc(localDB.get("audit_logs"));
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*, profiles(full_name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditLog[];
}

export async function getSettings(): Promise<StudioSettings> {
  if (shouldUseLocalData()) return localDB.get("settings")[0];
  const { data, error } = await supabase.from("settings").select("*").eq("id", "studio").single();
  if (error) throw new Error(error.message);
  return data as StudioSettings;
}

export async function saveSettings(values: StudioSettings): Promise<StudioSettings> {
  if (shouldUseLocalData()) {
    return localDB.update("settings", values.id, {
      ...values,
      updated_at: new Date().toISOString(),
    }) as StudioSettings;
  }
  const { data, error } = await supabase.from("settings").upsert(values).select("*").single();
  if (error) throw new Error(error.message);
  return data as StudioSettings;
}

export async function uploadContractTemplate(file: File) {
  const { data } = await supabase.auth.getSession();
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/settings/contract-template", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body,
  });
  const payload = await response.json() as { path?: string; name?: string; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel enviar o PDF.");
  return payload;
}

export async function getClassTypes(): Promise<ClassType[]> {
  try {
    return (await list("class_types")).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function saveClassType(values: Partial<ClassType>) {
  if (values.id) {
    return update("class_types", values.id, values);
  }
  return insert("class_types", values as NewRow<"class_types">);
}

export async function deleteClassType(id: string) {
  // Verifying if it is used in any class schedules
  if (!shouldUseLocalData()) {
    const { count, error } = await supabase
      .from("class_schedules")
      .select("*", { count: "exact", head: true })
      .eq("class_type_id", id);
      
    if (error) throw new Error("Erro ao verificar dependÃªncias.");
    if (count && count > 0) {
      throw new Error("Esta aula possui horÃ¡rios cadastrados na Grade Fixa. Exclua ou altere os horÃ¡rios antes de excluir a modalidade.");
    }
  } else {
    const schedules = localDB.get("class_schedules");
    const used = schedules.some((s) => s.class_type_id === id);
    if (used) {
      throw new Error("Esta aula possui horÃ¡rios cadastrados na Grade Fixa. Exclua ou altere os horÃ¡rios antes de excluir a modalidade.");
    }
  }
  
  return remove("class_types", id);
}

export async function getClassSessions(): Promise<ClassSession[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("class_sessions")
      .select("*, class_type:class_types(*), instructor:profiles(id, full_name), bookings:class_bookings(id, session_id, student_id, status, created_at, student:students(id, full_name))")
      .order("start_at", { ascending: true });
    if (error) return [];
    return (data ?? []) as ClassSession[];
  }
  const types = localDB.get("class_types");
  const profiles = localDB.get("profiles");
  const students = localDB.get("students");
  const bookings = localDB.get("class_bookings");
  return localDB.get("class_sessions")
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((session) => ({
      ...session,
      class_type: relation(types, session.class_type_id),
      instructor: relation(profiles, session.instructor_id),
      bookings: bookings.filter((booking) => booking.session_id === session.id).map((booking) => ({
        ...booking,
        student: relation(students, booking.student_id),
      })),
    }));
}

export async function createClassSession(values: {
  class_type_id: string;
  instructor_id?: string | null;
  start_at: string;
  capacity: number;
  notes?: string | null;
}) {
  const type = (await getClassTypes()).find((item) => item.id === values.class_type_id);
  if (!type) throw new Error("Tipo de aula nÃ£o encontrado.");
  const start = new Date(values.start_at);
  const end = new Date(start.getTime() + type.duration_minutes * 60 * 1000);
  return insert("class_sessions", {
    ...values,
    instructor_id: values.instructor_id || null,
    end_at: end.toISOString(),
    status: "scheduled",
    notes: values.notes || null,
  });
}

export async function createClassBooking(sessionId: string, studentId: string): Promise<ClassBooking> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase.rpc("book_class_session", {
      p_session_id: sessionId,
      p_student_id: studentId,
    });
    if (!error && data) return data as ClassBooking;
    if (error && !error.message.toLowerCase().includes("function")) throw new Error(error.message);
  }
  const sessions = await getClassSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error("HorÃ¡rio nÃ£o encontrado.");
  const occupied = (session.bookings || []).filter((item) => item.status === "confirmed" || item.status === "attended").length;
  if (occupied >= session.capacity) throw new Error(`A aula ${session.class_type?.name || ""} estÃ¡ lotada.`);
  return insert("class_bookings", {
    session_id: sessionId,
    student_id: studentId,
    status: "confirmed",
  });
}
export async function getClassSchedules(): Promise<ClassSchedule[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("class_schedules")
      .select("*, class_type:class_types(*), instructor:profiles(id, full_name), student_classes(id, student_id, student:students(id, full_name))")
      .order("day_of_week", { ascending: true })
      .order("time", { ascending: true });
    if (error) return [];
    return (data ?? []) as ClassSchedule[];
  }
  const classTypes = localDB.get("class_types");
  const profiles = localDB.get("profiles");
  const students = localDB.get("students");
  const studentClasses = localDB.get("student_classes");
  return localDB.get("class_schedules")
    .sort((a, b) => a.day_of_week === b.day_of_week ? a.time.localeCompare(b.time) : a.day_of_week - b.day_of_week)
    .map((schedule) => ({
      ...schedule,
      class_type: relation(classTypes, schedule.class_type_id),
      instructor: relation(profiles, schedule.instructor_id),
      student_classes: studentClasses.filter((sc) => sc.class_schedule_id === schedule.id).map((sc) => ({
        ...sc,
        student: relation(students, sc.student_id),
      })),
    }));
}

export async function createClassSchedule(values: {
  class_type_id: string;
  instructor_id?: string | null;
  day_of_week: number;
  time: string;
  capacity: number;
}) {
  return insert("class_schedules", {
    ...values,
    instructor_id: values.instructor_id || null,
    active: true,
  });
}

export async function updateClassSchedule(id: string, values: {
  class_type_id?: string;
  instructor_id?: string | null;
  day_of_week?: number;
  time?: string;
  capacity?: number;
  active?: boolean;
}) {
  return update("class_schedules", id, values);
}

export async function deleteClassSchedule(id: string) {
  return remove("class_schedules", id);
}

export async function deleteAllClassSchedules() {
  const schedules = await getClassSchedules();
  const scheduleIds = schedules.map((schedule) => schedule.id);
  if (!scheduleIds.length) return { deleted: 0 };

  if (shouldUseLocalData()) {
    const idSet = new Set(scheduleIds);
    for (const attendance of localDB.get("class_attendances").filter((item) => idSet.has(item.class_schedule_id))) {
      localDB.delete("class_attendances", attendance.id);
    }
    for (const studentClass of localDB.get("student_classes").filter((item) => idSet.has(item.class_schedule_id))) {
      localDB.delete("student_classes", studentClass.id);
    }
    for (const scheduleId of scheduleIds) localDB.delete("class_schedules", scheduleId);
    notifyDbChange();
    return { deleted: scheduleIds.length };
  }

  for (let index = 0; index < scheduleIds.length; index += 100) {
    const ids = scheduleIds.slice(index, index + 100);
    const { error: attendanceError } = await supabase.from("class_attendances").delete().in("class_schedule_id", ids);
    if (attendanceError) throw new Error(`Erro ao limpar presencas da grade: ${attendanceError.message}`);

    const { error: linksError } = await supabase.from("student_classes").delete().in("class_schedule_id", ids);
    if (linksError) throw new Error(`Erro ao limpar vinculos de alunos: ${linksError.message}`);

    const { error: schedulesError } = await supabase.from("class_schedules").delete().in("id", ids);
    if (schedulesError) throw new Error(`Erro ao excluir horarios: ${schedulesError.message}`);
  }

  notifyDbChange();
  return { deleted: scheduleIds.length };
}

export async function getStudentClasses(studentId: string): Promise<StudentClass[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("student_classes")
      .select("*, class_schedule:class_schedules(*, class_type:class_types(*))")
      .eq("student_id", studentId);
    if (error) return [];
    return (data ?? []) as StudentClass[];
  }
  const schedules = localDB.get("class_schedules");
  const classTypes = localDB.get("class_types");
  return localDB.get("student_classes")
    .filter((sc) => sc.student_id === studentId)
    .map((sc) => {
      const schedule = relation(schedules, sc.class_schedule_id);
      return {
        ...sc,
        class_schedule: schedule ? ({ ...schedule, class_type: relation(classTypes, schedule.class_type_id) } as unknown as ClassSchedule) : null,
      };
    });
}

export async function getTodayAttendances(studentId: string, dateStr: string): Promise<ClassAttendance[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("class_attendances")
      .select("*, class_schedule:class_schedules(*, plan:plans(*))")
      .eq("student_id", studentId)
      .eq("date", dateStr);
    if (error) return [];
    return (data ?? []) as ClassAttendance[];
  }
  const schedules = localDB.get("class_schedules");
  const classTypes = localDB.get("class_types");
  return localDB.get("class_attendances")
    .filter((ca) => ca.student_id === studentId && ca.date === dateStr)
    .map((ca) => {
      const schedule = relation(schedules, ca.class_schedule_id);
      return {
        ...ca,
        class_schedule: schedule ? ({ ...schedule, class_type: relation(classTypes, schedule.class_type_id) } as unknown as ClassSchedule) : null,
      };
    });
}

export async function getAttendancesByDate(dateStr: string): Promise<ClassAttendance[]> {
  if (!shouldUseLocalData()) {
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch(`/api/admin/attendances?date=${encodeURIComponent(dateStr)}`, {
      headers: { Authorization: `Bearer ${session.session?.access_token ?? ""}` },
      cache: "no-store",
    });
    const payload = await response.json() as { attendances?: ClassAttendance[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Nao foi possivel carregar presencas.");
    return payload.attendances ?? [];
  }
  const schedules = localDB.get("class_schedules");
  const classTypes = localDB.get("class_types");
  const students = localDB.get("students");
  return localDB.get("class_attendances")
    .filter((ca) => ca.date === dateStr)
    .map((ca) => {
      const schedule = relation(schedules, ca.class_schedule_id);
      return {
        ...ca,
        student: relation(students, ca.student_id),
        class_schedule: schedule ? ({ ...schedule, class_type: relation(classTypes, schedule.class_type_id) } as unknown as ClassSchedule) : null,
      };
    });
}

export async function updateAttendanceStatus(attendanceOrId: string | ClassAttendance, status: ClassAttendance["status"]) {
  const id = typeof attendanceOrId === "string" ? attendanceOrId : attendanceOrId.id;
  if (!shouldUseLocalData()) {
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch("/api/student/attendance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        attendanceId: id,
        classScheduleId: typeof attendanceOrId === "string" ? undefined : attendanceOrId.class_schedule_id,
        date: typeof attendanceOrId === "string" ? undefined : attendanceOrId.date,
        status,
      }),
    });
    const payload = await response.json() as ClassAttendance & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Nao foi possivel atualizar presenca.");
    notifyDbChange();
    return payload;
  }

  if (status === "confirmed") {
    const attendance = localDB.get("class_attendances").find(a => a.id === id) as ClassAttendance;
    if (attendance) {
      const attendances = localDB.get("class_attendances");
      const confirmedToday = attendances.filter(a => a.student_id === attendance.student_id && a.date === attendance.date && a.class_schedule_id !== attendance.class_schedule_id && (a.status === "confirmed" || a.status === "attended")).length;
      if (confirmedToday >= 2) throw new Error("Voce atingiu o limite de 2 aulas confirmadas por dia!");
    }
  }

  return update("class_attendances", id, { status });
}

export async function getAttendanceHistory(days = 120): Promise<ClassOccurrenceAudit[]> {
  if (shouldUseLocalData()) {
    const schedules = await getClassSchedules();
    const scheduleMap = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    const grouped = new Map<string, ClassOccurrenceAudit>();
    for (const attendance of localDB.get("class_attendances")) {
      const key = `${attendance.class_schedule_id}:${attendance.date}`;
      const current = grouped.get(key) ?? {
        class_schedule_id: attendance.class_schedule_id,
        date: attendance.date,
        status: "normal",
        class_schedule: scheduleMap.get(attendance.class_schedule_id) ?? null,
        attendance_total: 0,
        confirmed_total: 0,
        missed_total: 0,
      };
      current.attendance_total = (current.attendance_total ?? 0) + 1;
      if (["confirmed", "attended"].includes(attendance.status)) current.confirmed_total = (current.confirmed_total ?? 0) + 1;
      if (["cancelled", "missed"].includes(attendance.status)) current.missed_total = (current.missed_total ?? 0) + 1;
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((a, b) => `${b.date}${b.class_schedule?.time || ""}`.localeCompare(`${a.date}${a.class_schedule?.time || ""}`));
  }

  const { data: session } = await supabase.auth.getSession();
  const response = await fetch(`/api/admin/attendances/history?days=${days}`, {
    headers: { Authorization: `Bearer ${session.session?.access_token ?? ""}` },
    cache: "no-store",
  });
  const payload = await response.json() as { occurrences?: ClassOccurrenceAudit[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar o histórico de presenças.");
  return payload.occurrences ?? [];
}

export async function auditClassOccurrence(values: {
  classScheduleId: string;
  date: string;
  status: ClassOccurrenceStatus;
  reason: string;
}) {
  if (shouldUseLocalData()) {
    throw new Error("A auditoria de aulas exige o banco Supabase configurado.");
  }
  const { data: session } = await supabase.auth.getSession();
  const response = await fetch("/api/admin/attendances/history", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(values),
  });
  const payload = await response.json() as { occurrence?: ClassOccurrenceAudit; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Não foi possível auditar esta aula.");
  notifyDbChange();
  return payload.occurrence;
}
export async function linkStudentToClasses(studentId: string, classScheduleIds: string[]) {
  const uniqueClassScheduleIds = [...new Set(classScheduleIds.filter(Boolean))];
  if (!shouldUseLocalData()) {
    // Delete existing
    await supabase.from("student_classes").delete().eq("student_id", studentId);
    // Insert new
    if (uniqueClassScheduleIds.length > 0) {
      await supabase.from("student_classes").upsert(
        uniqueClassScheduleIds.map(id => ({ student_id: studentId, class_schedule_id: id })),
        { onConflict: "student_id,class_schedule_id", ignoreDuplicates: true },
      );
    }
    return;
  }
  
  // Local logic
  const existing = localDB.get("student_classes").filter(sc => sc.student_id === studentId);
  for (const sc of existing) {
    localDB.delete("student_classes", sc.id);
  }
  for (const id of uniqueClassScheduleIds) {
    localDB.insert("student_classes", { student_id: studentId, class_schedule_id: id });
  }
}
export async function getDashboardStats(): Promise<DashboardStats> {
  const [students, enrollments, payments, checkins] = await Promise.all([
    getStudents(), getEnrollments(), getPayments(), getCheckins(),
  ]);
  const month = currentMonthInBrasilia(); // MÃªs no fuso de BrasÃ­lia
  const currentDate = todayInBrasilia();   // Data no fuso de BrasÃ­lia
  const activeEnrollments = enrollments.filter((item) => item.status === "active").length;
  return {
    totalStudents: students.length,
    activeStudents: students.filter((student) => student.status === "active").length,
    activeEnrollments,
    pendingPayments: payments.filter((payment) => payment.status === "pending").length,
    monthlyRevenue: payments
      .filter((payment) => payment.status === "paid" && (payment.paid_at ?? payment.created_at).startsWith(month))
      .reduce((total, payment) => total + Number(payment.total_amount), 0),
    todayCheckins: checkins.filter((checkin) => checkin.checked_at.startsWith(currentDate)).length,
    overduePayments: payments.filter((payment) => payment.status === "pending" && payment.due_date < currentDate).length,
    conversionRate: students.length ? Math.round((activeEnrollments / students.length) * 100) : 0,
  };
}

export async function getRevenueSeries(): Promise<RevenuePoint[]> {
  const payments = await getPayments();
  const formatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      name: formatter.format(date).replace(".", ""),
      receita: payments
        .filter((payment) => payment.status === "paid" && (payment.paid_at ?? "").startsWith(key))
        .reduce((total, payment) => total + Number(payment.total_amount), 0),
    };
  });
}

// ==========================================
// MÃ“DULO ERP (ESTOQUE E PDV)
// ==========================================

const productVariantSchemaFields = new Set([
  "parent_product_id",
  "variant_color",
  "variant_size",
  "variant_label",
  "primary_barcode",
  "has_variants",
  "track_lots",
  "track_expiry",
]);

function isMissingProductVariantSchema(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /schema cache|PGRST204|parent_product_id|variant_color|variant_size|variant_label|primary_barcode|has_variants|track_lots|track_expiry/i.test(message);
}

function stripProductVariantColumns<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !productVariantSchemaFields.has(key)),
  ) as T;
}

export async function getSuppliers() {
  return sortDesc(await list("suppliers"));
}

export async function getProducts(): Promise<Product[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("products")
      .select("*, supplier:suppliers(*), variants:product_variants(*)")
      .is("parent_product_id", null)
      .order("created_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((product: any) => {
        const variants = [...(product.variants ?? [])].sort((a, b) => a.sort_order - b.sort_order);
        return {
          ...product,
          variants,
          has_variants: Boolean(product.has_variants || variants.length),
          current_stock: variants.length
            ? variants.reduce((total: number, variant: ProductVariant) => total + Number(variant.current_stock || 0), 0)
            : Number(product.current_stock || 0),
        } as Product;
      });
    }

    const { data: legacy, error: legacyError } = await supabase
      .from("products")
      .select("*, supplier:suppliers(*)")
      .order("created_at", { ascending: false });
    if (legacyError) throw new Error(legacyError.message);
    const rows = (legacy ?? []) as Product[];
    const roots = rows.filter((product) => !product.parent_product_id);
    return roots.map((product) => {
      const children = rows.filter((child) => child.parent_product_id === product.id);
      const variants = children.map((child, index) => ({
        id: child.id,
        product_id: product.id,
        code: child.barcode || child.sku || child.internal_code || child.id,
        barcode: child.barcode,
        sku: child.sku,
        color: child.variant_color,
        size: child.variant_size,
        label: child.variant_label || [child.variant_color, child.variant_size].filter(Boolean).join(" / ") || child.name,
        current_stock: child.current_stock,
        minimum_stock: child.minimum_stock,
        maximum_stock: child.maximum_stock,
        current_cost: child.current_cost,
        selling_price: child.selling_price,
        physical_location: child.physical_location,
        active: child.active,
        sort_order: index,
        created_at: child.created_at,
        updated_at: child.updated_at,
      } satisfies ProductVariant));
      return {
        ...product,
        variants,
        has_variants: variants.length > 0,
        current_stock: variants.length
          ? variants.reduce((total, variant) => total + Number(variant.current_stock || 0), 0)
          : product.current_stock,
      };
    });
  }
  const products = localDB.get("products");
  const variants = localDB.get("product_variants");
  const suppliers = localDB.get("suppliers");
  return sortDesc(products)
    .filter((product) => !product.parent_product_id)
    .map((product) => {
      const productVariants = variants
        .filter((variant) => variant.product_id === product.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      return {
        ...product,
        supplier: relation(suppliers, product.supplier_id),
        variants: productVariants,
        has_variants: productVariants.length > 0,
        current_stock: productVariants.length
          ? productVariants.reduce((total, variant) => total + variant.current_stock, 0)
          : product.current_stock,
      };
    });
}

export async function getProductById(id: string): Promise<Product | null> {
  if (shouldUseLocalData()) {
    const product = localDB.find("products", id);
    if (!product) return null;
    const variants = localDB.get("product_variants").filter((variant) => variant.product_id === id);
    return { ...product, variants, has_variants: variants.length > 0 };
  }
  const { data, error } = await supabase
    .from("products")
    .select("*, supplier:suppliers(*), variants:product_variants(*)")
    .eq("id", id)
    .maybeSingle();
  if (!error) return data ? ({ ...data, variants: data.variants ?? [] } as Product) : null;
  const fallback = await supabase.from("products").select("*, supplier:suppliers(*)").eq("id", id).maybeSingle();
  if (fallback.error) throw new Error(fallback.error.message);
  if (!fallback.data) return null;
  const { data: children } = await supabase.from("products").select("*").eq("parent_product_id", id).order("created_at");
  const variants = ((children ?? []) as Product[]).map((child, index) => ({
    id: child.id,
    product_id: id,
    code: child.barcode || child.sku || child.internal_code || child.id,
    barcode: child.barcode,
    sku: child.sku,
    color: child.variant_color,
    size: child.variant_size,
    label: child.variant_label || [child.variant_color, child.variant_size].filter(Boolean).join(" / ") || child.name,
    current_stock: child.current_stock,
    minimum_stock: child.minimum_stock,
    maximum_stock: child.maximum_stock,
    current_cost: child.current_cost,
    selling_price: child.selling_price,
    physical_location: child.physical_location,
    active: child.active,
    sort_order: index,
    created_at: child.created_at,
    updated_at: child.updated_at,
  } satisfies ProductVariant));
  return { ...(fallback.data as Product), variants, has_variants: variants.length > 0 };
}

export async function createProductVariant(values: Omit<NewRow<"product_variants">, "updated_at">) {
  return insert("product_variants", { ...values, updated_at: new Date().toISOString() });
}

export async function updateProductVariant(id: string, values: Partial<ProductVariant>) {
  return update("product_variants", id, { ...values, updated_at: new Date().toISOString() });
}

export async function deleteProductVariant(id: string) {
  return remove("product_variants", id);
}

export function productVariantAsProduct(product: Product, variant: ProductVariant): Product {
  return {
    ...product,
    id: variant.id,
    parent_product_id: product.id,
    primary_barcode: product.barcode || product.primary_barcode || product.internal_code || product.sku,
    barcode: variant.code,
    sku: variant.sku,
    internal_code: variant.code,
    name: `${product.name} ${variant.label}`.trim(),
    variant_color: variant.color,
    variant_size: variant.size,
    variant_label: variant.label,
    current_stock: variant.current_stock,
    minimum_stock: variant.minimum_stock,
    maximum_stock: variant.maximum_stock,
    current_cost: variant.current_cost,
    selling_price: variant.selling_price,
    physical_location: variant.physical_location || product.physical_location,
    variants: undefined,
    has_variants: false,
  };
}

export function expandProductsWithVariants(products: Product[]) {
  return products.flatMap((product) =>
    product.variants?.length
      ? product.variants.map((variant) => productVariantAsProduct(product, variant))
      : [product],
  );
}

export async function createProduct(values: Omit<NewRow<"products">, "updated_at">): Promise<Product> {
  const payload = {
    ...values,
    updated_at: new Date().toISOString(),
  };
  try {
    return await insert("products", payload);
  } catch (error) {
    if (!isMissingProductVariantSchema(error)) throw error;
    return insert("products", stripProductVariantColumns(payload));
  }
}

export async function updateProduct(id: string, values: Partial<Product>) {
  const payload = { ...values, updated_at: new Date().toISOString() };
  try {
    return await update("products", id, payload);
  } catch (error) {
    if (!isMissingProductVariantSchema(error)) throw error;
    return update("products", id, stripProductVariantColumns(payload));
  }
}

export async function deleteProduct(id: string) {
  if (shouldUseLocalData()) {
    const rItems = localDB.get("receiving_items").filter(i => i.product_id === id);
    for (const item of rItems) localDB.delete("receiving_items", item.id);
    const sItems = localDB.get("sale_items").filter(i => i.product_id === id);
    for (const item of sItems) localDB.delete("sale_items", item.id);
    const trans = localDB.get("inventory_transactions").filter(i => i.product_id === id);
    for (const t of trans) localDB.delete("inventory_transactions", t.id);
    return remove("products", id);
  }
  await supabase.from("receiving_items").delete().eq("product_id", id);
  await supabase.from("sale_items").delete().eq("product_id", id);
  await supabase.from("inventory_transactions").delete().eq("product_id", id);
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}
export async function getReceivings(): Promise<Receiving[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("receivings")
      .select("*, supplier:suppliers(*)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Receiving[];
  }
  const receivings = localDB.get("receivings");
  const suppliers = localDB.get("suppliers");
  return sortDesc(receivings).map(r => ({
    ...r,
    supplier: relation(suppliers, r.supplier_id)
  }));
}

export async function getReceivingById(id: string): Promise<Receiving | null> {
  if (shouldUseLocalData()) return localDB.find("receivings", id);
  const { data, error } = await supabase.from("receivings").select("*, supplier:suppliers(*)").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Receiving | null;
}

export async function createReceiving(values: Omit<NewRow<"receivings">, "updated_at">): Promise<Receiving> {
  return insert("receivings", {
    ...values,
    updated_at: new Date().toISOString(),
  });
}

export async function updateReceiving(id: string, values: Partial<Receiving>) {
  return update("receivings", id, { ...values, updated_at: new Date().toISOString() });
}

export async function deleteReceiving(id: string) {
  if (shouldUseLocalData()) {
    const items = localDB.get("receiving_items").filter(i => i.receiving_id === id);
    for (const item of items) localDB.delete("receiving_items", item.id);
    const trans = localDB.get("inventory_transactions").filter(i => i.reference_id === id);
    for (const t of trans) localDB.delete("inventory_transactions", t.id);
    return remove("receivings", id);
  }
  await supabase.from("inventory_transactions").delete().eq("reference_id", id);
  await supabase.from("receiving_items").delete().eq("receiving_id", id);
  const { error } = await supabase.from("receivings").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}

export async function getReceivingItems(receiving_id: string): Promise<ReceivingItem[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("receiving_items")
      .select("*, product:products(*), variant:product_variants(*)")
      .eq("receiving_id", receiving_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ReceivingItem[];
  }
  const items = localDB.get("receiving_items").filter(i => i.receiving_id === receiving_id);
  const products = localDB.get("products");
  const variants = localDB.get("product_variants");
  return items.map(i => ({
    ...i,
    product: relation(products, i.product_id),
    variant: relation(variants, i.variant_id),
  }));
}

export async function getInventoryTransactions(): Promise<any[]> {
  if (!shouldUseLocalData()) {
    const { data, error } = await supabase
      .from("inventory_transactions")
      .select("*, product:products(*), variant:product_variants(*)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const transactions = localDB.get("inventory_transactions");
  const products = localDB.get("products");
  const variants = localDB.get("product_variants");
  return sortDesc(transactions).map(t => ({
    ...t,
    product: relation(products, t.product_id),
    variant: relation(variants, t.variant_id),
  })).slice(0, 100);
}

export async function createReceivingItem(values: NewRow<"receiving_items">): Promise<ReceivingItem> {
  if (shouldUseLocalData()) return localDB.insert("receiving_items", values);
  const { data, error } = await supabase.from("receiving_items").insert(values).select("*").single();
  if (error) throw new Error(error.message);
  return data as ReceivingItem;
}

export async function deleteReceivingItem(id: string) {
  if (shouldUseLocalData()) return localDB.delete("receiving_items", id);
  const { error } = await supabase.from("receiving_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateReceivingItem(id: string, values: Partial<NewRow<"receiving_items">>) {
  if (shouldUseLocalData()) return localDB.update("receiving_items", id, values);
  const { data, error } = await supabase.from("receiving_items").update(values).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function createInventoryTransaction(values: any) {
  return insert("inventory_transactions", values);
}

export async function createStockBatch(values: Omit<NewRow<"stock_batches">, "updated_at">): Promise<StockBatch> {
  return insert("stock_batches", { ...values, updated_at: new Date().toISOString() });
}

export async function getStockBatches(productId?: string): Promise<StockBatch[]> {
  if (shouldUseLocalData()) {
    return sortDesc(localDB.get("stock_batches").filter((batch) => !productId || batch.product_id === productId));
  }
  let query = supabase.from("stock_batches").select("*").order("created_at", { ascending: false });
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as StockBatch[];
}

export async function createSale(values: NewRow<"sales">) {
  return insert("sales", values);
}

export async function createPixSale(id: string): Promise<Sale> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/sales/${id}/pix`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  const payload = await response.json() as { sale?: Sale; error?: string };
  if (!response.ok || !payload.sale) throw new Error(payload.error ?? "NÃ£o foi possÃ­vel gerar o PIX da venda.");
  return payload.sale;
}

export async function createSaleItem(values: NewRow<"sale_items">) {
  return insert("sale_items", values);
}

export async function createSupplier(values: any): Promise<any> {
  return insert("suppliers", values);
}

export async function updatePlan(id: string, values: Partial<Plan>) {
  return update("plans", id, values);
}

export async function deletePlan(id: string) {
  if (!shouldUseLocalData()) {
    const { count } = await supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", id)
      .in("status", ["active", "suspended"]);
    if (count && count > 0) {
      throw new Error("Este plano ainda possui matrícula ativa ou suspensa. Troque o plano desses alunos antes de excluí-lo.");
    }
    return update("plans", id, { active: false, deleted_at: new Date().toISOString() });
  } else {
    const enrollments = localDB.get("enrollments").filter((enrollment) =>
      enrollment.plan_id === id && ["active", "suspended"].includes(enrollment.status),
    );
    if (enrollments.length > 0) {
      throw new Error("Este plano ainda possui matrícula ativa ou suspensa. Troque o plano desses alunos antes de excluí-lo.");
    }
    return update("plans", id, { active: false, deleted_at: new Date().toISOString() });
  }
}

export async function updateSupplier(id: string, values: any) {
  return update("suppliers", id, values);
}

export async function deleteSupplier(id: string) {
  if (shouldUseLocalData()) {
    const products = localDB.get("products").filter(p => p.supplier_id === id);
    for (const p of products) await deleteProduct(p.id);
    const receivings = localDB.get("receivings").filter(r => r.supplier_id === id);
    for (const r of receivings) await deleteReceiving(r.id);
    return remove("suppliers", id);
  }
  
  const { data: prods } = await supabase.from("products").select("id").eq("supplier_id", id);
  if (prods) {
    for (const p of prods) await deleteProduct(p.id);
  }
  
  const { data: recs } = await supabase.from("receivings").select("id").eq("supplier_id", id);
  if (recs) {
    for (const r of recs) await deleteReceiving(r.id);
  }
  
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}
