"use client";

import type { AuditLog, LocalTables, NewRow, TableName } from "@/lib/types";

const PREFIX = "corpoevolucao_v2_";
const VERSION_KEY = `${PREFIX}ready`;
const CREATED_AT_TABLES = new Set<TableName>([
  "profiles", "students", "plans", "enrollments", "contracts", "payments", "notifications", "audit_logs", "class_types", "class_sessions", "class_bookings",
  "class_schedules", "student_classes", "push_subscriptions", "class_attendances",
  "suppliers", "products", "product_variants", "stock_batches", "receivings", "receiving_items", "inventory_transactions", "sales", "sale_items"
]);
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function read<T extends TableName>(table: T): LocalTables[T][] {
  const storage = browserStorage();
  if (!storage) return [];
  try {
    return JSON.parse(storage.getItem(`${PREFIX}${table}`) ?? "[]") as LocalTables[T][];
  } catch {
    return [];
  }
}

function write<T extends TableName>(table: T, rows: LocalTables[T][]) {
  browserStorage()?.setItem(`${PREFIX}${table}`, JSON.stringify(rows));
}

function audit(action: string, entity: TableName, entityId: string, details: string) {
  if (entity === "audit_logs") return;
  const storage = browserStorage();
  let profile: { id?: string; full_name?: string } | null = null;
  try {
    profile = JSON.parse(storage?.getItem("currentUser") ?? "null");
  } catch {
    profile = null;
  }

  const rows = read("audit_logs");
  rows.unshift({
    id: makeId(),
    user_id: profile?.id ?? null,
    action,
    entity,
    entity_id: entityId,
    details,
    created_at: now(),
    profiles: { full_name: profile?.full_name ?? "Sistema" },
  } satisfies AuditLog);
  write("audit_logs", rows);
}

export function initLocalDB() {
  const storage = browserStorage();
  if (!storage || storage.getItem(VERSION_KEY)) return;

  const createdAt = now();
  const currentDate = today();
  const students: LocalTables["students"][] = [
    {
      id: "student-ana",
      full_name: "Ana Carolina Silva",
      email: "ana.silva@email.com",
      cpf: "123.456.789-10",
      birth_date: "1994-03-12",
      gender: "feminino",
      phone: "(11) 98888-1201",
      whatsapp: "(11) 98888-1201",
      city: "São Paulo",
      state: "SP",
      weight: 62,
      height: 168,
      imc: 21.97,
      objective: "Condicionamento",
      status: "active",
      qr_code: "CE-ANA-001",
      created_at: addDays(currentDate, -120),
      updated_at: createdAt,
    },
    {
      id: "student-bruno",
      full_name: "Bruno Mendes",
      email: "bruno.mendes@email.com",
      cpf: "987.654.321-00",
      birth_date: "1989-11-05",
      gender: "masculino",
      phone: "(11) 97777-9030",
      whatsapp: "(11) 97777-9030",
      city: "São Paulo",
      state: "SP",
      weight: 84,
      height: 180,
      imc: 25.93,
      objective: "Hipertrofia",
      status: "active",
      qr_code: "CE-BRUNO-002",
      created_at: addDays(currentDate, -65),
      updated_at: createdAt,
    },
    {
      id: "student-carla",
      full_name: "Carla Souza",
      email: "carla.souza@email.com",
      cpf: "111.222.333-44",
      birth_date: "1998-07-23",
      gender: "feminino",
      phone: "(11) 96666-5544",
      whatsapp: "(11) 96666-5544",
      city: "São Paulo",
      state: "SP",
      status: "inactive",
      qr_code: "CE-CARLA-003",
      created_at: addDays(currentDate, -210),
      updated_at: createdAt,
    },
  ];
  const plans: LocalTables["plans"][] = [
    {
      id: "plan-essential",
      name: "Essential",
      description: "Treinos livres com acompanhamento da equipe.",
      price: 129.9,
      duration_days: 30,
      weekly_limit: 5,
      color: "#1a73e8",
      active: true,
      created_at: createdAt,
    },
    {
      id: "plan-performance",
      name: "Performance",
      description: "Acesso completo, avaliação mensal e plano de evolução.",
      price: 199.9,
      duration_days: 30,
      weekly_limit: 7,
      color: "#0f9d58",
      active: true,
      created_at: createdAt,
    },
    {
      id: "plan-annual",
      name: "Performance Anual",
      description: "Plano completo anual com melhor custo-benefício.",
      price: 1899,
      duration_days: 365,
      weekly_limit: 7,
      color: "#a142f4",
      active: true,
      created_at: createdAt,
    },
  ];
  const enrollments: LocalTables["enrollments"][] = [
    {
      id: "enrollment-ana",
      matricula_number: "MAT-2026-0001",
      student_id: "student-ana",
      plan_id: "plan-performance",
      status: "active",
      start_date: addDays(currentDate, -15),
      end_date: addDays(currentDate, 15),
      created_at: addDays(currentDate, -15),
    },
    {
      id: "enrollment-bruno",
      matricula_number: "MAT-2026-0002",
      student_id: "student-bruno",
      plan_id: "plan-annual",
      status: "active",
      start_date: addDays(currentDate, -45),
      end_date: addDays(currentDate, 320),
      created_at: addDays(currentDate, -45),
    },
  ];
  const payments: LocalTables["payments"][] = [
    {
      id: "payment-ana",
      reference: "MEN-2026-0001",
      student_id: "student-ana",
      enrollment_id: "enrollment-ana",
      amount: 199.9,
      discount: 0,
      fine: 0,
      total_amount: 199.9,
      status: "paid",
      method: "pix",
      due_date: addDays(currentDate, -15),
      paid_at: addDays(currentDate, -15),
      created_at: addDays(currentDate, -18),
    },
    {
      id: "payment-bruno",
      reference: "MEN-2026-0002",
      student_id: "student-bruno",
      enrollment_id: "enrollment-bruno",
      amount: 1899,
      discount: 100,
      fine: 0,
      total_amount: 1799,
      status: "pending",
      method: null,
      due_date: addDays(currentDate, 3),
      created_at: addDays(currentDate, -2),
    },
  ];
  const checkins: LocalTables["checkins"][] = [
    {
      id: "checkin-ana",
      student_id: "student-ana",
      enrollment_id: "enrollment-ana",
      status: "allowed",
      reason: null,
      unit: "Matriz",
      checked_at: createdAt,
    },
  ];
  const contracts: LocalTables["contracts"][] = enrollments.map((enrollment) => ({
    id: `contract-${enrollment.id}`,
    student_id: enrollment.student_id,
    plan_id: enrollment.plan_id,
    enrollment_id: enrollment.id,
    document_text: "Termo de adesão ao plano contratado.",
    status: enrollment.id === "enrollment-bruno" ? "pending" : "signed",
    signed_at: enrollment.id === "enrollment-bruno" ? null : createdAt,
    created_at: enrollment.created_at,
  }));

  write("profiles", [
    {
      id: "profile-admin",
      email: "admin@admin.com",
      password: "admin",
      full_name: "Administrador",
      role: "admin",
      active: true,
      created_at: createdAt,
    },
    {
      id: "profile-reception",
      email: "recepcao@studio.com",
      password: "recepcao",
      full_name: "Marina Recepção",
      role: "receptionist",
      active: true,
      created_at: createdAt,
    },
  ]);
  write("students", students);
  write("plans", plans);
  write("enrollments", enrollments);
  write("payments", payments);
  write("checkins", checkins);
  write("contracts", contracts);
  write("notifications", [
    {
      id: "notification-welcome",
      target_type: "all",
      target_id: null,
      title: "Agenda de avaliações aberta",
      message: "Os horários para avaliação física deste mês já estão disponíveis.",
      read: false,
      created_at: createdAt,
    },
  ]);
  write("audit_logs", []);
  write("class_types", [
    {
      id: "class-type-functional",
      name: "Treino funcional",
      description: "Condicionamento, força e mobilidade.",
      color: "#1a73e8",
      duration_minutes: 60,
      capacity: 12,
      active: true,
      created_at: createdAt,
    },
    {
      id: "class-type-pilates",
      name: "Pilates",
      description: "Controle corporal e mobilidade.",
      color: "#8430ce",
      duration_minutes: 50,
      capacity: 8,
      active: true,
      created_at: createdAt,
    },
  ]);
  const firstClass = new Date();
  firstClass.setHours(firstClass.getHours() + 2, 0, 0, 0);
  const secondClass = new Date(firstClass);
  secondClass.setDate(secondClass.getDate() + 1);
  secondClass.setHours(8, 0, 0, 0);
  write("class_sessions", [
    {
      id: "session-functional",
      class_type_id: "class-type-functional",
      instructor_id: "profile-admin",
      start_at: firstClass.toISOString(),
      end_at: new Date(firstClass.getTime() + 60 * 60 * 1000).toISOString(),
      capacity: 12,
      status: "scheduled",
      notes: null,
      created_at: createdAt,
    },
    {
      id: "session-pilates",
      class_type_id: "class-type-pilates",
      instructor_id: "profile-admin",
      start_at: secondClass.toISOString(),
      end_at: new Date(secondClass.getTime() + 50 * 60 * 1000).toISOString(),
      capacity: 8,
      status: "scheduled",
      notes: null,
      created_at: createdAt,
    },
  ]);
  write("class_bookings", [
    {
      id: "booking-ana-functional",
      session_id: "session-functional",
      student_id: "student-ana",
      status: "confirmed",
      created_at: createdAt,
    },
  ]);
  write("class_schedules", []);
  write("student_classes", []);
  write("push_subscriptions", []);
  write("class_attendances", []);
  write("product_variants", []);
  write("stock_batches", []);
  write("settings", [
    {
      id: "studio",
      studio_name: "Studio Corpo & Evolução",
      cnpj: "00.000.000/0001-00",
      phone: "(11) 99999-9999",
      email: "contato@studio.com.br",
      address: "São Paulo, SP",
      updated_at: createdAt,
    },
  ]);
  storage.setItem(VERSION_KEY, "true");
}

export const localDB = {
  get<T extends TableName>(table: T): LocalTables[T][] {
    initLocalDB();
    return read(table);
  },

  find<T extends TableName>(table: T, id: string): LocalTables[T] | null {
    return this.get(table).find((row) => row.id === id) ?? null;
  },

  insert<T extends TableName>(table: T, values: NewRow<T>): LocalTables[T] {
    const rows = this.get(table);
    const row = {
      id: values.id ?? makeId(),
      ...(CREATED_AT_TABLES.has(table)
        ? { created_at: (values as { created_at?: string }).created_at ?? now() }
        : {}),
      ...values,
    } as LocalTables[T];
    rows.unshift(row);
    write(table, rows);
    audit("CREATE", table, row.id, `Registro criado em ${table}`);
    return row;
  },

  update<T extends TableName>(
    table: T,
    id: string,
    values: Partial<LocalTables[T]>,
  ): LocalTables[T] | null {
    const rows = this.get(table);
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return null;
    rows[index] = { ...rows[index], ...values };
    write(table, rows);
    audit("UPDATE", table, id, `Registro atualizado em ${table}`);
    return rows[index];
  },

  delete<T extends TableName>(table: T, id: string) {
    const rows = this.get(table);
    const next = rows.filter((row) => row.id !== id);
    if (next.length === rows.length) return false;
    write(table, next);
    audit("DELETE", table, id, `Registro removido de ${table}`);
    return true;
  },
};

initLocalDB();
