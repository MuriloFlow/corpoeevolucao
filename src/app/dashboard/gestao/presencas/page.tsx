"use client";

import { addDays, format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, Ban, Bell, Calendar as CalendarIcon, CalendarOff, CheckCircle2, ChevronLeft, ChevronRight, Clock, History, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, ErrorBanner, FieldLabel, LoadingState, Modal, PageHeader, StatusBadge } from "@/components/ui";
import { auditClassOccurrence, getAttendanceHistory, getAttendancesByDate } from "@/lib/api";
import type { ClassAttendance, ClassOccurrenceAudit, ClassOccurrenceStatus } from "@/lib/types";

type NotifyResult = {
  message?: string;
  pendingStudents?: number;
  registeredDevices?: number;
  targetsWithoutDevice?: number;
  pushSent?: number;
  inAppNotifications?: number;
  expiredSubscriptions?: number;
};

export default function PresencasPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [attendances, setAttendances] = useState<ClassAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingPush, setSendingPush] = useState(false);
  const [notifyResult, setNotifyResult] = useState<NotifyResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<ClassOccurrenceAudit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [auditTarget, setAuditTarget] = useState<ClassOccurrenceAudit | null>(null);
  const [auditStatus, setAuditStatus] = useState<ClassOccurrenceStatus>("nullified");
  const [auditReason, setAuditReason] = useState("");
  const [auditing, setAuditing] = useState(false);

  async function loadData() {
    setLoading(true);
    const dateStr = format(currentDate, "yyyy-MM-dd");
    const data = await getAttendancesByDate(dateStr);
    setAttendances(data);
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => void loadData(), 30000);
    return () => clearInterval(interval);
  }, [currentDate]);

  async function handleNotifyToday() {
    setSendingPush(true);
    try {
      const res = await fetch("/api/cron/notify-today");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao disparar notificacoes.");
      setNotifyResult(data);
      await loadData();
    } catch (reason: any) {
      setNotifyResult({ message: reason?.message || "Erro ao disparar notificacoes." });
    } finally {
      setSendingPush(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistoryRows(await getAttendanceHistory());
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "Não foi possível carregar o histórico.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!historyOpen) return;
    void loadHistory();
    const interval = window.setInterval(() => void loadHistory(), 15000);
    return () => window.clearInterval(interval);
  }, [historyOpen]);

  function openAudit(row: ClassOccurrenceAudit, status: ClassOccurrenceStatus) {
    setAuditTarget(row);
    setAuditStatus(status);
    setAuditReason(status === "normal" ? "Aula restaurada pela administração." : row.reason || "");
  }

  async function submitAudit() {
    if (!auditTarget) return;
    setAuditing(true);
    setHistoryError(null);
    try {
      await auditClassOccurrence({
        classScheduleId: auditTarget.class_schedule_id,
        date: auditTarget.date,
        status: auditStatus,
        reason: auditReason,
      });
      setAuditTarget(null);
      await Promise.all([loadHistory(), loadData()]);
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "Não foi possível auditar a aula.");
    } finally {
      setAuditing(false);
    }
  }

  const groupedBySchedule = attendances.reduce((acc, att) => {
    const key = att.class_schedule_id;
    if (!acc[key]) acc[key] = { schedule: att.class_schedule, attendances: [] };
    acc[key].attendances.push(att);
    return acc;
  }, {} as Record<string, { schedule: any; attendances: ClassAttendance[] }>);

  const schedulesArray = Object.values(groupedBySchedule).sort((a, b) => {
    return (a.schedule?.time || "").localeCompare(b.schedule?.time || "");
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Gestao"
        title="Controle de Presencas"
        description="Aulas do dia com alunos pendentes, confirmados e ausentes em tempo real."
        action={<div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" /> Histórico de presenças
          </button>
          <button className="btn btn-primary bg-blue-600 hover:bg-blue-700" onClick={handleNotifyToday} disabled={sendingPush}>
            <Bell className="h-4 w-4" />
            {sendingPush ? "Enviando..." : "Notificar alunos de hoje"}
          </button>
        </div>}
      />

      {notifyResult && (
        <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-blue-950 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[.14em] text-blue-500">Central de notificacoes</p>
              <strong className="mt-1 block text-sm">{notifyResult.message || "Verificacao concluida."}</strong>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <span className="rounded-xl bg-white px-3 py-2 font-bold shadow-sm">Push: {notifyResult.pushSent ?? 0}</span>
              <span className="rounded-xl bg-white px-3 py-2 font-bold shadow-sm">App: {notifyResult.inAppNotifications ?? 0}</span>
              <span className="rounded-xl bg-white px-3 py-2 font-bold shadow-sm">Dispositivos: {notifyResult.registeredDevices ?? 0}</span>
              <span className="rounded-xl bg-white px-3 py-2 font-bold shadow-sm">Sem aparelho: {notifyResult.targetsWithoutDevice ?? 0}</span>
            </div>
          </div>
        </section>
      )}

      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button className="btn btn-secondary" onClick={() => setCurrentDate((date) => subDays(date, 1))}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </button>
        <div className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <CalendarIcon className="h-5 w-5 text-blue-600" />
          {format(currentDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
        </div>
        <button className="btn btn-secondary" onClick={() => setCurrentDate((date) => addDays(date, 1))}>
          Proximo <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <LoadingState label="Carregando presencas..." />
      ) : schedulesArray.length === 0 ? (
        <div className="card flex flex-col items-center p-12 text-center text-slate-500">
          <Clock className="mb-4 h-12 w-12 text-slate-300" />
          <h3 className="text-lg font-bold text-slate-700">Nenhuma aula encontrada</h3>
          <p className="mt-2 max-w-sm text-sm">Quando houver alunos vinculados a aulas deste dia, a lista sera montada automaticamente.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {schedulesArray.map((group) => {
            const confirmed = group.attendances.filter((att) => att.status === "confirmed" || att.status === "attended").length;
            const cancelled = group.attendances.filter((att) => att.status === "cancelled" || att.status === "missed").length;
            const pending = group.attendances.filter((att) => att.status === "pending").length;

            return (
              <section key={group.schedule?.id ?? group.attendances[0]?.class_schedule_id} className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-1.5 rounded-full" style={{ backgroundColor: group.schedule?.class_type?.color || "#3b82f6" }} />
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">{group.schedule?.class_type?.name || "Turma"}</h2>
                      <p className="flex items-center gap-1 text-sm font-medium text-slate-500"><Clock className="h-3.5 w-3.5" /> {group.schedule?.time || "--:--"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 text-sm font-medium">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-2 py-1 text-green-600"><CheckCircle2 className="h-4 w-4" /> {confirmed}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1 text-red-600"><XCircle className="h-4 w-4" /> {cancelled}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-50 px-2 py-1 text-yellow-700"><AlertCircle className="h-4 w-4" /> {pending}</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="border-b border-slate-100 text-[11px] font-black uppercase tracking-[.12em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Aluno</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Horario</th>
                        <th className="px-4 py-3 text-right">Confirmacao</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.attendances.map((att) => (
                        <tr key={att.id} className={`${att.status === "pending" ? "opacity-45" : "opacity-100"} ${att.status === "confirmed" || att.status === "attended" ? "bg-green-50/40" : ""}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar src={att.student?.photo_url} fallback={att.student?.full_name || "?"} size="sm" />
                              <div>
                                <p className="font-bold text-slate-900">{att.student?.full_name || "Aluno"}</p>
                                <p className="text-xs text-slate-400">Vinculado a turma</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3"><AttendanceBadge status={att.status} /></td>
                          <td className="px-4 py-3 text-slate-600">{group.schedule?.time || "--:--"}</td>
                          <td className="px-4 py-3 text-right">
                            {att.status === "confirmed" || att.status === "attended" ? (
                              <CheckCircle2 className="ml-auto h-6 w-6 text-green-600" />
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">Aguardando</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Histórico de presenças" description="Auditoria cronológica das aulas realizadas, anuladas e inativadas." size="lg">
        <div className="grid gap-4">
          <ErrorBanner message={historyError} />
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-blue-800">
            <strong>Nula:</strong> feriado ou aula que não deve contar. <strong>Inativada:</strong> aula que não aconteceu; o sistema acrescenta um dia à vigência de cada aluno vinculado, uma única vez.
          </div>
          {historyLoading && !historyRows.length ? (
            <LoadingState label="Carregando histórico..." />
          ) : (
            <div className="max-h-[62vh] overflow-y-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-black uppercase tracking-[.12em] text-slate-400">
                  <tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Aula</th><th className="px-4 py-3">Presenças</th><th className="px-4 py-3">Auditoria</th><th className="px-4 py-3 text-right">Ações</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {historyRows.map((row) => (
                    <tr key={`${row.class_schedule_id}:${row.date}`}>
                      <td className="px-4 py-3 font-bold text-slate-700">{format(new Date(`${row.date}T12:00:00`), "dd/MM/yyyy")}</td>
                      <td className="px-4 py-3"><strong className="block text-slate-900">{row.class_schedule?.class_type?.name || "Aula"}</strong><span className="text-xs text-slate-400">{row.class_schedule?.time?.slice(0, 5) || "--:--"}</span></td>
                      <td className="px-4 py-3 text-xs text-slate-600">{row.confirmed_total || 0} confirmadas · {row.missed_total || 0} faltas · {row.attendance_total || 0} alunos</td>
                      <td className="px-4 py-3">
                        {row.status === "nullified" ? <StatusBadge tone="gray">Nula</StatusBadge> : row.status === "inactivated" ? <StatusBadge tone="red">Inativada · +1 dia ({row.affected_students || 0})</StatusBadge> : <StatusBadge tone="green">Normal</StatusBadge>}
                        {row.reason && <p className="mt-1 max-w-xs text-[11px] text-slate-400">{row.reason}</p>}
                      </td>
                      <td className="px-4 py-3"><div className="flex justify-end gap-2">
                        <button className="icon-btn" title="Marcar como nula" onClick={() => openAudit(row, "nullified")}><Ban className="h-4 w-4 text-slate-600" /></button>
                        <button className="icon-btn" title="Inativar e compensar alunos" onClick={() => openAudit(row, "inactivated")}><CalendarOff className="h-4 w-4 text-red-600" /></button>
                        {row.status !== "normal" && <button className="icon-btn" title="Restaurar aula" onClick={() => openAudit(row, "normal")}><RotateCcw className="h-4 w-4 text-blue-600" /></button>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={Boolean(auditTarget)} onClose={() => setAuditTarget(null)} title={auditStatus === "nullified" ? "Marcar aula como nula" : auditStatus === "inactivated" ? "Inativar aula e compensar alunos" : "Restaurar aula"} description={auditTarget ? `${auditTarget.class_schedule?.class_type?.name || "Aula"} · ${format(new Date(`${auditTarget.date}T12:00:00`), "dd/MM/yyyy")}` : ""} size="sm">
        <div className="grid gap-4">
          <ErrorBanner message={historyError} />
          <label><FieldLabel required>Motivo da auditoria</FieldLabel><textarea className="field min-h-28" value={auditReason} onChange={(event) => setAuditReason(event.target.value)} placeholder="Ex.: feriado municipal ou professora afastada." /></label>
          {auditStatus === "inactivated" && <p className="rounded-xl bg-red-50 p-3 text-xs font-semibold leading-5 text-red-700">Ao confirmar, cada aluno atualmente vinculado a essa aula receberá +1 dia na matrícula. Repetir a ação não duplica a compensação.</p>}
          <div className="form-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setAuditTarget(null)}>Cancelar</button>
            <button className="btn btn-primary" type="button" disabled={auditing || auditReason.trim().length < 3} onClick={() => void submitAudit()}>{auditing ? "Salvando..." : "Confirmar auditoria"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function AttendanceBadge({ status }: { status: ClassAttendance["status"] }) {
  if (status === "confirmed") return <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmado</span>;
  if (status === "attended") return <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800"><CheckCircle2 className="h-3.5 w-3.5" /> Presente</span>;
  if (status === "cancelled") return <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600"><XCircle className="h-3.5 w-3.5" /> Nao vira</span>;
  if (status === "missed") return <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">Faltou</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 px-2.5 py-1 text-xs font-bold text-yellow-700"><AlertCircle className="h-3.5 w-3.5" /> Pendente</span>;
}
