"use client";

import { CheckCircle2, Eraser, FileCheck2, Loader2, PenLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import { ErrorBanner, FieldLabel } from "@/components/ui";
import { maskCPF, cn } from "@/lib/utils";

type ContractView = {
  studentName: string;
  planName: string;
  documentText: string;
  documentUrl?: string | null;
  documentName?: string | null;
  studioName: string;
  expiresAt: string;
};

type PdfDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;

function PdfPage({
  document,
  pageNumber,
}: {
  document: PdfDocumentProxy;
  pageNumber: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    const render = async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(280, wrapper.clientWidth);
      const scale = Math.min(2.2, availableWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      renderTask = page.render({ canvas, canvasContext: context, viewport });
      await renderTask.promise;
    };

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);

  return (
    <div ref={wrapperRef} className="mx-auto w-full overflow-hidden rounded-xl bg-white shadow-sm">
      <canvas ref={canvasRef} className="mx-auto block max-w-full" aria-label={`Página ${pageNumber} do contrato`} />
    </div>
  );
}

function PdfViewer({ url, onReachedEnd }: { url: string; onReachedEnd: () => void }) {
  const [document, setDocument] = useState<PdfDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let loadedDocument: PdfDocumentProxy | null = null;
    void import("pdfjs-dist").then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const task = pdfjs.getDocument({ url });
      loadedDocument = await task.promise;
      if (!disposed) setDocument(loadedDocument);
    }).catch(() => {
      if (!disposed) setError("Não foi possível renderizar o PDF do contrato.");
    });
    return () => {
      disposed = true;
      void loadedDocument?.destroy();
    };
  }, [url]);

  if (error) return <div className="p-6"><ErrorBanner message={error} /></div>;
  if (!document) return <div className="grid min-h-72 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>;

  function handlePdfScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const scrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const nextProgress = Math.min(100, Math.round((element.scrollTop / scrollable) * 100));
    setProgress(nextProgress);
    if (element.scrollHeight - element.scrollTop <= element.clientHeight + 24) {
      setProgress(100);
      onReachedEnd();
    }
  }

  return (
    <div className="bg-slate-100">
      <div className="flex items-center justify-between border-y border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-500 sm:px-6">
        <span>{document.numPages} página(s) · role dentro do documento</span>
        <span className={progress === 100 ? "text-emerald-600" : "text-blue-600"}>{progress}% lido</span>
      </div>
      <div className="h-1 bg-slate-200">
        <div className="h-full bg-blue-600 transition-[width] duration-200" style={{ width: `${progress}%` }} />
      </div>
      <div
        ref={scrollRef}
        onScroll={handlePdfScroll}
        className="h-[62vh] min-h-[480px] max-h-[760px] overflow-y-auto overscroll-contain bg-slate-200 p-2 sm:p-5"
      >
        <div className="mx-auto grid max-w-[820px] gap-4">
          {Array.from({ length: document.numPages }, (_, index) => (
            <PdfPage
              key={index + 1}
              document={document}
              pageNumber={index + 1}
            />
          ))}
          <div className="rounded-xl bg-emerald-50 p-4 text-center text-sm font-bold text-emerald-700">
            Fim do contrato
          </div>
        </div>
      </div>
    </div>
  );
}

function SignaturePad({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (image: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);

  function croppedSignatureDataUrl(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return canvas.toDataURL("image/png");
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = image;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        if (alpha > 20 && brightness < 225) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }

    if (right < left || bottom < top) return canvas.toDataURL("image/png");

    const inkWidth = right - left + 1;
    const inkHeight = bottom - top + 1;
    const sourcePadding = Math.max(12, Math.round(Math.max(inkWidth, inkHeight) * 0.08));
    const sourceX = Math.max(0, left - sourcePadding);
    const sourceY = Math.max(0, top - sourcePadding);
    const sourceWidth = Math.min(width - sourceX, inkWidth + sourcePadding * 2);
    const sourceHeight = Math.min(height - sourceY, inkHeight + sourcePadding * 2);

    const output = document.createElement("canvas");
    output.width = 1200;
    output.height = 400;
    const outputContext = output.getContext("2d");
    if (!outputContext) return canvas.toDataURL("image/png");
    outputContext.fillStyle = "#ffffff";
    outputContext.fillRect(0, 0, output.width, output.height);

    const targetPadding = 28;
    const scale = Math.min(
      (output.width - targetPadding * 2) / sourceWidth,
      (output.height - targetPadding * 2) / sourceHeight,
    );
    const targetWidth = sourceWidth * scale;
    const targetHeight = sourceHeight * scale;
    outputContext.drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      (output.width - targetWidth) / 2,
      (output.height - targetHeight) / 2,
      targetWidth,
      targetHeight,
    );
    return output.toDataURL("image/png");
  }

  const prepareCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
    context.lineWidth = 2.5;
    hasInkRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(prepareCanvas);
    return () => window.cancelAnimationFrame(frame);
  }, [open, prepareCanvas]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
    drawingRef.current = true;
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
    hasInkRef.current = true;
  }

  function stop(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
        <div>
          <h2 className="font-black text-slate-900">Faça sua assinatura</h2>
          <p className="text-xs text-slate-500">Use o dedo, a caneta ou o mouse dentro da área branca.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Voltar</button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-8">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-white">
          <canvas
            ref={canvasRef}
            className="h-full w-full touch-none cursor-crosshair"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            aria-label="Área para assinatura manuscrita"
          />
          <span className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 text-xs font-bold uppercase tracking-[.18em] text-slate-200">
            Assine acima desta linha
          </span>
          <span className="pointer-events-none absolute bottom-12 left-[8%] right-[8%] h-px bg-slate-200" />
        </div>
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button type="button" className="btn btn-secondary" onClick={prepareCanvas}><Eraser className="h-4 w-4" /> Limpar</button>
          <button
            type="button"
            className="btn btn-primary min-h-12 px-8"
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas || !hasInkRef.current) return;
              onConfirm(croppedSignatureDataUrl(canvas));
            }}
          >
            <CheckCircle2 className="h-4 w-4" /> Confirmar assinatura
          </button>
        </div>
      </div>
    </div>
  );
}

export function SignatureForm({ token }: { token: string }) {
  const [contract, setContract] = useState<ContractView | null>(null);
  const [cpf, setCpf] = useState("");
  const [signature, setSignature] = useState("");
  const [signatureImage, setSignatureImage] = useState("");
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [signed, setSigned] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/public/contracts/${token}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { contract?: ContractView; error?: string };
        if (!response.ok || !payload.contract) throw new Error(payload.error || "Não foi possível abrir o contrato.");
        setContract(payload.contract);
        setSignature(payload.contract.studentName);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (contract && !contract.documentUrl && textRef.current) {
      const element = textRef.current;
      if (element.scrollHeight <= element.clientHeight + 10) setScrolledToBottom(true);
    }
  }, [contract]);

  function handleTextScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop <= element.clientHeight + 12) {
      setScrolledToBottom(true);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/contracts/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpf,
          signature,
          signatureImage,
          accepted,
          readToEnd: scrolledToBottom,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível registrar a assinatura.");
      setSigned(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível registrar a assinatura.");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#f7f9fc]"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></main>;
  if (signed) return <main className="grid min-h-screen place-items-center bg-[#f7f9fc] p-5"><section className="card max-w-lg p-8 text-center"><CheckCircle2 className="mx-auto h-14 w-14 text-green-600" /><h1 className="mt-5 text-2xl font-bold">Contrato assinado</h1><p className="mt-2 text-sm text-[#657085]">A assinatura manuscrita e as evidências foram registradas no cadastro.</p><Link className="btn btn-primary mt-5" href="/portal">Ir para o portal</Link></section></main>;

  return (
    <main className="min-h-screen bg-[#f7f9fc] p-3 sm:p-8">
      <div className="mx-auto grid max-w-5xl gap-6">
        <header className="text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-600 text-white"><FileCheck2 className="h-6 w-6" /></div>
          <h1 className="mt-4 text-2xl font-bold">{contract?.studioName || "Corpo & Evolução"}</h1>
          <p className="mt-1 text-sm text-[#657085]">Leia integralmente e assine o contrato</p>
        </header>
        <ErrorBanner message={error} />

        {contract && (
          <section className="card overflow-hidden">
            <div className="card-header">
              <div><h2>{contract.studentName}</h2><p>Plano: {contract.planName}</p></div>
              <ShieldCheck className="h-5 w-5 text-green-600" />
            </div>
            {contract.documentUrl ? (
              <PdfViewer url={contract.documentUrl} onReachedEnd={() => setScrolledToBottom(true)} />
            ) : (
              <div
                ref={textRef}
                onScroll={handleTextScroll}
                className="h-[65vh] overflow-y-auto whitespace-pre-wrap bg-white p-5 text-[13px] leading-relaxed text-[#465168] sm:p-8"
              >
                {contract.documentText}
                <div className="mt-10 rounded-xl bg-emerald-50 p-4 text-center font-bold text-emerald-700">Fim do contrato</div>
              </div>
            )}
          </section>
        )}

        {contract && (
          <form className="card border-t-4 border-t-blue-600 p-5 shadow-sm sm:p-8" onSubmit={submit}>
            <div className="grid gap-6">
              <div className="border-b border-slate-100 pb-5">
                <h3 className="text-xl font-black text-slate-800">Identificação e assinatura</h3>
                <p className="mt-1 text-sm text-slate-500">A assinatura é liberada depois que você rolar o documento interno até o final.</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <label><FieldLabel required>CPF do titular</FieldLabel><input className="field min-h-12 text-base" inputMode="numeric" required value={cpf} onChange={(event) => setCpf(maskCPF(event.target.value))} placeholder="000.000.000-00" /></label>
                <label><FieldLabel required>Nome completo igual ao documento</FieldLabel><input className="field min-h-12 text-base" required minLength={3} value={signature} onChange={(event) => setSignature(event.target.value)} /></label>
              </div>

              <button
                type="button"
                className="btn btn-secondary min-h-16 justify-center border-blue-200 text-base font-black text-blue-700 disabled:opacity-50"
                disabled={!scrolledToBottom}
                onClick={() => setSignaturePadOpen(true)}
              >
                <PenLine className="h-5 w-5" />
                {signatureImage ? "Refazer assinatura manuscrita" : scrolledToBottom ? "Abrir tela para assinar" : "Leia o contrato até o final"}
              </button>

              {signatureImage && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-slate-400">Assinatura capturada</p>
                  <img src={signatureImage} alt="Assinatura manuscrita do titular" className="h-40 w-full object-contain sm:h-48" />
                </div>
              )}

              <label className={cn(
                "flex items-start gap-3 rounded-xl border p-4 text-sm transition-colors",
                !signatureImage ? "border-slate-200 bg-slate-50 text-slate-400 opacity-70" : "cursor-pointer border-blue-200 bg-blue-50/50 text-slate-700",
              )}>
                <input className="mt-1 h-4 w-4 accent-blue-600" type="checkbox" disabled={!signatureImage} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                <span className="font-medium leading-relaxed">Li todas as páginas, conferi meus dados e confirmo esta assinatura como minha manifestação de vontade.</span>
              </label>

              <button className="btn btn-primary min-h-14 justify-center text-base font-black" disabled={sending || !accepted || !signatureImage || !scrolledToBottom}>
                {sending ? <><Loader2 className="h-5 w-5 animate-spin" /> Registrando assinatura...</> : "Confirmar e assinar contrato"}
              </button>
            </div>
          </form>
        )}
      </div>

      <SignaturePad
        open={signaturePadOpen}
        onCancel={() => setSignaturePadOpen(false)}
        onConfirm={(image) => {
          setSignatureImage(image);
          setSignaturePadOpen(false);
        }}
      />
    </main>
  );
}
