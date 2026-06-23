"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Barcode, Boxes, Building2, Calendar, FileText, Package, Save, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createReceiving, createReceivingItem, getProducts, getSuppliers } from "@/lib/api";
import type { Product, ProductVariant, Supplier } from "@/lib/types";
import { ErrorBanner, FieldLabel, StatusBadge } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";

type ReceivingLine = {
  key: string;
  product: Product;
  variant: ProductVariant | null;
  expected_quantity: number;
  unit_cost: number;
  lot_number: string;
  manufacturing_date: string;
  expiry_date: string;
};

function lineKey(productId: string, variantId?: string | null) {
  return `${productId}:${variantId || "main"}`;
}

export default function NovoRecebimentoPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<ReceivingLine[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    supplier_id: "",
    invoice_number: "",
    invoice_key: "",
    issue_date: "",
    expected_delivery_date: "",
    total_amount: "",
    observations: "",
  });

  useEffect(() => {
    Promise.all([getSuppliers(), getProducts()])
      .then(([nextSuppliers, nextProducts]) => {
        setSuppliers(nextSuppliers);
        setProducts(nextProducts.filter((product) => product.active));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao carregar cadastro."));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, { product: Product; lines: ReceivingLine[] }>();
    for (const line of lines) {
      const group = map.get(line.product.id) ?? { product: line.product, lines: [] };
      group.lines.push(line);
      map.set(line.product.id, group);
    }
    return [...map.values()];
  }, [lines]);

  const selectedLines = lines.filter((line) => line.expected_quantity > 0);
  const totalItems = selectedLines.reduce((total, line) => total + line.expected_quantity, 0);
  const calculatedTotal = selectedLines.reduce((total, line) => total + line.expected_quantity * line.unit_cost, 0);

  function addMainProduct(event: FormEvent) {
    event.preventDefault();
    const code = scanValue.trim();
    if (!code) return;
    const product = products.find((item) =>
      item.barcode === code || item.primary_barcode === code || item.internal_code === code || item.sku === code
    );
    if (!product) {
      setError(`Código principal não encontrado: ${code}. Códigos de variantes não são aceitos neste campo.`);
      return;
    }
    if (lines.some((line) => line.product.id === product.id)) {
      setError(`${product.name} já está aberto na grade abaixo.`);
      setScanValue("");
      return;
    }

    const nextLines: ReceivingLine[] = product.variants?.length
      ? product.variants.filter((variant) => variant.active).map((variant) => ({
          key: lineKey(product.id, variant.id),
          product,
          variant,
          expected_quantity: 0,
          unit_cost: Number(variant.current_cost || product.current_cost || 0),
          lot_number: "",
          manufacturing_date: "",
          expiry_date: "",
        }))
      : [{
          key: lineKey(product.id),
          product,
          variant: null,
          expected_quantity: 1,
          unit_cost: Number(product.current_cost || 0),
          lot_number: "",
          manufacturing_date: "",
          expiry_date: "",
        }];

    setLines((current) => [...current, ...nextLines]);
    setScanValue("");
    setError(null);
  }

  function updateLine(key: string, values: Partial<ReceivingLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...values } : line));
  }

  function removeProduct(productId: string) {
    setLines((current) => current.filter((line) => line.product.id !== productId));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.supplier_id) {
      setError("Selecione o fornecedor.");
      return;
    }
    if (!selectedLines.length) {
      setError("Informe pelo menos uma quantidade para receber.");
      return;
    }
    const missingExpiry = selectedLines.find((line) => line.product.track_expiry && !line.expiry_date);
    if (missingExpiry) {
      setError(`Informe a validade de ${missingExpiry.product.name}${missingExpiry.variant ? ` - ${missingExpiry.variant.label}` : ""}.`);
      return;
    }
    const missingLot = selectedLines.find((line) => line.product.track_lots && !line.lot_number.trim());
    if (missingLot) {
      setError(`Informe o lote de ${missingLot.product.name}${missingLot.variant ? ` - ${missingLot.variant.label}` : ""}.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const receiving = await createReceiving({
        supplier_id: form.supplier_id,
        invoice_number: form.invoice_number.trim() || null,
        invoice_key: form.invoice_key.trim() || null,
        issue_date: form.issue_date || null,
        expected_delivery_date: form.expected_delivery_date || null,
        total_amount: Number(form.total_amount) || calculatedTotal,
        total_items: totalItems,
        status: "Aguardando Chegada",
        observations: form.observations.trim() || null,
      });

      await Promise.all(selectedLines.map((line) => createReceivingItem({
        receiving_id: receiving.id,
        product_id: line.product.id,
        variant_id: line.variant?.id || null,
        expected_quantity: line.expected_quantity,
        checked_quantity: 0,
        unit_cost: line.unit_cost,
        total_cost: line.expected_quantity * line.unit_cost,
        status: "Pendente",
        lot_number: line.lot_number.trim() || null,
        manufacturing_date: line.manufacturing_date || null,
        expiry_date: line.expiry_date || null,
      })));

      router.push(`/dashboard/recebimentos/${receiving.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao registrar recebimento.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/recebimentos" className="icon-btn bg-white" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Link>
          <div><h1 className="text-2xl font-black text-slate-900">Novo recebimento</h1><p className="text-sm text-slate-500">Nota fiscal, variantes, lotes e validade em uma única conferência.</p></div>
        </div>
        <div className="flex gap-2"><Link href="/dashboard/recebimentos" className="btn btn-secondary">Cancelar</Link><button className="btn btn-primary" disabled={saving}><Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar recebimento"}</button></div>
      </header>

      <ErrorBanner message={error} />

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-6">
          <section className="card p-6">
            <h2 className="mb-5 flex items-center gap-2 text-lg font-black text-slate-900"><Building2 className="h-5 w-5 text-blue-600" /> Fornecedor e NFe</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><FieldLabel required>Fornecedor</FieldLabel><select className="field" required value={form.supplier_id} onChange={(event) => setForm({ ...form, supplier_id: event.target.value })}><option value="">Selecione</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.corporate_name}</option>)}</select></label>
              <label><FieldLabel>Número da NFe</FieldLabel><input className="field" value={form.invoice_number} onChange={(event) => setForm({ ...form, invoice_number: event.target.value })} /></label>
              <label><FieldLabel>Chave da NFe</FieldLabel><input className="field font-mono" inputMode="numeric" maxLength={44} value={form.invoice_key} onChange={(event) => setForm({ ...form, invoice_key: event.target.value.replace(/\D/g, "") })} /></label>
            </div>
          </section>

          <section className="card p-6">
            <div className="mb-4"><h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><Barcode className="h-5 w-5 text-indigo-600" /> Adicionar produto principal</h2><p className="mt-1 text-xs text-slate-500">Leia somente o código mestre. Depois informe a quantidade de cada variante na grade.</p></div>
            <div className="flex gap-2">
              <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="field pl-10 font-mono" value={scanValue} onChange={(event) => setScanValue(event.target.value)} placeholder="Ex.: 52424173" /></div>
              <button type="button" onClick={addMainProduct} className="btn bg-slate-900 text-white">Carregar</button>
            </div>
          </section>

          {groups.map(({ product, lines: productLines }) => (
            <section key={product.id} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-blue-600 shadow-sm"><Package className="h-5 w-5" /></span><div><h3 className="font-black text-slate-900">{product.name}</h3><p className="text-xs font-mono text-slate-400">{product.barcode || product.internal_code || product.sku}</p></div></div>
                <div className="flex items-center gap-2">{product.variants?.length ? <StatusBadge tone="blue">{product.variants.length} variantes</StatusBadge> : <StatusBadge tone="gray">Sem variantes</StatusBadge>}<button type="button" className="icon-btn text-red-500" onClick={() => removeProduct(product.id)}><Trash2 className="h-4 w-4" /></button></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="bg-white text-[10px] font-black uppercase tracking-[.1em] text-slate-400"><tr><th className="px-4 py-3">Variante</th><th className="px-4 py-3">Código interno</th><th className="px-4 py-3">Qtd.</th><th className="px-4 py-3">Custo</th><th className="px-4 py-3">Lote</th><th className="px-4 py-3">Fabricação</th><th className="px-4 py-3">Validade</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {productLines.map((line) => (
                      <tr key={line.key} className={line.expected_quantity > 0 ? "bg-blue-50/30" : ""}>
                        <td className="px-4 py-3"><strong>{line.variant?.label || "Produto único"}</strong>{line.variant && <p className="mt-1 text-[10px] text-slate-400">{[line.variant.color, line.variant.size].filter(Boolean).join(" · ")}</p>}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{line.variant?.code || product.barcode || product.internal_code || "-"}</td>
                        <td className="px-4 py-3"><input className="field w-20 text-center font-black" type="number" min={0} value={line.expected_quantity} onChange={(event) => updateLine(line.key, { expected_quantity: Math.max(0, Number(event.target.value)) })} /></td>
                        <td className="px-4 py-3"><input className="field w-28" type="number" min={0} step="0.01" value={line.unit_cost} onChange={(event) => updateLine(line.key, { unit_cost: Math.max(0, Number(event.target.value)) })} /></td>
                        <td className="px-4 py-3"><input className="field w-32" disabled={!product.track_lots && !product.track_expiry} value={line.lot_number} onChange={(event) => updateLine(line.key, { lot_number: event.target.value })} placeholder={product.track_lots ? "Obrigatório" : "Opcional"} /></td>
                        <td className="px-4 py-3"><input className="field w-36" type="date" disabled={!product.track_lots && !product.track_expiry} value={line.manufacturing_date} onChange={(event) => updateLine(line.key, { manufacturing_date: event.target.value })} /></td>
                        <td className="px-4 py-3"><input className="field w-36" type="date" disabled={!product.track_expiry} value={line.expiry_date} onChange={(event) => updateLine(line.key, { expiry_date: event.target.value })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {!groups.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center"><Boxes className="mx-auto h-10 w-10 text-slate-300" /><h3 className="mt-3 font-bold text-slate-700">Nenhum produto carregado</h3><p className="mt-1 text-sm text-slate-400">Leia o código principal para abrir a grade de recebimento.</p></div>}
        </div>

        <aside className="grid content-start gap-5">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-black text-slate-900"><FileText className="h-5 w-5 text-emerald-600" /> Resumo</h2>
            <div className="mt-5 grid gap-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Unidades</span><strong>{totalItems}</strong></div>
              <div className="flex justify-between"><span className="text-slate-500">Linhas</span><strong>{selectedLines.length}</strong></div>
              <div className="flex justify-between border-t border-slate-100 pt-3"><span className="text-slate-500">Total calculado</span><strong className="text-emerald-600">{formatCurrency(calculatedTotal)}</strong></div>
              <label><FieldLabel>Valor informado da NFe</FieldLabel><input className="field" type="number" min={0} step="0.01" value={form.total_amount} onChange={(event) => setForm({ ...form, total_amount: event.target.value })} placeholder={calculatedTotal.toFixed(2)} /></label>
            </div>
          </section>
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-black text-slate-900"><Calendar className="h-5 w-5 text-orange-600" /> Datas</h2>
            <div className="mt-4 grid gap-4"><label><FieldLabel>Emissão</FieldLabel><input className="field" type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} /></label><label><FieldLabel>Previsão de entrega</FieldLabel><input className="field" type="date" value={form.expected_delivery_date} onChange={(event) => setForm({ ...form, expected_delivery_date: event.target.value })} /></label></div>
          </section>
          <section className="card p-5"><FieldLabel>Observações</FieldLabel><textarea className="field mt-2 min-h-28" value={form.observations} onChange={(event) => setForm({ ...form, observations: event.target.value })} placeholder="Transportadora, avarias, conferência fiscal..." /></section>
        </aside>
      </div>
    </form>
  );
}
