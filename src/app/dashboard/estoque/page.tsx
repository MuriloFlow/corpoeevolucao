"use client";

import { useEffect, useState } from "react";
import { Package, ArrowDownRight, ArrowUpRight, AlertTriangle, Search, Activity, DollarSign, Settings2, Plus, Minus, Save } from "lucide-react";
import { getProducts, expandProductsWithVariants, getInventoryTransactions, getStockBatches, createInventoryTransaction, updateProduct, updateProductVariant } from "@/lib/api";
import type { Product, StockBatch } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Modal, ErrorBanner, FieldLabel } from "@/components/ui";

export default function EstoquePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    product_id: "",
    type: "IN",
    quantity: "1",
    reason: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      getProducts(),
      getInventoryTransactions(),
      getStockBatches(),
    ]).then(([prods, trans, nextBatches]) => {
      setProducts(expandProductsWithVariants(prods));
      setTransactions(trans);
      setBatches(nextBatches);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustForm.product_id) {
      setError("Selecione um produto.");
      return;
    }

    const qty = Number(adjustForm.quantity);
    if (qty <= 0) {
      setError("A quantidade deve ser maior que zero.");
      return;
    }

    const product = products.find(p => p.id === adjustForm.product_id);
    if (!product) return;

    if (adjustForm.type === "OUT" && product.current_stock < qty) {
      setError(`Estoque insuficiente. O produto possui apenas ${product.current_stock} un.`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const newStock = adjustForm.type === "IN" 
        ? product.current_stock + qty 
        : product.current_stock - qty;

      if (product.parent_product_id) {
        await updateProductVariant(product.id, { current_stock: newStock });
      } else {
        await updateProduct(product.id, { current_stock: newStock });
      }
      
      await createInventoryTransaction({
        product_id: product.parent_product_id || product.id,
        variant_id: product.parent_product_id ? product.id : null,
        batch_id: null,
        transaction_type: adjustForm.type,
        quantity: qty,
        previous_stock: product.current_stock,
        new_stock: newStock,
        reason: adjustForm.reason.trim() || 'Ajuste Manual de Estoque',
        reference_id: null
      });

      setModalOpen(false);
      setAdjustForm({ product_id: "", type: "IN", quantity: "1", reason: "" });
      fetchData(); // Reload data
    } catch (err) {
      setError("Erro ao salvar ajuste.");
      setSaving(false);
    }
  };

  if (loading && products.length === 0) return <div className="p-8 text-center text-slate-500">Carregando painel de estoque...</div>;

  const totalValue = products.reduce((acc, p) => acc + (p.current_stock * p.current_cost), 0);
  const potentialRevenue = products.reduce((acc, p) => acc + (p.current_stock * p.selling_price), 0);
  const outOfStock = products.filter(p => p.current_stock <= 0).length;
  const lowStock = products.filter(p => p.current_stock > 0 && p.current_stock <= p.minimum_stock).length;

  const criticalProducts = products.filter(p => p.current_stock <= p.minimum_stock).sort((a, b) => a.current_stock - b.current_stock);
  const expiryLimit = new Date();
  expiryLimit.setDate(expiryLimit.getDate() + 30);
  const expiryLimitKey = expiryLimit.toISOString().slice(0, 10);
  const todayKey = new Date().toISOString().slice(0, 10);
  const expiringBatches = batches
    .filter((batch) => batch.available_quantity > 0 && batch.expiry_date && batch.expiry_date <= expiryLimitKey)
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Visão Geral do Estoque</h1>
          <p className="text-sm text-slate-500 mt-1">Monitore o patrimÃ´nio, nível de ruptura e histórico de movimentações</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn btn-primary bg-slate-800 hover:bg-slate-900 border-none shadow-lg shadow-slate-900/20">
          <Settings2 className="w-4 h-4" /> Ajuste Manual
        </button>
      </header>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <div className="card p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-blue-50 rounded-full opacity-50"></div>
          <div className="flex items-center gap-3 mb-2 text-slate-500 font-semibold relative z-10">
            <DollarSign className="w-5 h-5 text-blue-500" />
            Valor em Custo
          </div>
          <div className="text-2xl font-black text-slate-900 relative z-10">{formatCurrency(totalValue)}</div>
        </div>

        <div className="card p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-emerald-50 rounded-full opacity-50"></div>
          <div className="flex items-center gap-3 mb-2 text-slate-500 font-semibold relative z-10">
            <Activity className="w-5 h-5 text-emerald-500" />
            Potencial de Venda
          </div>
          <div className="text-2xl font-black text-slate-900 relative z-10">{formatCurrency(potentialRevenue)}</div>
        </div>

        <div className="card p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-amber-50 rounded-full opacity-50"></div>
          <div className="flex items-center gap-3 mb-2 text-slate-500 font-semibold relative z-10">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Estoque Baixo
          </div>
          <div className="text-2xl font-black text-slate-900 relative z-10">{lowStock} <span className="text-sm font-medium text-slate-500">produtos</span></div>
        </div>

        <div className="card p-5 relative overflow-hidden bg-red-50/30 border-red-100">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-red-50 rounded-full opacity-50"></div>
          <div className="flex items-center gap-3 mb-2 text-red-600 font-semibold relative z-10">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Ruptura (Sem Estoque)
          </div>
          <div className="text-2xl font-black text-red-700 relative z-10">{outOfStock} <span className="text-sm font-medium text-red-500">produtos</span></div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Produtos em Alerta */}
        <section className="card p-0 flex flex-col h-[500px]">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10 rounded-t-xl">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Alerta de Reposição
            </h2>
            <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-md">{criticalProducts.length} itens</span>
          </div>
          <div className="overflow-y-auto p-0 flex-1">
            {criticalProducts.length === 0 ? (
              <div className="p-8 text-center text-emerald-600 font-medium">Todos os produtos estão com estoque saudável!</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Produto</th>
                    <th className="px-5 py-3 font-semibold text-center">Atual</th>
                    <th className="px-5 py-3 font-semibold text-center">Mínimo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {criticalProducts.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3">
                        <strong className={`block text-xs ${p.current_stock <= 0 ? 'text-red-700' : 'text-slate-900'}`}>{p.name}</strong>
                        <small className="text-[10px] text-slate-500 font-mono">{p.barcode || p.sku}</small>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded font-bold text-xs ${p.current_stock <= 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {p.current_stock}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center text-slate-500 font-medium">{p.minimum_stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Últimas Movimentações */}
        <section className="card p-0 flex flex-col h-[500px]">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10 rounded-t-xl">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              Últimas Movimentações
            </h2>
          </div>
          <div className="overflow-y-auto p-0 flex-1">
            {transactions.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-medium">Nenhuma movimentação registrada.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {transactions.map(t => (
                  <div key={t.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center gap-4">
                    <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${t.transaction_type === 'IN' ? 'bg-emerald-100 text-emerald-600' : t.transaction_type === 'OUT' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                      {t.transaction_type === 'IN' ? <ArrowDownRight className="w-5 h-5" /> : t.transaction_type === 'OUT' ? <ArrowUpRight className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-0.5">
                        <strong className="text-sm text-slate-900 truncate pr-2">{t.product?.name || "Produto excluído"}</strong>
                        <span className={`text-sm font-bold whitespace-nowrap ${t.transaction_type === 'IN' ? 'text-emerald-600' : t.transaction_type === 'OUT' ? 'text-red-600' : 'text-blue-600'}`}>
                          {t.transaction_type === 'IN' ? '+' : t.transaction_type === 'OUT' ? '-' : ''}{t.quantity}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-slate-500">
                        <span className="truncate pr-2">{t.reason || (t.transaction_type === 'IN' ? 'Entrada' : 'Saída')}</span>
                        <span className="whitespace-nowrap">{t.created_at ? formatDate(t.created_at) : ''}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {expiringBatches.length > 0 && (
        <section className="card mt-6 overflow-hidden">
          <div className="border-b border-slate-100 p-5"><h2 className="flex items-center gap-2 font-bold text-slate-800"><AlertTriangle className="h-5 w-5 text-orange-500" /> Lotes vencidos ou próximos do vencimento</h2><p className="mt-1 text-xs text-slate-500">Priorize a saída pelo método FEFO: o lote que vence primeiro deve sair primeiro.</p></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Lote</th><th>Validade</th><th className="text-right">Disponível</th><th>Status</th></tr></thead><tbody>{expiringBatches.map((batch) => <tr key={batch.id}><td className="font-mono text-xs">{batch.lot_number || "Sem identificação"}</td><td>{batch.expiry_date ? formatDate(batch.expiry_date) : "-"}</td><td className="text-right font-bold">{batch.available_quantity}</td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${String(batch.expiry_date) < todayKey ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>{String(batch.expiry_date) < todayKey ? "Vencido" : "Vence em até 30 dias"}</span></td></tr>)}</tbody></table></div>
        </section>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Ajuste Manual de Estoque" size="md">
        <form onSubmit={handleAdjustSubmit} className="py-4 space-y-4">
          <ErrorBanner message={error} />
          
          <div>
            <FieldLabel>Produto *</FieldLabel>
            <select 
              value={adjustForm.product_id} 
              onChange={e => setAdjustForm({...adjustForm, product_id: e.target.value})} 
              className="field" 
              required
            >
              <option value="">-- Selecione o Produto --</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} (Estoque atual: {p.current_stock})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Tipo de Movimentação *</FieldLabel>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setAdjustForm({...adjustForm, type: "IN"})}
                  className={`flex items-center justify-center gap-2 p-2 rounded-lg border-2 font-bold transition ${adjustForm.type === 'IN' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                >
                  <Plus className="w-4 h-4" /> Entrada
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustForm({...adjustForm, type: "OUT"})}
                  className={`flex items-center justify-center gap-2 p-2 rounded-lg border-2 font-bold transition ${adjustForm.type === 'OUT' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                >
                  <Minus className="w-4 h-4" /> Saída
                </button>
              </div>
            </div>
            <div>
              <FieldLabel>Quantidade *</FieldLabel>
              <input 
                type="number" 
                min="1"
                value={adjustForm.quantity} 
                onChange={e => setAdjustForm({...adjustForm, quantity: e.target.value})} 
                className="field mt-2 font-bold text-lg" 
                required 
              />
            </div>
          </div>

          <div>
            <FieldLabel>Motivo / Observação</FieldLabel>
            <input 
              type="text" 
              value={adjustForm.reason} 
              onChange={e => setAdjustForm({...adjustForm, reason: e.target.value})} 
              className="field" 
              placeholder="Ex: Contagem de inventário, Avaria, etc" 
            />
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end gap-3">
            <button type="button" onClick={() => setModalOpen(false)} className="btn btn-secondary" disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Salvar Ajuste"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
