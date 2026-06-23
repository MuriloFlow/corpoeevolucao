"use client";

import { Activity, ArrowLeft, Bell, CalendarDays, Check, CheckCircle2, ChevronRight, Copy, CreditCard, Expand, FileCheck2, FileSignature, Flame, Home, Loader2, LogOut, Mail, QrCode, UserRound, XCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { StudentQrCard } from "@/components/student-qr-card";
import { ErrorBanner, LoadingState, Modal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { createPixPayment, updateAttendanceStatus } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ClassAttendance, Student } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";

const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "BE8FMu1NZtQh2QVULUShurqQlruZMOECnnw2HuHmx2X63Iv0jxuDLquhVva4lERZmuMsUE5OjzKRbWi1As0ZQlY";

type PortalTab = "home" | "payments" | "qr" | "classes" | "settings" | "notifications";
type StudentClassLink = {
  id: string;
  class_schedule_id: string;
  class_schedule?: {
    id: string;
    time: string;
    day_of_week: number;
    active?: boolean;
    class_type?: { id?: string; name?: string; color?: string; duration_minutes?: number | null } | null;
    instructor?: { id?: string; full_name?: string | null } | null;
  } | null;
};

type PortalData = {
  student: Student;
  attendances: ClassAttendance[];
  attendanceHistory?: ClassAttendance[];
  weeklyClasses: StudentClassLink[];
  payments: Array<{ id: string; reference: string; total_amount: number; status: string; due_date: string; pix_code?: string; pix_qr_base64?: string }>;
  contracts: Array<{ id: string; status: string; signed_at?: string | null; created_at: string; plan?: { name: string } }>;
  notifications?: Array<{ id: string; title: string; message: string; read?: boolean; created_at: string }>;
  recentCheckins?: Array<{ id: string; status: string; unit?: string | null; checked_at: string }>;
  activitySummary?: {
    streakDays: number;
    confirmedClasses: number;
    allowedCheckins: number;
    weeklyGoal: number;
    weekStart: string;
    weekEnd: string;
    weeklyCompletedActivities: number;
    previousWeeklyCompletedActivities: number;
    weeklyAllowedCheckins: number;
    previousWeeklyAllowedCheckins: number;
    weeklyCalories: number;
    previousWeeklyCalories: number;
    weeklyCaloriesDelta: number;
    weeklyActivitiesDelta: number;
    weeklyActiveMinutes: number;
    previousWeeklyActiveMinutes: number;
    activityDates: string[];
  };
  requiredContract?: { id: string; created_at: string; signingUrl: string; plan?: { name: string } | null } | null;
};

const weekLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const orderedWeek = [1, 2, 3, 4, 5, 6, 0];
const paymentIntentStorageKey = "corpoevolucao:portal-payment-intent";
const paidNoticeStorageKey = "corpoevolucao:portal-paid-notice";

type PaymentIntent = {
  studentId: string;
  paymentId: string;
  reference: string;
  totalAmount: number;
  expiresAt: number;
};
type PaidNotice = PaymentIntent;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function bufferSourceToUint8Array(value?: BufferSource | null) {
  if (!value) return null;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function samePushApplicationKey(subscription: PushSubscription) {
  const currentKey = bufferSourceToUint8Array(subscription.options.applicationServerKey);
  if (!currentKey) return true;
  const configuredKey = urlBase64ToUint8Array(publicVapidKey);
  if (currentKey.length !== configuredKey.length) return false;
  return currentKey.every((value, index) => value === configuredKey[index]);
}

function pushErrorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason || "");
  const normalized = message.toLowerCase();
  if (normalized.includes("permission") || normalized.includes("notallowed") || normalized.includes("denied")) {
    return "As notificacoes estao bloqueadas para este app. Libere nas configuracoes do navegador/celular e toque em Ativar novamente.";
  }
  if (normalized.includes("invalidaccess") || normalized.includes("applicationserverkey") || normalized.includes("vapid")) {
    return "A chave de notificacao do app mudou. Atualize o app, abra novamente e toque em Ativar para recriar o dispositivo.";
  }
  if (normalized.includes("service worker") || normalized.includes("registration") || normalized.includes("abort")) {
    return "O app atualizou o servico de notificacoes. Feche e abra o app uma vez; se continuar, toque em Ativar novamente.";
  }
  if (normalized.includes("banco") || normalized.includes("database") || normalized.includes("relation") || normalized.includes("constraint")) {
    return `${message} A migration de push precisa estar aplicada no Supabase.`;
  }
  return message || "Nao foi possivel ativar notificacoes agora. Abra o portal instalado, confira a internet e toque em Ativar novamente.";
}

function initials(name?: string | null) {
  return (name || "Aluno").split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function firstName(name?: string | null) {
  return (name || "Aluno").trim().split(/\s+/)[0] || "Aluno";
}

function classTime(time?: string | null) {
  return time ? time.slice(0, 5) : "--:--";
}

function notificationTime(value: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return formatDate(value);
  }
}

function isAttendanceDone(status?: ClassAttendance["status"]) {
  return status === "confirmed" || status === "attended";
}

function attendanceLabel(status?: ClassAttendance["status"]) {
  if (status === "confirmed" || status === "attended") return "Confirmado";
  if (status === "cancelled") return "Cancelado";
  if (status === "missed") return "Faltou";
  return "Pendente";
}

function isoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentWeekDates() {
  const today = new Date();
  const monday = new Date(today);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return orderedWeek.map((day, index) => {
    const value = new Date(monday);
    value.setDate(monday.getDate() + index);
    return { day, date: isoDate(value) };
  });
}

function readPortalStorage<T>(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function writePortalStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export default function StudentPortalPage() {
  const { user, isLoading, logout } = useAuth();
  const [data, setData] = useState<PortalData | null>(null);
  const [activeTab, setActiveTab] = useState<PortalTab>("home");
  const [error, setError] = useState<string | null>(null);
  const [pix, setPix] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [notificationWorking, setNotificationWorking] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(true);
  const [pushChecking, setPushChecking] = useState(true);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushIssue, setPushIssue] = useState<string | null>(null);
  const [paidNotice, setPaidNotice] = useState<PaidNotice | null>(null);
  const [appAlert, setAppAlert] = useState<{ title: string; message: string } | null>(null);
  const [emailChange, setEmailChange] = useState({
    open: false,
    step: "current" as "current" | "new" | "done",
    requestId: "",
    newEmail: "",
    currentCode: "",
    newCode: "",
    message: "",
    error: "",
    working: false,
  });
  const appAlertTimeoutRef = useRef<number | null>(null);
  const pushRequestRef = useRef(false);

  function changeTab(tab: PortalTab) {
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const nextUrl = tab === "home" ? "/portal" : `/portal?tab=${tab}`;
    window.history.replaceState(null, "", nextUrl);
  }

  useEffect(() => () => {
    if (appAlertTimeoutRef.current) window.clearTimeout(appAlertTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!paidNotice) return;
    const remaining = Math.max(0, paidNotice.expiresAt - Date.now());
    const timeout = window.setTimeout(() => {
      window.localStorage.removeItem(paidNoticeStorageKey);
      setPaidNotice(null);
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [paidNotice]);

  async function reloadData(token?: string) {
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch("/api/student/portal", {
      headers: { Authorization: `Bearer ${token ?? session.session?.access_token ?? ""}` },
      cache: "no-store",
    });
    const payload = await response.json() as PortalData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Nao foi possivel carregar seu portal.");
    syncPaidNotice(payload);
    setData(payload);
  }

  function syncPaidNotice(payload: PortalData) {
    const now = Date.now();
    const storedNotice = readPortalStorage<PaidNotice>(paidNoticeStorageKey);
    if (storedNotice?.expiresAt && storedNotice.expiresAt > now && storedNotice.studentId === payload.student.id) {
      setPaidNotice(storedNotice);
    } else if (storedNotice) {
      window.localStorage.removeItem(paidNoticeStorageKey);
      setPaidNotice(null);
    }

    const intent = readPortalStorage<PaymentIntent>(paymentIntentStorageKey);
    if (!intent || intent.studentId !== payload.student.id || intent.expiresAt <= now) {
      if (intent) window.localStorage.removeItem(paymentIntentStorageKey);
      return;
    }

    const stillPending = payload.payments.some((payment) =>
      payment.id === intent.paymentId && (payment.status === "pending" || payment.status === "expired")
    );
    if (stillPending) return;

    const notice = { ...intent, expiresAt: now + 60_000 };
    writePortalStorage(paidNoticeStorageKey, notice);
    window.localStorage.removeItem(paymentIntentStorageKey);
    setPaidNotice(notice);
  }

  useEffect(() => {
    if (!user || user.app_role !== "student") return;
    let notificationPermissionStatus: PermissionStatus | null = null;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "qr" || tab === "payments" || tab === "classes" || tab === "settings" || tab === "home" || tab === "notifications") setActiveTab(tab);
    reloadData().catch((reason: Error) => setError(reason.message));

    function requestPortalFullscreen() {
      const requestFullscreen = document.documentElement.requestFullscreen;
      if (!document.fullscreenElement && requestFullscreen) void requestFullscreen.call(document.documentElement).catch(() => {});
    }

    window.addEventListener("pointerdown", requestPortalFullscreen, { once: true });
    window.addEventListener("touchstart", requestPortalFullscreen, { once: true });

    if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
      setPushSupported(true);
      navigator.serviceWorker.register("/sw.js").then(async (reg) => {
        try {
          await reg.update().catch(() => {});
          const readyRegistration = await navigator.serviceWorker.ready;
          if (Notification.permission === "granted") {
            await ensurePushSubscription(readyRegistration);
            setPushEnabled(true);
            setPushSuccess(false);
            setPushIssue(null);
          } else {
            setPushEnabled(false);
            setPushSuccess(false);
          }
        } catch (reason) {
          setPushIssue(pushErrorMessage(reason));
          setPushEnabled(false);
        } finally {
          setPushChecking(false);
        }
      }).catch(() => {
        setPushEnabled(false);
        setPushChecking(false);
      });
    } else {
      setPushSupported(false);
      setPushEnabled(true);
      setPushChecking(false);
    }

    if ("permissions" in navigator && "Notification" in window) {
      navigator.permissions.query({ name: "notifications" as PermissionName }).then((status) => {
        notificationPermissionStatus = status;
        status.onchange = () => {
          setPushSuccess(false);
          if (Notification.permission !== "granted") {
            setPushEnabled(false);
            setPushChecking(false);
            setPushIssue(Notification.permission === "denied"
              ? "As notificacoes foram bloqueadas no aparelho. Libere nas configuracoes do navegador/celular para ativar de novo."
              : null);
          }
        };
      }).catch(() => {});
    }

    return () => {
      if (notificationPermissionStatus) notificationPermissionStatus.onchange = null;
      window.removeEventListener("pointerdown", requestPortalFullscreen);
      window.removeEventListener("touchstart", requestPortalFullscreen);
    };
  }, [user]);

  async function savePushSubscription(subscription: PushSubscription) {
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        subscription,
        permission: "Notification" in window ? Notification.permission : "unsupported",
        profile_id: user?.id,
        student_id: data?.student.id,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Nao foi possivel registrar notificacoes.");
    }
  }

  async function ensurePushSubscription(registration: ServiceWorkerRegistration, forceRenew = false) {
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && (forceRenew || !samePushApplicationKey(subscription))) {
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }
    if (!subscription) {
      subscription = await createPushSubscription(registration, forceRenew);
    }
    await savePushSubscription(subscription);
    return subscription;
  }

  async function createPushSubscription(registration: ServiceWorkerRegistration, allowRecovery: boolean) {
    try {
      return await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
      });
    } catch (reason) {
      if (!allowRecovery) throw reason;

      const rootScope = `${window.location.origin}/`;
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter((item) => item.scope === rootScope)
        .map((item) => item.unregister().catch(() => false)));

      const freshRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await freshRegistration.update().catch(() => {});
      const readyRegistration = await navigator.serviceWorker.ready;
      return readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
      });
    }
  }

  async function showLocalNotification(title: string, message: string) {
    setAppAlert({ title, message });
    if (appAlertTimeoutRef.current) window.clearTimeout(appAlertTimeoutRef.current);
    appAlertTimeoutRef.current = window.setTimeout(() => setAppAlert(null), 6500);
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body: message,
        icon: "/icon-192x192.png",
        badge: "/icon-192x192.png",
        tag: "student-notifications",
        data: { url: "/portal?tab=notifications" },
      });
    } catch {
      new Notification(title, { body: message, icon: "/icon-192x192.png" });
    }
  }

  useEffect(() => {
    if (!data?.student.id) return;
    function handleNotification(payload: { new: Record<string, unknown> }) {
      const notification = payload.new as { id?: string; title?: string; message?: string; read?: boolean; created_at?: string };
      setData((current) => current
        ? {
            ...current,
            notifications: [
              {
                id: notification.id || `local-${Date.now()}`,
                title: notification.title || "Corpo & Evolucao",
                message: notification.message || "Voce tem um novo aviso.",
                read: notification.read ?? false,
                created_at: notification.created_at || new Date().toISOString(),
              },
              ...(current.notifications ?? []),
            ].slice(0, 80),
          }
        : current);
      void showLocalNotification(notification.title || "Corpo & Evolucao", notification.message || "Voce tem um novo aviso.");
    }

    const studentChannel = supabase.channel(`student-notifications-${data.student.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `target_id=eq.${data.student.id}` }, handleNotification)
      .subscribe();
    const globalChannel = supabase.channel(`student-global-notifications-${data.student.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "target_type=eq.all" }, handleNotification)
      .subscribe();

    return () => {
      supabase.removeChannel(studentChannel);
      supabase.removeChannel(globalChannel);
    };
  }, [data?.student.id]);

  async function subscribePush() {
    if (pushRequestRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushSupported(false);
      setPushIssue("Este navegador nao suporta push nativo. No iPhone, instale o portal na tela inicial e abra pelo icone do app.");
      return;
    }
    pushRequestRef.current = true;
    setPushIssue(null);
    setPushSuccess(false);
    setPushChecking(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushIssue("Voce bloqueou as notificacoes. Libere nas configuracoes do navegador/celular e toque em Ativar novamente.");
        setPushEnabled(false);
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await registration.update().catch(() => {});
      const readyRegistration = await navigator.serviceWorker.ready;
      await ensurePushSubscription(readyRegistration, true);
      setPushIssue(null);
      setPushSuccess(true);
      await reloadData();
      window.setTimeout(() => {
        setPushEnabled(true);
        setPushSuccess(false);
      }, 850);
    } catch (reason) {
      setPushEnabled(false);
      setPushSuccess(false);
      setPushIssue(pushErrorMessage(reason));
    } finally {
      setPushChecking(false);
      pushRequestRef.current = false;
    }
  }

  async function answerAttendance(attendance: ClassAttendance, status: "confirmed" | "cancelled") {
    setLoadingAction(attendance.id);
    try {
      const updated = await updateAttendanceStatus(attendance, status);
      setData((current) => current
        ? { ...current, attendances: current.attendances.map((item) => item.id === attendance.id ? { ...item, ...updated } : item) }
        : current);
      await reloadData();
    } catch (reason: any) {
      alert(reason.message || "Erro ao confirmar.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function generatePix(paymentId: string) {
    setWorking(paymentId);
    setError(null);
    try {
      const payment = data?.payments.find((item) => item.id === paymentId);
      if (data?.student.id && payment) {
        writePortalStorage(paymentIntentStorageKey, {
          studentId: data.student.id,
          paymentId,
          reference: payment.reference,
          totalAmount: Number(payment.total_amount),
          expiresAt: Date.now() + 20 * 60_000,
        } satisfies PaymentIntent);
      }
      const generated = await createPixPayment(paymentId);
      setPix(generated);
      if (data?.student.id && generated?.status === "paid") {
        const notice: PaidNotice = {
          studentId: data.student.id,
          paymentId,
          reference: payment?.reference || "Fatura",
          totalAmount: Number(payment?.total_amount || generated.total_amount || 0),
          expiresAt: Date.now() + 60_000,
        };
        writePortalStorage(paidNoticeStorageKey, notice);
        window.localStorage.removeItem(paymentIntentStorageKey);
        setPaidNotice(notice);
      }
      await reloadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nao foi possivel gerar o PIX.");
    } finally {
      setWorking(null);
    }
  }

  async function copyPix() {
    if (!pix?.pix_code) return;
    await navigator.clipboard.writeText(pix.pix_code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function markNotificationsRead(notificationIds?: string[]) {
    const ids = notificationIds?.length
      ? notificationIds
      : (data?.notifications ?? []).filter((notification) => !notification.read).map((notification) => notification.id);
    if (!ids.length) return;

    const workingKey = notificationIds?.length === 1 ? notificationIds[0] : "all";
    setNotificationWorking(workingKey);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch("/api/student/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token ?? ""}`,
        },
        body: JSON.stringify(notificationIds?.length ? { notificationIds: ids } : { markAll: true }),
      });
      const payload = await response.json().catch(() => ({})) as { readIds?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Nao foi possivel marcar notificacoes como lidas.");
      const readIds = new Set(payload.readIds?.length ? payload.readIds : ids);
      setData((current) => current
        ? {
            ...current,
            notifications: (current.notifications ?? []).map((notification) => readIds.has(notification.id)
              ? { ...notification, read: true }
              : notification),
          }
        : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nao foi possivel marcar notificacoes como lidas.");
    } finally {
      setNotificationWorking(null);
    }
  }

  function openEmailChange() {
    setEmailChange({
      open: true,
      step: "current",
      requestId: "",
      newEmail: "",
      currentCode: "",
      newCode: "",
      message: "",
      error: "",
      working: false,
    });
  }

  async function postEmailChange(body: Record<string, unknown>) {
    const { data: session } = await supabase.auth.getSession();
    const response = await fetch("/api/student/email-change", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Nao foi possivel alterar seu e-mail.");
    return payload;
  }

  async function startEmailChange() {
    setEmailChange((current) => ({ ...current, working: true, error: "", message: "" }));
    try {
      const payload = await postEmailChange({ action: "start" }) as { requestId: string; currentEmail: string };
      setEmailChange((current) => ({
        ...current,
        requestId: payload.requestId,
        message: `Codigo enviado para ${payload.currentEmail}.`,
        working: false,
      }));
    } catch (reason) {
      setEmailChange((current) => ({ ...current, working: false, error: reason instanceof Error ? reason.message : "Nao foi possivel enviar o codigo." }));
    }
  }

  async function verifyCurrentEmail() {
    setEmailChange((current) => ({ ...current, working: true, error: "", message: "" }));
    try {
      const payload = await postEmailChange({
        action: "verify_current",
        requestId: emailChange.requestId,
        code: emailChange.currentCode,
        newEmail: emailChange.newEmail,
      }) as { newEmail: string };
      setEmailChange((current) => ({
        ...current,
        step: "new",
        newEmail: payload.newEmail,
        message: `Codigo enviado para ${payload.newEmail}.`,
        working: false,
      }));
    } catch (reason) {
      setEmailChange((current) => ({ ...current, working: false, error: reason instanceof Error ? reason.message : "Codigo invalido." }));
    }
  }

  async function verifyNewEmail() {
    setEmailChange((current) => ({ ...current, working: true, error: "", message: "" }));
    try {
      const payload = await postEmailChange({
        action: "verify_new",
        requestId: emailChange.requestId,
        code: emailChange.newCode,
      }) as { email: string };
      await reloadData();
      setEmailChange((current) => ({
        ...current,
        step: "done",
        message: `E-mail alterado para ${payload.email}.`,
        working: false,
      }));
    } catch (reason) {
      setEmailChange((current) => ({ ...current, working: false, error: reason instanceof Error ? reason.message : "Codigo invalido." }));
    }
  }

  const stats = useMemo(() => {
    const summary = data?.activitySummary;
    const weekly = data?.weeklyClasses ?? [];
    return {
      weeklyGoal: Math.max(1, Number(summary?.weeklyGoal || weekly.length || 3)),
      completedThisWeek: Math.max(0, Number(summary?.weeklyCompletedActivities || 0)),
      kcal: Math.max(0, Number(summary?.weeklyCalories || 0)),
      checkins: Math.max(0, Number(summary?.weeklyAllowedCheckins || 0)),
      calorieDelta: Number(summary?.weeklyCaloriesDelta || 0),
    };
  }, [data]);

  const classDays = useMemo(() => new Set((data?.weeklyClasses ?? []).map((item) => item.class_schedule?.day_of_week)), [data]);
  const activityDates = useMemo(() => new Set(data?.activitySummary?.activityDates ?? []), [data?.activitySummary?.activityDates]);
  const weekDates = useMemo(() => currentWeekDates(), []);
  const completedThisWeek = stats.completedThisWeek || weekDates.filter((item) => activityDates.has(item.date)).length;
  const nextClass = data?.attendances.find((item) => item.status === "pending") ?? data?.attendances[0] ?? null;
  const pendingPayments = (data?.payments ?? []).filter((payment) => payment.status === "pending" || payment.status === "expired");
  const streakDays = data?.activitySummary?.streakDays ?? 0;
  const displayName = data?.student.full_name || user?.full_name || "Aluno";
  const notifications = data?.notifications ?? [];
  const unreadNotifications = notifications.filter((notification) => !notification.read);

  if (isLoading) return <main className="portal-safe-center grid place-items-center bg-black text-white"><LoadingState label="Abrindo portal do aluno..." /></main>;
  if (!user) return <main className="portal-safe-center grid place-items-center bg-black text-white"><section className="max-w-sm rounded-[32px] border border-white/10 bg-white/10 p-7 text-center"><QrCode className="mx-auto h-10 w-10 text-white" /><h1 className="mt-4 text-xl font-black">Portal do aluno</h1><p className="mt-2 text-sm text-white/60">Use o link enviado ao seu e-mail ou entre com sua conta.</p><Link className="mt-5 inline-flex rounded-full bg-white px-5 py-3 text-sm font-black text-black" href="/">Entrar</Link></section></main>;
  if (user.app_role !== "student") return <main className="portal-safe-center grid place-items-center bg-black"><Link className="rounded-full bg-white px-5 py-3 text-sm font-black text-black" href="/dashboard">Voltar ao painel</Link></main>;
  if (!data && !error) return <main className="portal-safe-center grid place-items-center bg-black text-white"><LoadingState label="Carregando seus dados..." /></main>;

  if (data?.requiredContract) {
    return (
      <main className="portal-safe-center grid place-items-center bg-black text-white">
        <section className="w-full max-w-md overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(160deg,#151515,#050505)] p-7 shadow-[0_24px_80px_rgba(0,0,0,.55)]">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-black"><FileSignature className="h-7 w-7" /></div>
          <p className="mt-7 text-xs font-black uppercase tracking-[.18em] text-[#a7ff3c]">Primeiro acesso</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-.04em]">Assine seu contrato para liberar o app</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">QR Code, aulas e financeiro ficam bloqueados ate a assinatura digital.</p>
          <div className="mt-5 rounded-3xl border border-white/10 bg-white/10 p-4">
            <span className="text-xs font-bold text-white/50">Plano</span>
            <strong className="mt-1 block text-sm">{data.requiredContract.plan?.name || "Plano contratado"}</strong>
          </div>
          <Link className="mt-5 flex min-h-14 items-center justify-center gap-2 rounded-full bg-white font-black text-black" href={data.requiredContract.signingUrl}>
            <FileCheck2 className="h-4 w-4" /> Revisar e assinar agora
          </Link>
          <button className="mt-3 min-h-12 w-full rounded-full border border-white/15 font-bold text-white/80" onClick={() => void reloadData()}>Ja assinei, atualizar</button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen scroll-smooth bg-black text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(167,255,60,.16),transparent_32%),radial-gradient(circle_at_top_left,rgba(255,255,255,.08),transparent_28%)]" />
      <div className="portal-safe-content relative mx-auto max-w-md">
        <header className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-[25px] font-black leading-tight tracking-[-.05em]">Ola, {firstName(displayName)}</h1>
            <p className="mt-1 truncate text-xs font-bold text-white/42">Corpo & Evolucao</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button className="group relative flex h-[52px] w-[48px] flex-col items-center justify-center rounded-[18px] border border-white/10 bg-white/[.08] px-2 py-1.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)] backdrop-blur-xl transition duration-200 active:scale-95" onClick={() => changeTab("notifications")} aria-label="Notificacoes">
              <Bell className="h-5 w-5 transition duration-200 group-active:rotate-12" />
              <span className="mt-1 text-[10px] font-black leading-none text-white">{unreadNotifications.length}</span>
              {Boolean(unreadNotifications.length) && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#a7ff3c] shadow-[0_0_18px_rgba(167,255,60,.45)]" />}
            </button>
            <div className="flex h-[52px] w-[48px] flex-col items-center justify-center rounded-[18px] border border-white/10 bg-white/[.08] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.08)] backdrop-blur-xl">
              <Image src="/foguinho.png" width={24} height={24} alt="Sequencia" className="h-6 w-6 object-contain transition duration-200 hover:scale-110" />
              <span className="mt-1 text-[10px] font-black leading-none text-white">{streakDays}</span>
            </div>
          </div>
        </header>

        {appAlert && (
          <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[.09] p-4 shadow-[0_18px_55px_rgba(0,0,0,.34)] backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-black"><Bell className="h-5 w-5" /></div>
              <div>
                <strong className="block text-sm">{appAlert.title}</strong>
                <p className="mt-1 text-xs leading-5 text-white/65">{appAlert.message}</p>
              </div>
            </div>
          </div>
        )}

        <ErrorBanner message={error} />

        {activeTab !== "notifications" && ((pushChecking || pushSuccess) ? (
          <GlassCard className="mt-5 text-center">
            <div className={`mx-auto grid h-12 w-12 place-items-center rounded-full border transition-all duration-300 ${pushSuccess ? "border-[#a7ff3c] bg-[#a7ff3c] text-black" : "border-white/15 bg-white/[.08] text-white"}`}>
              {pushSuccess ? <Check className="h-6 w-6 animate-in zoom-in duration-300" /> : <Loader2 className="h-6 w-6 animate-spin" />}
            </div>
            <p className="mt-3 text-sm font-bold text-white/70">{pushSuccess ? "Notificacoes ativadas" : "Validando notificacoes..."}</p>
            <p className="mt-1 text-xs text-white/40">{pushSuccess ? "Dispositivo salvo com seguranca." : "Aguarde, estamos preparando este aparelho."}</p>
          </GlassCard>
        ) : pushSupported && !pushEnabled ? (
          <GlassCard className="mt-5">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#a7ff3c] text-black"><Bell className="h-6 w-6" /></div>
              <div className="flex-1">
                <h2 className="font-black">Ative alertas push</h2>
                <p className="mt-1 text-xs leading-5 text-white/50">Receba aviso de aula na tela do celular. Se o aparelho bloquear, o aviso ainda aparece dentro do app.</p>
              </div>
            </div>
            {pushIssue && (
              <div className="mt-4 rounded-2xl border border-red-300/20 bg-red-500/10 p-3 text-xs font-bold leading-5 text-red-100">
                {pushIssue}
              </div>
            )}
            <button onClick={subscribePush} disabled={pushRequestRef.current} className="mt-5 min-h-12 w-full rounded-full bg-white font-black text-black disabled:opacity-60">Permitir notificacoes</button>
          </GlassCard>
        ) : !pushSupported ? (
          <GlassCard className="mt-5">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-white"><Bell className="h-6 w-6" /></div>
              <div className="flex-1">
                <h2 className="font-black">Avisos internos ativos</h2>
                <p className="mt-1 text-xs leading-5 text-white/50">Este navegador nao liberou push nativo, mas o portal mostra avisos em tempo real quando estiver aberto.</p>
              </div>
            </div>
            {pushIssue && <p className="mt-4 text-xs font-bold leading-5 text-white/60">{pushIssue}</p>}
          </GlassCard>
        ) : null)}

        {activeTab === "home" && (
          <div className="mt-6 grid gap-5">
            <section className="overflow-hidden rounded-[38px] border border-white/10 bg-[#a7ff3c] p-5 text-black shadow-[0_26px_80px_rgba(167,255,60,.18)]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[.16em] text-black/50">Hoje na</p>
                  <h2 className="mt-1 text-[34px] font-black leading-[.94] tracking-[-.06em]">Corpo & Evolucao</h2>
                </div>
                <span className="shrink-0 rounded-full bg-black px-3 py-1.5 text-[11px] font-black text-white">{nextClass ? attendanceLabel(nextClass.status) : "Livre"}</span>
              </div>

              {nextClass && (
                <div className="mt-5 rounded-[28px] bg-black/[.86] p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-[.14em] text-white/42">Proxima aula</p>
                        <strong className="mt-1 block truncate text-2xl tracking-[-.04em]">{nextClass.class_schedule?.class_type?.name || "Aula"}</strong>
                        <p className="mt-1 truncate text-sm font-bold text-white/52">{nextClass.class_schedule?.instructor?.full_name || "Professor a definir"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="block text-2xl font-black tracking-[-.04em]">{classTime(nextClass.class_schedule?.time)}</span>
                        <span className="text-xs font-bold text-white/45">{nextClass.class_schedule?.class_type?.duration_minutes || 60} min</span>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {nextClass.status === "pending" ? (
                        <button onClick={() => void answerAttendance(nextClass, "confirmed")} disabled={loadingAction === nextClass.id} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-4 text-xs font-black text-black transition active:scale-[.98] disabled:opacity-60">
                          {loadingAction === nextClass.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar
                        </button>
                      ) : (
                        <button onClick={() => changeTab("qr")} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-4 text-xs font-black text-black transition active:scale-[.98]">
                          <QrCode className="h-4 w-4" /> Abrir QR
                        </button>
                      )}
                      <button onClick={() => changeTab("classes")} className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[.08] px-4 text-xs font-black text-white transition active:scale-[.98]">
                        <CalendarDays className="h-4 w-4" /> Detalhes
                      </button>
                    </div>
                </div>
              )}

              <div className="mt-5 grid grid-cols-7 gap-2">
                {weekDates.map(({ day, date }) => {
                  const done = activityDates.has(date);
                  const scheduled = classDays.has(day);
                  const today = new Date().getDay() === day;
                  return (
                    <div key={day} className="text-center">
                      <span className="text-[10px] font-black text-black/45">{weekLabels[day]}</span>
                      <div className={`mt-2 grid h-10 place-items-center rounded-full border text-[11px] font-black ${done ? "border-black bg-black text-[#a7ff3c]" : today ? "border-black bg-black/10 text-black" : scheduled ? "border-black/20 bg-white/35 text-black/75" : "border-black/10 bg-black/5 text-black/30"}`}>
                        {done ? <Check className="h-4 w-4" /> : scheduled ? <span className="h-1.5 w-1.5 rounded-full bg-black/70" /> : <span className="h-1 w-1 rounded-full bg-black/20" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="grid grid-cols-3 gap-3">
              <MetricCard icon={Activity} label="Semana" value={`${completedThisWeek}/${stats.weeklyGoal}`} />
              <MetricCard icon={Flame} label="Kcal" value={String(stats.kcal)} highlight />
              <MetricCard icon={CheckCircle2} label="Check-ins" value={String(stats.checkins)} />
            </div>

            <button onClick={() => changeTab("qr")} className="flex items-center justify-between rounded-[30px] border border-white/10 bg-white p-5 text-left text-black shadow-[0_18px_60px_rgba(255,255,255,.10)] transition active:scale-[.99]">
              <div>
                <p className="text-xs font-black uppercase tracking-[.16em] text-black/40">Acesso rapido</p>
                <strong className="mt-1 block text-2xl tracking-[-.04em]">Abrir QR Code</strong>
              </div>
              <div className="grid h-12 w-12 place-items-center rounded-full bg-black text-white"><QrCode className="h-6 w-6" /></div>
            </button>
          </div>
        )}

        {activeTab === "classes" && (
          <SectionShell title="Aulas" subtitle="Confirme sua presenca nas aulas de hoje.">
            {data?.attendances.length ? data.attendances.map((attendance) => (
              <ClassCard key={attendance.id} attendance={attendance} loadingAction={loadingAction} onAnswer={answerAttendance} />
            )) : <EmptyDark text="Voce ainda nao possui aulas agendadas para hoje." />}
            <WeeklyList classes={data?.weeklyClasses ?? []} />
          </SectionShell>
        )}

        {activeTab === "qr" && data && (
          <SectionShell title="QR Code" subtitle="Use para liberar sua entrada na catraca.">
            <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(155deg,rgba(255,255,255,.13),rgba(255,255,255,.04))] p-3 shadow-[0_24px_80px_rgba(0,0,0,.55)] backdrop-blur-2xl">
              <StudentQrCard code={data.student.qr_code} name={data.student.full_name} variant="dark" />
            </div>
          </SectionShell>
        )}

        {activeTab === "payments" && (
          <SectionShell title="Faturas" subtitle="Somente cobrancas pendentes aparecem aqui.">
            {paidNotice && <PaidNoticeCard notice={paidNotice} />}
            {pendingPayments.length ? pendingPayments.map((payment) => (
              <article key={payment.id} className="rounded-[28px] border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-white/45">{payment.reference}</p>
                    <strong className="mt-1 block text-xl">{formatCurrency(Number(payment.total_amount))}</strong>
                    <p className="mt-1 text-xs text-white/50">Vence em {formatDate(payment.due_date)}</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/80">{payment.status === "expired" ? "Vencida" : "Pendente"}</span>
                </div>
                <button className="mt-4 min-h-12 w-full rounded-full bg-white font-black text-black" disabled={working === payment.id} onClick={() => void generatePix(payment.id)}>Pagar com PIX</button>
              </article>
            )) : paidNotice ? null : <EmptyDark text="Nenhuma fatura pendente." />}
          </SectionShell>
        )}

        {activeTab === "notifications" && (
          <section className="mt-7 grid gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3">
              <button onClick={() => changeTab("home")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[.08] text-white transition active:scale-95" aria-label="Voltar">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-3xl font-black tracking-[-.05em]">Notificacoes</h2>
                <p className="mt-1 text-sm text-white/45">{unreadNotifications.length ? `${unreadNotifications.length} nova(s) de ${notifications.length}` : notifications.length ? "Tudo lido" : "Nenhum aviso novo"}</p>
              </div>
            </div>

            {notifications.length > 0 && (
              <button
                onClick={() => void markNotificationsRead()}
                disabled={!unreadNotifications.length || notificationWorking === "all"}
                className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/10 bg-white text-sm font-black text-black shadow-[0_18px_55px_rgba(255,255,255,.10)] transition duration-200 active:scale-[.98] disabled:bg-white/10 disabled:text-white/35"
              >
                {notificationWorking === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Marcar todas como lidas
              </button>
            )}

            <div className="grid gap-3">
              {notifications.length ? notifications.map((notification, index) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  featured={!notification.read && index === 0}
                  working={notificationWorking === notification.id}
                  onMarkRead={(id) => void markNotificationsRead([id])}
                />
              )) : <EmptyDark text="Nenhuma notificacao recebida ate agora." />}
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <SectionShell title="Perfil" subtitle="Conta, seguranca e documentos.">
            <section className="rounded-[32px] border border-white/10 bg-white/[.08] p-5 shadow-[0_24px_70px_rgba(0,0,0,.35)] backdrop-blur-2xl">
              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-sm font-black text-black">{initials(displayName)}</div>
                <div className="min-w-0">
                  <strong className="block truncate text-lg tracking-[-.03em]">{displayName}</strong>
                  <p className="truncate text-sm text-white/50">{data?.student.email || user.email}</p>
                  <p className="mt-1 text-xs font-bold text-[#a7ff3c]">{streakDays} dias de sequencia</p>
                </div>
              </div>
            </section>

            <div className="grid gap-3">
              <ProfileAction icon={QrCode} title="Meu QR Code" detail="Abrir credencial de acesso da academia." onClick={() => changeTab("qr")} />
              <ProfileAction icon={CreditCard} title="Minhas faturas" detail="Ver pendencias e gerar PIX quando houver." onClick={() => changeTab("payments")} />
              <ProfileAction icon={Activity} title="Minhas aulas" detail="Acompanhar grade e presencas do dia." onClick={() => changeTab("classes")} />
              <ProfileAction icon={Mail} title="Alterar e-mail" detail="Confirme por codigo no e-mail atual e no novo." onClick={openEmailChange} />
              <ProfileAction
                icon={Bell}
                title="Notificacoes"
                detail={pushEnabled ? "Push do aparelho e avisos internos ativos." : pushSupported ? "Avisos internos ativos. Falta liberar push do aparelho." : "Avisos internos ativos neste navegador."}
                action={!pushEnabled && pushSupported ? "Ativar" : undefined}
                onClick={!pushEnabled && pushSupported ? subscribePush : () => changeTab("notifications")}
              />
              <ProfileAction
                icon={Expand}
                title="Tela cheia"
                detail="Oculta controles do navegador quando permitido."
                onClick={() => {
                  const requestFullscreen = document.documentElement.requestFullscreen;
                  if (requestFullscreen) void requestFullscreen.call(document.documentElement).catch(() => {});
                }}
              />
            </div>

            <GlassCard>
              <strong>Contratos</strong>
              <div className="mt-3 grid gap-2">
                {data?.contracts.map((contract) => (
                  <div key={contract.id} className="flex items-center justify-between rounded-2xl bg-white/[.06] p-3">
                    <span className="text-sm font-bold text-white/80">{contract.plan?.name || "Contrato"}</span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/70">{contract.status === "signed" ? "Assinado" : "Pendente"}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
            <button onClick={() => void logout()} className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[.06] text-sm font-black text-white/80 transition active:scale-[.99]">
              <LogOut className="h-4 w-4" /> Sair da conta
            </button>
          </SectionShell>
        )}
      </div>

      <BottomNav activeTab={activeTab} onChange={changeTab} />

      <Modal open={Boolean(pix)} onClose={() => setPix(null)} title={pix?.status === "paid" ? "PIX aprovado" : "PIX pronto para pagamento"} description={pix ? `Valor: ${formatCurrency(Number(pix.total_amount))}` : ""} size="sm">
        {pix && <div className="grid gap-4 text-center">
          {pix.status === "paid" ? <div className="rounded-2xl bg-green-50 p-6 text-green-700"><CheckCircle2 className="mx-auto h-12 w-12" /><strong className="mt-3 block text-lg">Pagamento confirmado automaticamente</strong></div> : <>
            {pix.pix_qr_base64 && <Image unoptimized width={256} height={256} className="mx-auto rounded-2xl border border-[#e3e8f0] p-2" alt="QR Code PIX" src={`data:image/png;base64,${pix.pix_qr_base64}`} />}
            <p className="text-xs leading-5 text-[#657085]">Leia o QR Code no app do banco ou copie o codigo.</p>
            <button className="btn btn-secondary" disabled={!pix.pix_code} onClick={() => void copyPix()}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Codigo copiado" : "Copiar PIX"}</button>
          </>}
        </div>}
      </Modal>

      <Modal open={emailChange.open} onClose={() => setEmailChange((current) => ({ ...current, open: false }))} title="Alterar e-mail" description="A troca usa dois codigos: um no e-mail atual e outro no novo." size="sm">
        <div className="grid gap-4">
          {emailChange.message && <div className="rounded-2xl bg-emerald-50 p-3 text-xs font-bold leading-5 text-emerald-700">{emailChange.message}</div>}
          {emailChange.error && <div className="rounded-2xl bg-red-50 p-3 text-xs font-bold leading-5 text-red-700">{emailChange.error}</div>}

          {emailChange.step === "current" && (
            <>
              {!emailChange.requestId ? (
                <button onClick={() => void startEmailChange()} disabled={emailChange.working} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-black text-sm font-black text-white disabled:opacity-60">
                  {emailChange.working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Enviar codigo para o e-mail atual
                </button>
              ) : (
                <div className="grid gap-3">
                  <label className="grid gap-1.5 text-sm font-bold text-[#172033]">
                    Codigo do e-mail atual
                    <input className="field" inputMode="numeric" maxLength={6} value={emailChange.currentCode} onChange={(event) => setEmailChange((current) => ({ ...current, currentCode: event.target.value }))} placeholder="000000" />
                  </label>
                  <label className="grid gap-1.5 text-sm font-bold text-[#172033]">
                    Novo e-mail
                    <input className="field" type="email" value={emailChange.newEmail} onChange={(event) => setEmailChange((current) => ({ ...current, newEmail: event.target.value }))} placeholder="novo@email.com" />
                  </label>
                  <button onClick={() => void verifyCurrentEmail()} disabled={emailChange.working || emailChange.currentCode.replace(/\D/g, "").length !== 6 || !emailChange.newEmail.includes("@")} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-black text-sm font-black text-white disabled:opacity-50">
                    {emailChange.working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar e enviar novo codigo
                  </button>
                </div>
              )}
            </>
          )}

          {emailChange.step === "new" && (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-sm font-bold text-[#172033]">
                Codigo enviado para {emailChange.newEmail}
                <input className="field" inputMode="numeric" maxLength={6} value={emailChange.newCode} onChange={(event) => setEmailChange((current) => ({ ...current, newCode: event.target.value }))} placeholder="000000" />
              </label>
              <button onClick={() => void verifyNewEmail()} disabled={emailChange.working || emailChange.newCode.replace(/\D/g, "").length !== 6} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-black text-sm font-black text-white disabled:opacity-50">
                {emailChange.working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Concluir alteracao
              </button>
            </div>
          )}

          {emailChange.step === "done" && (
            <button onClick={() => setEmailChange((current) => ({ ...current, open: false }))} className="min-h-12 rounded-full bg-black text-sm font-black text-white">Fechar</button>
          )}
        </div>
      </Modal>
    </main>
  );
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[28px] border border-white/10 bg-white/[.08] p-5 shadow-[0_20px_65px_rgba(0,0,0,.32)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 ${className}`}>{children}</section>;
}

function MetricCard({ icon: Icon, label, value, highlight = false }: { icon: any; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`min-w-0 rounded-[22px] p-4 shadow-[0_14px_46px_rgba(0,0,0,.24)] transition duration-300 active:scale-[.98] ${highlight ? "bg-[#a7ff3c] text-black" : "border border-white/10 bg-white/[.07] text-white"}`}>
      <Icon className="h-5 w-5 transition duration-300" />
      <p className={`mt-5 truncate whitespace-nowrap text-xs font-bold ${highlight ? "text-black/60" : "text-white/55"}`}>{label}</p>
      <strong className="mt-1 block truncate text-2xl tracking-[-.04em]">{value}</strong>
    </div>
  );
}

function SectionShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="mt-7 grid gap-4"><div><h2 className="text-3xl font-black tracking-[-.05em]">{title}</h2><p className="mt-1 text-sm text-white/45">{subtitle}</p></div>{children}</section>;
}

function EmptyDark({ text }: { text: string }) {
  return <div className="rounded-[28px] border border-white/10 bg-white/[.06] p-6 text-center text-sm font-bold text-white/45">{text}</div>;
}

function PaidNoticeCard({ notice }: { notice: PaidNotice }) {
  return (
    <article className="rounded-[30px] border border-emerald-300/25 bg-emerald-400/12 p-5 text-center shadow-[0_22px_70px_rgba(16,185,129,.14)] backdrop-blur-xl">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400 text-black shadow-[0_0_38px_rgba(52,211,153,.36)]">
        <CheckCircle2 className="h-9 w-9" />
      </div>
      <h3 className="mt-4 text-2xl font-black tracking-[-.04em]">Sua fatura foi paga</h3>
      <p className="mt-2 text-sm font-bold text-white/60">{notice.reference} - {formatCurrency(Number(notice.totalAmount))}</p>
      <p className="mt-3 text-xs leading-5 text-white/45">Confirmacao salva. Em instantes esta area volta para o resumo sem faturas pendentes.</p>
    </article>
  );
}

function NotificationCard({ notification, featured = false, working = false, onMarkRead }: {
  notification: { id: string; title: string; message: string; read?: boolean; created_at: string };
  featured?: boolean;
  working?: boolean;
  onMarkRead: (id: string) => void;
}) {
  const isRead = Boolean(notification.read);
  return (
    <article className={`rounded-[28px] border p-4 shadow-[0_18px_55px_rgba(0,0,0,.25)] backdrop-blur-xl transition duration-300 active:scale-[.995] ${featured ? "border-[#a7ff3c]/35 bg-[#a7ff3c]/12" : isRead ? "border-white/8 bg-white/[.045]" : "border-white/10 bg-white/[.08]"}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition duration-300 ${featured ? "bg-[#a7ff3c] text-black" : isRead ? "bg-white/10 text-white/55" : "bg-white text-black"}`}>
          <Bell className={`h-5 w-5 transition duration-300 ${isRead ? "" : "animate-[portalIconPulse_1.8s_ease-in-out_infinite]"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <strong className={`block text-sm leading-5 ${isRead ? "text-white/62" : "text-white"}`}>{notification.title}</strong>
            <span className="shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-[.08em] text-white/35">{notificationTime(notification.created_at)}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-white/55">{notification.message}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.08em] ${isRead ? "bg-white/8 text-white/35" : "bg-[#a7ff3c] text-black"}`}>
              {isRead ? "Lida" : "Nova"}
            </span>
            {!isRead && (
              <button
                onClick={() => onMarkRead(notification.id)}
                disabled={working}
                className="flex min-h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[.08] px-3 text-[11px] font-black text-white transition duration-200 active:scale-95 disabled:opacity-60"
              >
                {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Marcar lida
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ClassCard({ attendance, loadingAction, onAnswer, featured = false }: {
  attendance: ClassAttendance;
  loadingAction: string | null;
  onAnswer: (attendance: ClassAttendance, status: "confirmed" | "cancelled") => void;
  featured?: boolean;
}) {
  const confirmed = isAttendanceDone(attendance.status);
  const duration = attendance.class_schedule?.class_type?.duration_minutes || 60;
  return (
    <article className={`rounded-[30px] border p-5 backdrop-blur-xl transition duration-300 active:scale-[.995] ${featured ? "border-[#a7ff3c]/30 bg-[#a7ff3c]/10" : "border-white/10 bg-white/[.08]"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.14em] text-[#a7ff3c]">{classTime(attendance.class_schedule?.time)} - {duration} min</p>
          <strong className="mt-2 block text-2xl tracking-[-.04em]">{attendance.class_schedule?.class_type?.name || "Aula"}</strong>
          <p className="mt-1 text-sm text-white/50">{attendance.class_schedule?.instructor?.full_name || "Professor a definir"}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${confirmed ? "bg-white text-black" : attendance.status === "pending" ? "bg-white/10 text-white/80" : "bg-red-500/20 text-red-100"}`}>
          {attendanceLabel(attendance.status)}
        </span>
      </div>
      {attendance.status === "pending" && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={() => onAnswer(attendance, "cancelled")} disabled={loadingAction === attendance.id} className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[.07] text-xs font-black text-white/70 transition active:scale-[.98]"><XCircle className="h-4 w-4" /> Nao irei</button>
          <button onClick={() => onAnswer(attendance, "confirmed")} disabled={loadingAction === attendance.id} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-white text-xs font-black text-black transition active:scale-[.98]"><CheckCircle2 className="h-4 w-4" /> Confirmar</button>
        </div>
      )}
    </article>
  );
}

function WeeklyList({ classes }: { classes: StudentClassLink[] }) {
  if (!classes.length) return null;
  const sorted = [...classes].sort((a, b) => {
    const dayA = a.class_schedule?.day_of_week ?? 9;
    const dayB = b.class_schedule?.day_of_week ?? 9;
    return dayA === dayB ? String(a.class_schedule?.time || "").localeCompare(String(b.class_schedule?.time || "")) : dayA - dayB;
  });
  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <strong>Grade semanal</strong>
        <CalendarDays className="h-5 w-5 text-white/45" />
      </div>
      <div className="mt-4 grid gap-2">
        {sorted.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[.06] p-3 transition duration-200 active:scale-[.99]">
            <div className="min-w-0">
              <p className="text-sm font-black">{item.class_schedule?.class_type?.name || "Aula"}</p>
              <p className="text-xs text-white/45">{weekLabels[item.class_schedule?.day_of_week ?? 0]} as {classTime(item.class_schedule?.time)}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-white/35" />
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function ProfileAction({ icon: Icon, title, detail, action, onClick }: {
  icon: any;
  title: string;
  detail: string;
  action?: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button onClick={() => void onClick()} className="group flex items-center gap-4 rounded-[26px] border border-white/10 bg-white/[.08] p-4 text-left shadow-[0_18px_50px_rgba(0,0,0,.24)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 active:scale-[.99]">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-black transition duration-300 group-active:scale-95"><Icon className="h-5 w-5 transition duration-300 group-active:scale-110" /></span>
      <span className="min-w-0 flex-1">
        <strong className="block text-sm">{title}</strong>
        <span className="mt-1 block text-xs leading-5 text-white/50">{detail}</span>
      </span>
      {action ? <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-black">{action}</span> : <ChevronRight className="h-4 w-4 shrink-0 text-white/35" />}
    </button>
  );
}

function BottomNav({ activeTab, onChange }: { activeTab: PortalTab; onChange: (tab: PortalTab) => void }) {
  const itemClass = (tab: PortalTab) => `flex h-[50px] min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl px-1 text-[9px] font-black leading-none transition duration-200 active:scale-95 ${activeTab === tab ? "text-white" : "text-white/35"}`;
  const labelClass = "block max-w-full truncate whitespace-nowrap leading-none";
  return (
    <nav className="portal-safe-bottom-nav fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md">
      <div className="relative grid h-[76px] grid-cols-[1fr_1fr_66px_1fr_1fr] items-end rounded-[28px] border border-white/12 bg-black/82 px-2.5 pb-2 pt-2 shadow-[0_18px_70px_rgba(0,0,0,.72)] backdrop-blur-2xl">
        <button className={itemClass("home")} onClick={() => onChange("home")}><Home className="h-5 w-5 shrink-0" /><span className={labelClass}>Inicio</span></button>
        <button className={itemClass("payments")} onClick={() => onChange("payments")}><CreditCard className="h-5 w-5 shrink-0" /><span className={labelClass}>Faturas</span></button>
        <button className="relative -mt-7 flex h-[70px] min-w-0 flex-col items-center justify-end gap-1 overflow-visible px-1 text-[9px] font-black leading-none text-white transition active:scale-95" onClick={() => onChange("qr")}>
          <span className="grid h-[58px] w-[58px] place-items-center rounded-full border-[5px] border-black bg-white text-black shadow-[0_18px_45px_rgba(0,0,0,.55)]"><QrCode className="h-7 w-7" /></span>
          <span className={labelClass}>QR</span>
        </button>
        <button className={itemClass("classes")} onClick={() => onChange("classes")}><Activity className="h-5 w-5 shrink-0" /><span className={labelClass}>Aulas</span></button>
        <button className={itemClass("settings")} onClick={() => onChange("settings")}><UserRound className="h-5 w-5 shrink-0" /><span className={labelClass}>Perfil</span></button>
      </div>
    </nav>
  );
}
