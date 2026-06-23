export type UserRole = "admin" | "receptionist" | "professor" | "student";
export type StudentStatus = "active" | "inactive" | "blocked";
export type EnrollmentStatus = "active" | "suspended" | "cancelled" | "expired";
export type PaymentStatus = "pending" | "paid" | "expired" | "cancelled" | "refunded";
export type PaymentMethod = "pix" | "credit_card" | "debit_card" | "cash";
export type CheckinStatus = "allowed" | "denied";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  last_login?: string | null;
  password?: string;
}

export interface Student {
  id: string;
  profile_id?: string | null;
  full_name: string;
  email?: string | null;
  cpf: string;
  rg?: string | null;
  birth_date: string;
  gender?: string | null;
  phone: string;
  whatsapp?: string | null;
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  weight?: number | null;
  height?: number | null;
  imc?: number | null;
  objective?: string | null;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  observations?: string | null;
  photo_url?: string | null;
  status: StudentStatus;
  qr_code: string;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  duration_days: number;
  weekly_limit: number;
  color: string;
  active: boolean;
  deleted_at?: string | null;
  created_at: string;
}

export interface Enrollment {
  id: string;
  matricula_number: string;
  student_id: string;
  plan_id: string;
  status: EnrollmentStatus;
  start_date: string;
  end_date: string;
  created_at: string;
  student?: Pick<Student, "id" | "full_name" | "status"> | null;
  plan?: Pick<Plan, "id" | "name" | "color" | "price"> | null;
}

export interface Contract {
  id: string;
  student_id: string;
  plan_id: string;
  enrollment_id: string;
  document_text: string;
  status: "pending" | "signed" | "cancelled";
  ip_address?: string | null;
  signature_data?: string | null;
  signed_at?: string | null;
  sent_at?: string | null;
  created_at: string;
  student?: Pick<Student, "id" | "full_name"> | null;
  plan?: Pick<Plan, "id" | "name"> | null;
}

export interface Payment {
  id: string;
  reference: string;
  student_id: string;
  enrollment_id: string;
  amount: number;
  discount: number;
  fine: number;
  total_amount: number;
  status: PaymentStatus;
  method?: PaymentMethod | null;
  due_date: string;
  paid_at?: string | null;
  pix_code?: string | null;
  pix_qr_base64?: string | null;
  pix_ticket_url?: string | null;
  provider_payment_id?: string | null;
  provider_status?: string | null;
  created_at: string;
  student?: Pick<Student, "id" | "full_name"> | null;
}

export interface Checkin {
  id: string;
  student_id?: string | null;
  enrollment_id?: string | null;
  status: CheckinStatus;
  reason?: string | null;
  unit: string;
  checked_at: string;
  student?: Pick<Student, "id" | "full_name"> | null;
}

export interface Notification {
  id: string;
  target_type: "student" | "all";
  target_id?: string | null;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  details: string;
  ip_address?: string | null;
  created_at: string;
  profiles?: Pick<Profile, "full_name"> | null;
}

export interface StudioSettings {
  id: string;
  studio_name: string;
  cnpj: string;
  phone: string;
  email: string;
  address: string;
  contract_template_path?: string | null;
  contract_template_name?: string | null;
  updated_at: string;
}

export interface ClassType {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  duration_minutes: number;
  capacity: number;
  active: boolean;
  created_at: string;
}

export interface ClassBooking {
  id: string;
  session_id: string;
  student_id: string;
  status: "confirmed" | "attended" | "cancelled" | "missed";
  created_at: string;
  student?: Pick<Student, "id" | "full_name"> | null;
}

export interface ClassSession {
  id: string;
  class_type_id: string;
  instructor_id?: string | null;
  start_at: string;
  end_at: string;
  capacity: number;
  status: "scheduled" | "completed" | "cancelled";
  notes?: string | null;
  created_at: string;
  class_type?: ClassType | null;
  instructor?: Pick<Profile, "id" | "full_name"> | null;
  bookings?: ClassBooking[];
}

export interface ClassSchedule {
  id: string;
  class_type_id: string;
  instructor_id?: string | null;
  day_of_week: number;
  time: string;
  capacity: number;
  active: boolean;
  created_at: string;
  class_type?: ClassType | null;
  instructor?: Pick<Profile, "id" | "full_name"> | null;
  student_classes?: StudentClass[];
}

export interface StudentClass {
  id: string;
  student_id: string;
  class_schedule_id: string;
  created_at: string;
  student?: Pick<Student, "id" | "full_name"> | null;
  class_schedule?: ClassSchedule | null;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  permission?: string | null;
  last_seen_at?: string | null;
  created_at: string;
}

export interface ClassAttendance {
  id: string;
  class_schedule_id: string;
  student_id: string;
  date: string; // YYYY-MM-DD
  status: "confirmed" | "cancelled" | "attended" | "missed" | "pending";
  created_at: string;
  student?: Pick<Student, "id" | "full_name" | "photo_url"> | null;
  class_schedule?: ClassSchedule | null;
}

export type ClassOccurrenceStatus = "normal" | "nullified" | "inactivated";

export interface ClassOccurrenceAudit {
  id?: string;
  class_schedule_id: string;
  date: string;
  status: ClassOccurrenceStatus;
  reason?: string | null;
  affected_students?: number;
  audited_at?: string | null;
  audited_by?: string | null;
  class_schedule?: ClassSchedule | null;
  attendance_total?: number;
  confirmed_total?: number;
  missed_total?: number;
}

export interface DashboardStats {
  totalStudents: number;
  activeStudents: number;
  activeEnrollments: number;
  pendingPayments: number;
  monthlyRevenue: number;
  todayCheckins: number;
  overduePayments: number;
  conversionRate: number;
}

export interface RevenuePoint {
  name: string;
  receita: number;
}

// ==========================================
// MÓDULO ERP (ESTOQUE E PDV)
// ==========================================

export interface Supplier {
  id: string;
  corporate_name: string;
  trade_name?: string | null;
  cnpj?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  parent_product_id?: string | null;
  variant_color?: string | null;
  variant_size?: string | null;
  variant_label?: string | null;
  primary_barcode?: string | null;
  internal_code?: string | null;
  barcode?: string | null;
  sku?: string | null;
  name: string;
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;
  unit_measure: string;
  weight?: number | null;
  volume?: number | null;
  average_cost: number;
  current_cost: number;
  selling_price: number;
  minimum_stock: number;
  maximum_stock: number;
  current_stock: number;
  physical_location?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  cest?: string | null;
  active: boolean;
  supplier_id?: string | null;
  photo_url?: string | null;
  created_at: string;
  updated_at: string;
  variants?: ProductVariant[];
  has_variants?: boolean;
  track_lots?: boolean;
  track_expiry?: boolean;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  code: string;
  barcode?: string | null;
  sku?: string | null;
  color?: string | null;
  size?: string | null;
  label: string;
  current_stock: number;
  minimum_stock: number;
  maximum_stock: number;
  current_cost: number;
  selling_price: number;
  physical_location?: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StockBatch {
  id: string;
  product_id: string;
  variant_id?: string | null;
  receiving_item_id?: string | null;
  lot_number?: string | null;
  manufacturing_date?: string | null;
  expiry_date?: string | null;
  received_quantity: number;
  available_quantity: number;
  unit_cost: number;
  status: "active" | "depleted" | "expired" | "blocked";
  created_at: string;
  updated_at: string;
}

export interface Receiving {
  id: string;
  invoice_number?: string | null;
  invoice_key?: string | null;
  supplier_id?: string | null;
  issue_date?: string | null;
  expected_delivery_date?: string | null;
  total_amount: number;
  total_items: number;
  status: "Aguardando Chegada" | "Recebido" | "Em Triagem" | "Triagem Concluída" | "Divergência" | "Finalizado";
  observations?: string | null;
  xml_url?: string | null;
  pdf_url?: string | null;
  operator_id?: string | null;
  created_at: string;
  updated_at: string;
  supplier?: Supplier | null;
}

export interface ReceivingItem {
  id: string;
  receiving_id: string;
  product_id: string;
  variant_id?: string | null;
  expected_quantity: number;
  checked_quantity: number;
  unit_cost: number;
  total_cost: number;
  status: "Pendente" | "Conferido" | "Divergente";
  lot_number?: string | null;
  manufacturing_date?: string | null;
  expiry_date?: string | null;
  created_at: string;
  product?: Product | null;
  variant?: ProductVariant | null;
}

export interface InventoryTransaction {
  id: string;
  product_id: string;
  variant_id?: string | null;
  batch_id?: string | null;
  transaction_type: "IN" | "OUT" | "ADJ";
  quantity: number;
  previous_stock: number;
  new_stock: number;
  reason?: string | null;
  reference_id?: string | null;
  operator_id?: string | null;
  created_at: string;
  product?: Product | null;
  variant?: ProductVariant | null;
}

export interface Sale {
  id: string;
  student_id?: string | null;
  total_amount: number;
  discount: number;
  final_amount: number;
  payment_method?: "pix" | "credit_card" | "debit_card" | "cash" | "mixed" | null;
  status: "pending" | "completed" | "cancelled";
  operator_id?: string | null;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  variant_id?: string | null;
  batch_id?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
  product?: Product | null;
  variant?: ProductVariant | null;
}

export interface LocalTables {
  profiles: Profile;
  students: Student;
  plans: Plan;
  enrollments: Omit<Enrollment, "student" | "plan">;
  contracts: Omit<Contract, "student" | "plan">;
  payments: Omit<Payment, "student">;
  checkins: Omit<Checkin, "student">;
  notifications: Notification;
  audit_logs: AuditLog;
  push_subscriptions: PushSubscriptionRow;
  class_attendances: ClassAttendance;
  settings: StudioSettings;
  class_types: ClassType;
  class_sessions: Omit<ClassSession, "class_type" | "instructor" | "bookings">;
  class_bookings: Omit<ClassBooking, "student">;
  class_schedules: ClassSchedule;
  student_classes: StudentClass;
  suppliers: Supplier;
  products: Omit<Product, "supplier">;
  product_variants: ProductVariant;
  stock_batches: StockBatch;
  receivings: Omit<Receiving, "supplier">;
  receiving_items: Omit<ReceivingItem, "product">;
  inventory_transactions: Omit<InventoryTransaction, "product">;
  sales: Sale;
  sale_items: Omit<SaleItem, "product">;
}

export type TableName = keyof LocalTables;
export type NewRow<T extends TableName> = Omit<LocalTables[T], "id" | "created_at"> &
  Partial<Pick<LocalTables[T], Extract<keyof LocalTables[T], "id" | "created_at">>>;
