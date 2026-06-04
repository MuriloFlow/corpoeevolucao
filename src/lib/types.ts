// ============================================================
// DATABASE TYPES - Studio Corpo e Evolução
// ============================================================

export type UserRole = "admin" | "receptionist" | "professor";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  description: string | null;
  duration_days: number;
  weekly_limit: number | null;
  allowed_hours: string[] | null;
  active: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

export type StudentStatus = "active" | "inactive" | "blocked";
export type Gender = "M" | "F" | "Other";

export interface Student {
  id: string;
  user_id: string | null;
  full_name: string;
  birth_date: string | null;
  gender: Gender | null;
  cpf: string | null;
  rg: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  weight: number | null;
  height: number | null;
  imc: number | null;
  objective: string | null;
  photo_url: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  observations: string | null;
  status: StudentStatus;
  qr_code: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EnrollmentStatus = "active" | "suspended" | "cancelled" | "expired";

export interface Enrollment {
  id: string;
  student_id: string;
  plan_id: string;
  matricula_number: string;
  status: EnrollmentStatus;
  start_date: string;
  end_date: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  student?: Student;
  plan?: Plan;
}

export type PaymentStatus = "pending" | "paid" | "expired" | "cancelled" | "refunded";
export type PaymentMethod = "pix" | "credit_card" | "debit_card" | "cash";

export interface Payment {
  id: string;
  enrollment_id: string;
  student_id: string;
  amount: number;
  discount: number;
  fine: number;
  total_amount: number;
  method: PaymentMethod | null;
  status: PaymentStatus;
  due_date: string;
  paid_at: string | null;
  pix_qr_code: string | null;
  pix_code: string | null;
  reference: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  student?: Student;
  enrollment?: Enrollment;
}

export type CheckinStatus = "allowed" | "denied";

export interface Checkin {
  id: string;
  student_id: string;
  enrollment_id: string;
  checked_at: string;
  unit: string;
  receptionist_id: string | null;
  status: CheckinStatus;
  denied_reason: string | null;
  created_at: string;
  // Joined data
  student?: Student;
  receptionist?: Profile;
}

export type ContractStatus = "pending" | "signed" | "cancelled";

export interface Contract {
  id: string;
  enrollment_id: string;
  student_id: string;
  plan_id: string;
  template_content: string | null;
  processed_content: string | null;
  status: ContractStatus;
  pdf_url: string | null;
  sent_to_email: boolean;
  signature_type: string | null;
  signature_data: string | null;
  signed_at: string | null;
  signer_name: string | null;
  signer_cpf: string | null;
  signer_ip: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  student?: Student;
  plan?: Plan;
  enrollment?: Enrollment;
}

export interface Notification {
  id: string;
  target_id: string | null;
  target_type: "student" | "all";
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string | null;
  ip: string | null;
  created_at: string;
}

export interface DashboardStats {
  totalStudents: number;
  activeStudents: number;
  activeEnrollments: number;
  pendingPayments: number;
  monthlyRevenue: number;
  annualRevenue: number;
  todayCheckins: number;
  overduePayments: number;
}

// Form types
export interface StudentFormData {
  full_name: string;
  birth_date: string;
  gender: Gender;
  cpf: string;
  rg: string;
  phone: string;
  whatsapp: string;
  email: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  weight: number | null;
  height: number | null;
  objective: string;
  emergency_contact: string;
  emergency_phone: string;
  observations: string;
}

export interface EnrollmentFormData {
  student_id: string;
  plan_id: string;
  start_date: string;
  end_date: string;
}

export interface PaymentFormData {
  enrollment_id: string;
  student_id: string;
  amount: number;
  discount: number;
  fine: number;
  due_date: string;
  notes: string;
}

export interface PlanFormData {
  name: string;
  price: number;
  description: string;
  duration_days: number;
  weekly_limit: number;
  color: string;
}
