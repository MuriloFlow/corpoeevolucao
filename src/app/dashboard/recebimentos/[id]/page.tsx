"use client";

import React, { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle, Package, Truck, FileText, AlertTriangle, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getReceivingById, getReceivingItems, updateReceiving, createInventoryTransaction, updateProduct, updateProductVariant, createStockBatch, deleteReceiving } from "@/lib/api";
import type { Receiving, ReceivingItem } from "@/lib/types";
import { ErrorBanner, StatusBadge } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function ReceivingDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = React.use(params);

  const [receiving, setReceiving] = useState<Receiving | null>(null);
  const [items, setItems] = useState<ReceivingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getReceivingById(id),
      getReceivingItems(id)
    ])
    .then(([rec, its]) => {
      if (!rec) {
        router.push("/dashboard/recebimentos");
        return;
      }
      setReceiving(rec);
      setItems(its);
    })
    .catch(console.error)
    .finally(() => setLoading(false));
  }, [id, router]);

  const handleDelete = async () => {
    if (!receiving || !confirm("Tem certeza que deseja excluir esta nota? Os itens serão removidos. Essa ação não pode ser desfeita.")) return;
    try {
      await deleteReceiving(receiving.id);
      router.push("/dashboard/recebimentos");
    } catch (err) {
      setError("Erro ao excluir recebimento.");
    }
  };

  const finalizeReceiving = async () => {
    if (!receiving || !confirm("Tem certeza que deseja finalizar a nota? Ao confirmar, ela ficará liberada para armazenagem e o estoque será atualizado permanentemente.")) return;
    
    setProcessing(true);
    setError(null);

    try {
      // For each item, update stock and create transaction
      for (const item of items) {
        if (!item.product || item.checked_quantity <= 0) continue;

        const previousStock = item.variant?.current_stock ?? item.product.current_stock;
        const newStock = previousStock + item.checked_quantity;
        if (item.variant) {
          await updateProductVariant(item.variant.id, {
            current_stock: newStock,
            current_cost: item.unit_cost,
          });
        } else {
          await updateProduct(item.product.id, {
            current_stock: newStock,
            current_cost: item.unit_cost,
          });
        }

        let batchId: string | null = null;
        if (item.checked_quantity > 0 && (item.product.track_lots || item.product.track_expiry || item.lot_number || item.expiry_date)) {
          const batch = await createStockBatch({
            product_id: item.product.id,
            variant_id: item.variant_id || null,
            receiving_item_id: item.id,
            lot_number: item.lot_number || null,
            manufacturing_date: item.manufacturing_date || null,
            expiry_date: item.expiry_date || null,
            received_quantity: item.checked_quantity,
            available_quantity: item.checked_quantity,
            unit_cost: item.unit_cost,
            status: "active",
          });
          batchId = batch.id;
        }
        
        await createInventoryTransaction({
          product_id: item.product.id,
          variant_id: item.variant_id || null,
          batch_id: batchId,
          transaction_type: "IN",
          quantity: item.checked_quantity,
          previous_stock: previousStock,
          new_stock: newStock,
          reason: `Entrada via NFe ${receiving.invoice_number || 'S/N'}`,
          reference_id: receiving.id
        });
      }

      await updateReceiving(receiving.id, { status: "Finalizado" });
      router.push("/dashboard/recebimentos");
    } catch (err) {
      setError("Erro ao processar entrada no estoque.");
      setProcessing(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Carregando detalhes...</div>;
  if (!receiving) return null;

  const totalExpected = items.reduce((sum, i) => sum + i.expected_quantity, 0);
  const totalChecked = items.reduce((sum, i) => sum + i.checked_quantity, 0);
  const triageHasEvidence = totalChecked > 0
    || ["Triagem Concluída", "Divergência", "Finalizado"].includes(receiving.status);
  const hasDivergences = triageHasEvidence
    && items.some(i => i.status === "Divergente" || i.checked_quantity !== i.expected_quantity);
  const canFinalize = (receiving.status === "Triagem Concluída" || receiving.status === "Divergência") && items.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Link href="/dashboard/recebimentos" className="icon-btn bg-white mt-1" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-black tracking-tight text-slate-900">Nota Fiscal</h1>
              <StatusBadge tone={
                receiving.status === "Finalizado" ? "green" :
                receiving.status === "Divergência" ? "red" :
                receiving.status === "Aguardando Chegada" ? "gray" :
                "blue"
              }>
                {receiving.status === "Finalizado" ? "Armazenado" : receiving.status}
              </StatusBadge>
            </div>
            <p className="text-sm text-slate-500">
              Fornecedor: <strong>{receiving.supplier?.trade_name || receiving.supplier?.corporate_name}</strong>
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={handleDelete} className="icon-btn text-red-500 hover:bg-red-50 hover:text-red-600 mr-2" aria-label="Excluir">
            <Trash2 className="h-4 w-4" />
          </button>
          {receiving.status !== "Finalizado" && (
            <Link href={`/dashboard/triagem/${receiving.id}`} className="btn bg-blue-50 text-blue-700 hover:bg-blue-100 border-none">
              <Play className="h-4 w-4" /> {receiving.status === "Aguardando Chegada" || receiving.status === "Recebido" ? "Iniciar Triagem" : "Continuar Triagem"}
            </Link>
          )}
          {canFinalize && (
            <button onClick={finalizeReceiving} disabled={processing} className="btn bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-lg shadow-emerald-600/20">
              <CheckCircle className="h-4 w-4" /> {processing ? "Processando..." : "Finalizar Nota / Armazenar"}
            </button>
          )}
        </div>
      </header>

      <ErrorBanner message={error} />

      {hasDivergences && receiving.status !== "Finalizado" && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-amber-800">Divergências Encontradas</h3>
            <p className="text-sm text-amber-700 mt-1">A quantidade conferida na triagem não bate com a nota fiscal. Você pode continuar a triagem ou dar entrada no estoque assumindo as divergências.</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        <section className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center text-blue-600"><FileText className="w-4 h-4" /></div>
            <h2 className="font-bold text-slate-800">Dados da Nota</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Número NFe</span>
              <span className="font-bold">{receiving.invoice_number || "S/N"}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Valor Total</span>
              <span className="font-bold">{formatCurrency(receiving.total_amount)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Emissão</span>
              <span className="font-medium">{receiving.issue_date ? formatDate(receiving.issue_date) : "-"}</span>
            </div>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded bg-indigo-50 flex items-center justify-center text-indigo-600"><Truck className="w-4 h-4" /></div>
            <h2 className="font-bold text-slate-800">Fornecedor</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Razão Social</span>
              <span className="font-medium truncate max-w-[150px]">{receiving.supplier?.corporate_name}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">CNPJ</span>
              <span className="font-medium">{receiving.supplier?.cnpj || "-"}</span>
            </div>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded bg-emerald-50 flex items-center justify-center text-emerald-600"><Package className="w-4 h-4" /></div>
            <h2 className="font-bold text-slate-800">Resumo Físico</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Esperado (NFe)</span>
              <span className="font-bold">{totalExpected} un.</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Conferido (Real)</span>
              <span className={`font-bold ${totalChecked !== totalExpected ? 'text-amber-600' : 'text-emerald-600'}`}>{totalChecked} un.</span>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="p-5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800">Itens do Recebimento</h2>
        </div>
        <div className="table-wrap">
          {items.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              Nenhum item inserido ainda. <br/>Inicie a triagem para bipar os produtos.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="text-right">Custo Unit.</th>
                  <th className="text-center">Esperado</th>
                  <th className="text-center">Conferido</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isComplete = item.checked_quantity === item.expected_quantity && item.expected_quantity > 0;
                  const isOver = item.checked_quantity > item.expected_quantity;
                  const isZero = item.checked_quantity === 0;

                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          {item.product?.photo_url ? (
                            <img src={item.product.photo_url} className="w-10 h-10 rounded-lg border border-slate-200 object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
                              <Package className="w-5 h-5 text-slate-300" />
                            </div>
                          )}
                          <div className="truncate max-w-[300px]">
                            <strong className="block text-xs text-slate-900">{item.product?.name}{item.variant ? ` · ${item.variant.label}` : ""}</strong>
                            <small className="text-[10px] text-slate-500 font-mono">{item.variant?.code || item.product?.barcode || item.product?.sku}</small>
                            {(item.lot_number || item.expiry_date) && <small className="mt-1 block text-[10px] text-slate-400">{item.lot_number ? `Lote ${item.lot_number}` : "Sem lote"}{item.expiry_date ? ` · Val. ${formatDate(item.expiry_date)}` : ""}</small>}
                          </div>
                        </div>
                      </td>
                      <td className="text-right font-medium text-slate-500">{formatCurrency(item.unit_cost)}</td>
                      <td className="text-center text-slate-500 font-bold">{item.expected_quantity}</td>
                      <td className="text-center">
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded font-bold text-sm ${
                          isComplete ? 'bg-emerald-100 text-emerald-700' :
                          isOver ? 'bg-red-100 text-red-700' :
                          isZero ? 'bg-slate-100 text-slate-400' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {item.checked_quantity}
                        </span>
                      </td>
                      <td className="text-center">
                        {isComplete && <StatusBadge tone="green">OK</StatusBadge>}
                        {isOver && <StatusBadge tone="red">Sobra</StatusBadge>}
                        {(!isComplete && !isOver && !isZero) && <StatusBadge tone="yellow">Em progresso</StatusBadge>}
                        {isZero && <StatusBadge tone="gray">Pendente</StatusBadge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
