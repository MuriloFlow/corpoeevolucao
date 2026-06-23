"use client";

import { ArrowLeft, CalendarDays, Clock3, MapPin, Save, UserRound, Users, Camera } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { ErrorBanner, FieldLabel, PageHeader } from "@/components/ui";
import { createStudent, getClassSchedules, linkStudentToClasses, saveStudentPhoto } from "@/lib/api";
import type { ClassSchedule } from "@/lib/types";
import { calculateIMC, digitsOnly, formatDateTime, maskCEP, maskCPF, maskPhone } from "@/lib/utils";
import { useDeviceSelector } from "@/components/device-selector";

interface StudentForm {
  full_name: string;
  email: string;
  cpf: string;
  rg: string;
  birth_date: string;
  gender: string;
  phone: string;
  whatsapp: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  weight: string;
  height: string;
  objective: string;
  emergency_contact: string;
  emergency_phone: string;
  observations: string;
  photo_base64: string | null;
}

const emptyForm: StudentForm = {
  full_name: "", email: "", cpf: "", rg: "", birth_date: "", gender: "",
  phone: "", whatsapp: "", cep: "", street: "", number: "", complement: "", neighborhood: "",
  city: "", state: "", weight: "", height: "", objective: "",
  emergency_contact: "", emergency_phone: "", observations: "", photo_base64: null,
};

function TextField({
  id,
  label,
  value,
  onChange,
  required,
  type = "text",
  placeholder,
}: {
  id: keyof StudentForm;
  label: string;
  value: string;
  onChange: (id: keyof StudentForm, value: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input id={id} name={id} className="field" type={type} required={required} value={value} placeholder={placeholder} onChange={(event) => onChange(id, event.target.value)} />
    </label>
  );
}

import { supabase } from "@/lib/supabase";

export default function NovoAlunoPage() {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [cepStatus, setCepStatus] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ClassSchedule[]>([]);
  const [selectedSchedules, setSelectedSchedules] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [facialScanActive, setFacialScanActive] = useState(false);
  const [streamFrame, setStreamFrame] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  
  const { selectDevice, DeviceSelectorModal } = useDeviceSelector();

  useEffect(() => {
    const channel = supabase.channel("face-scan-channel", {
      config: { broadcast: { self: true } }
    })
      .on("broadcast", { event: "SCAN_RESULT" }, ({ payload }) => {
        if (payload.imageBase64) {
          setForm(prev => ({ ...prev, photo_base64: payload.imageBase64 }));
          setFacialScanActive(false);
          setStreamFrame(null);
        }
      })
      .on("broadcast", { event: "STREAM_FRAME" }, ({ payload }) => {
        if (payload.frame) {
          setStreamFrame(payload.frame);
        }
      })
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function startFacialScan() {
    const targetDeviceId = await selectDevice();
    if (targetDeviceId === null) return;
    setFacialScanActive(true);
    channelRef.current?.send({ type: "broadcast", event: "START_SCAN", payload: { targetDeviceId } });
  }

  function captureFacialScan() {
    channelRef.current?.send({ type: "broadcast", event: "CAPTURE_SCAN" });
  }

  function change(id: keyof StudentForm, value: string) {
    const masked = id === "cpf"
      ? maskCPF(value)
      : id === "phone" || id === "whatsapp" || id === "emergency_phone"
        ? maskPhone(value)
        : id === "cep"
          ? maskCEP(value)
          : value;
    setForm((current) => ({ ...current, [id]: masked }));
  }

  useEffect(() => {
    const cep = digitsOnly(form.cep);
    if (cep.length !== 8) {
      setCepStatus(null);
      return;
    }
    const controller = new AbortController();
    setCepStatus("Buscando endereço...");
    fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string; complemento?: string }) => {
        if (data.erro) throw new Error("CEP não encontrado.");
        setForm((current) => ({
          ...current,
          street: data.logradouro || current.street,
          neighborhood: data.bairro || current.neighborhood,
          city: data.localidade || current.city,
          state: data.uf || current.state,
          complement: data.complemento || current.complement,
        }));
        setCepStatus("Endereço preenchido. Informe apenas o número e revise os dados.");
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setCepStatus(reason.message || "Não foi possível consultar o CEP.");
      });
    return () => controller.abort();
  }, [form.cep]);

  useEffect(() => {
    getClassSchedules().then((items) => setSchedules(items.filter(item => item.active)));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { photo_base64, ...studentData } = form;
      const weight = studentData.weight ? Number(studentData.weight) : null;
      const height = studentData.height ? Number(studentData.height) : null;
      const student = await createStudent({
        ...studentData,
        email: studentData.email || null,
        rg: studentData.rg || null,
        gender: studentData.gender || null,
        whatsapp: studentData.whatsapp || null,
        cep: studentData.cep || null,
        street: studentData.street || null,
        number: studentData.number || null,
        complement: studentData.complement || null,
        neighborhood: studentData.neighborhood || null,
        city: studentData.city || null,
        state: studentData.state.toUpperCase() || null,
        weight,
        height,
        imc: weight && height ? calculateIMC(weight, height) : null,
        objective: form.objective || null,
        emergency_contact: form.emergency_contact || null,
        emergency_phone: form.emergency_phone || null,
        observations: form.observations || null,
      });

      if (form.photo_base64) {
        const res = await fetch(form.photo_base64);
        const blob = await res.blob();
        const { photoUrl } = await saveStudentPhoto(student.id, blob);

        // REALTIME: Avisa a catraca que tem rosto novo pra sincronizar
        supabase.channel("students-sync", { config: { broadcast: { self: false } } }).send({
          type: "broadcast",
          event: "STUDENT_FACE_UPDATED",
          payload: { id: student.id, full_name: form.full_name, photo_url: photoUrl }
        });
      }

      await linkStudentToClasses(student.id, selectedSchedules);
      router.push("/dashboard/alunos");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o aluno.");
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Novo cadastro"
        title="Adicionar aluno"
        description="Centralize os dados necessários para atendimento, acesso e evolução."
        action={<Link href="/dashboard/alunos" className="btn btn-secondary"><ArrowLeft className="h-4 w-4" /> Voltar</Link>}
      />

      <form onSubmit={submit} className="grid gap-4">
        <ErrorBanner message={error} />
        <section className="card">
          <div className="card-header"><div><h2>Dados pessoais</h2><p>Identificação e canais de contato</p></div><UserRound className="h-5 w-5 text-blue-600" /></div>
          <div className="card-body form-grid">
            <TextField id="full_name" label="Nome completo" value={form.full_name} onChange={change} required />
            <TextField id="email" label="E-mail" value={form.email} onChange={change} type="email" />
            <TextField id="cpf" label="CPF" value={form.cpf} onChange={change} required placeholder="000.000.000-00" />
            <TextField id="rg" label="RG" value={form.rg} onChange={change} />
            <TextField id="birth_date" label="Data de nascimento" value={form.birth_date} onChange={change} type="date" required />
            <label><FieldLabel>Gênero</FieldLabel><select className="field" value={form.gender} onChange={(event) => change("gender", event.target.value)}><option value="">Não informado</option><option value="feminino">Feminino</option><option value="masculino">Masculino</option><option value="outro">Outro</option></select></label>
            <TextField id="phone" label="Telefone" value={form.phone} onChange={change} required placeholder="(00) 00000-0000" />
            <TextField id="whatsapp" label="WhatsApp" value={form.whatsapp} onChange={change} placeholder="(00) 00000-0000" />
          </div>
        </section>

        <section className="card">
          <div className="card-header"><div><h2>Endereço e evolução</h2><p>Informações complementares para o acompanhamento</p></div><MapPin className="h-5 w-5 text-blue-600" /></div>
          <div className="card-body form-grid">
            <div><TextField id="cep" label="CEP" value={form.cep} onChange={change} placeholder="00000-000" />{cepStatus && <p className="mt-1.5 text-[11px] font-medium text-blue-600">{cepStatus}</p>}</div>
            <TextField id="street" label="Logradouro" value={form.street} onChange={change} />
            <TextField id="number" label="Número" value={form.number} onChange={change} />
            <TextField id="complement" label="Complemento" value={form.complement} onChange={change} />
            <TextField id="neighborhood" label="Bairro" value={form.neighborhood} onChange={change} />
            <TextField id="city" label="Cidade" value={form.city} onChange={change} />
            <TextField id="state" label="UF" value={form.state} onChange={change} />
            <TextField id="weight" label="Peso (kg)" value={form.weight} onChange={change} type="number" />
            <TextField id="height" label="Altura (cm)" value={form.height} onChange={change} type="number" />
            <TextField id="objective" label="Objetivo" value={form.objective} onChange={change} />
            <TextField id="emergency_contact" label="Contato de emergência" value={form.emergency_contact} onChange={change} />
            <TextField id="emergency_phone" label="Telefone de emergência" value={form.emergency_phone} onChange={change} placeholder="(00) 00000-0000" />
            <label><FieldLabel>Observações</FieldLabel><textarea className="field" value={form.observations} onChange={(event) => change("observations", event.target.value)} /></label>
          </div>
        </section>

        <section className="card">
          <div className="card-header"><div><h2>Foto do Aluno</h2><p>Reconhecimento facial para controle de acesso</p></div><Camera className="h-5 w-5 text-blue-600" /></div>
          <div className="card-body">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {form.photo_base64 ? (
                <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-[#e3e8f0] shadow-md">
                  <img src={form.photo_base64} alt="Foto capturada" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setForm({ ...form, photo_base64: null })} className="absolute bottom-0 w-full bg-red-600/80 text-white text-[10px] py-1 font-bold hover:bg-red-600">REMOVER</button>
                </div>
              ) : (
                <div className="w-32 h-32 rounded-full bg-[#f3f6fb] border-4 border-[#e3e8f0] flex items-center justify-center">
                  <UserRound className="h-10 w-10 text-[#c2cad7]" />
                </div>
              )}
              
              <div className="flex-1">
                {facialScanActive ? (
                  <div className="p-4 rounded-2xl border-2 border-blue-500 bg-blue-50 relative overflow-hidden">
                    {streamFrame && (
                      <div className="absolute right-4 top-4 w-24 h-32 rounded-xl overflow-hidden border-2 border-white shadow-lg z-10">
                        <img src={streamFrame} alt="Live Stream" className="w-full h-full object-cover scale-x-[-1]" />
                      </div>
                    )}
                    <h3 className="font-bold text-blue-800 flex items-center gap-2 mb-2">
                      <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span></span>
                      {streamFrame ? "Câmera Sincronizada" : "Aguardando câmera do celular..."}
                    </h3>
                    <p className="text-xs text-blue-600 mb-4 pr-28">
                      {streamFrame ? "O vídeo ao lado é o que o celular está vendo. Clique em tirar foto quando estiver alinhado." : "Peça para o aluno olhar para a câmera do celular de recepção e aguarde o vídeo aparecer."}
                    </p>
                    <div className="flex gap-2 w-full max-w-[200px]">
                      <button type="button" onClick={captureFacialScan} disabled={!streamFrame} className="btn btn-primary flex-1 disabled:opacity-50"><Camera className="h-4 w-4" /> Tirar Foto</button>
                      <button type="button" onClick={() => { setFacialScanActive(false); channelRef.current?.send({ type: "broadcast", event: "STOP_SCAN" }); }} className="btn btn-secondary flex-none">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={startFacialScan} className="btn btn-secondary border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 hover:border-blue-300">
                    <Camera className="h-4 w-4" /> Adicionar Facial
                  </button>
                )}
                <p className="mt-3 text-[11px] text-[#657085]">Ao clicar em &quot;Adicionar Facial&quot;, o celular da recepção abrirá a câmera automaticamente para captura remota.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header"><div><h2>Grade de Aulas</h2><p>Vincule o aluno aos horários fixos semanais</p></div><CalendarDays className="h-5 w-5 text-blue-600" /></div>
          <div className="card-body">
            {!schedules.length ? <p className="text-sm text-[#657085]">Nenhum horário fixo cadastrado na grade.</p> : (
              <div className="flex flex-col gap-2">
                {schedules.map((schedule) => {
                  const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
                  const label = `${schedule.class_type?.name} - ${WEEKDAYS[schedule.day_of_week]} às ${schedule.time}`;
                  const isChecked = selectedSchedules.includes(schedule.id);
                  return (
                    <label key={schedule.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-[#f7f9fc] ${isChecked ? "border-blue-600 bg-[#eff4ff]" : "border-[#e3e8f0]"}`}>
                      <input type="checkbox" className="h-4 w-4 rounded border-[#cbd5e1] text-blue-600 focus:ring-blue-600" checked={isChecked} onChange={(event) => setSelectedSchedules(event.target.checked ? [...selectedSchedules, schedule.id] : selectedSchedules.filter((id) => id !== schedule.id))} />
                      <span className={`text-sm font-medium ${isChecked ? "text-blue-900" : "text-[#172033]"}`}>{label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <div className="form-actions">
          <Link href="/dashboard/alunos" className="btn btn-secondary">Cancelar</Link>
          <button className="btn btn-primary" disabled={saving} type="submit"><Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar aluno"}</button>
        </div>
      </form>

      <DeviceSelectorModal />
    </div>
  );
}
