"use client";

import React, { useEffect, useState, useRef } from "react";
import { ArrowLeft, CheckCircle, Package, ScanLine, AlertTriangle, Search, Check, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getReceivingById, getReceivingItems, getProducts, updateReceiving, createReceivingItem, updateReceivingItem } from "@/lib/api";
import type { Receiving, ReceivingItem, Product, ProductVariant } from "@/lib/types";
import { ErrorBanner, Modal, StatusBadge } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";

export default function TriagemInterfacePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = React.use(params);

  const [receiving, setReceiving] = useState<Receiving | null>(null);
  const [items, setItems] = useState<ReceivingItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [lastScanned, setLastScanned] = useState<{ product: Product; item: ReceivingItem; quantity: number; code: string } | null>(null);
  const [variantChoice, setVariantChoice] = useState<ReceivingItem[]>([]);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanLockedRef = useRef(false);

  useEffect(() => {
    Promise.all([
      getReceivingById(id),
      getReceivingItems(id),
      getProducts()
    ])
    .then(([rec, its, prods]) => {
      if (!rec) {
        router.push("/dashboard/triagem");
        return;
      }
      setReceiving(rec);
      setItems(its);
      setProducts(prods);
      
      // Auto update status
      if (rec.status === "Aguardando Chegada" || rec.status === "Recebido") {
        updateReceiving(rec.id, { status: "Em Triagem" }).catch(console.error);
      }
    })
    .catch(console.error)
    .finally(() => setLoading(false));
  }, [id, router]);

  // Keep focus on scan input for continuous scanning
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        scanInputRef.current?.focus();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const totalExpectedByItems = items.reduce((sum, i) => sum + i.expected_quantity, 0);
  const isBlindReceipt = totalExpectedByItems === 0 && (receiving?.total_items || 0) > 0;

  const normalizeCode = (value?: string | null) => (value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map<string, ProductVariant>();
  for (const product of products) {
    for (const variant of product.variants || []) variantById.set(variant.id, variant);
  }

  const resolveItemVariant = (item: ReceivingItem) =>
    item.variant || (item.variant_id ? variantById.get(item.variant_id) ?? null : null);

  const variantCodes = (variant?: ProductVariant | null) => [
    variant?.code,
    variant?.barcode,
    variant?.sku,
  ].map(normalizeCode).filter(Boolean);

  const productCodes = (product?: Product | null) => [
    product?.barcode,
    product?.primary_barcode,
    product?.sku,
    product?.internal_code,
  ].map(normalizeCode).filter(Boolean);
  
  const registerItemScan = async (existingItem: ReceivingItem, product: Product, scannedCode?: string) => {
    try {
      const newCheckedQty = existingItem.checked_quantity + 1;
      const newStatus: ReceivingItem["status"] = isBlindReceipt
        ? "Conferido"
        : newCheckedQty > existingItem.expected_quantity
          ? "Divergente"
          : newCheckedQty === existingItem.expected_quantity
            ? "Conferido"
            : "Pendente";
      await updateReceivingItem(existingItem.id, { checked_quantity: newCheckedQty, status: newStatus });
      const updatedItem = { ...existingItem, checked_quantity: newCheckedQty, status: newStatus };
      setItems((current) => current.map((item) => item.id === existingItem.id ? updatedItem : item));
      const variant = resolveItemVariant(existingItem);
      setLastScanned({
        product,
        item: updatedItem,
        quantity: newCheckedQty,
        code: scannedCode || variant?.code || product.barcode || product.internal_code || product.sku || "",
      });
      setVariantChoice([]);
      if (!isBlindReceipt && newCheckedQty > existingItem.expected_quantity) {
        setError(`A quantidade de ${product.name}${variant ? ` · ${variant.label}` : ""} ultrapassou a NFe.`);
      }
    } catch {
      setError("Erro ao registrar a bipagem no banco de dados.");
    } finally {
      scanLockedRef.current = false;
      window.setTimeout(() => scanInputRef.current?.focus(), 0);
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanValue.trim() || !receiving || scanLockedRef.current) return;
    scanLockedRef.current = true;
    const barcode = normalizeCode(scanValue);
    setScanValue("");
    setError(null);

    // A etiqueta da variante identifica diretamente a linha correta da NFe.
    const directVariantItem = items.find((item) =>
      variantCodes(resolveItemVariant(item)).includes(barcode)
    );
    if (directVariantItem) {
      const product = directVariantItem.product || productById.get(directVariantItem.product_id);
      if (!product) {
        scanLockedRef.current = false;
        setError("A variante foi localizada, mas o produto principal não está disponível no cadastro.");
        return;
      }
      await registerItemScan(directVariantItem, product, barcode);
      return;
    }

    // Distingue variante válida de outra nota de um código completamente desconhecido.
    const knownVariant = products
      .flatMap((product) => (product.variants || []).map((variant) => ({ product, variant })))
      .find(({ variant }) => variantCodes(variant).includes(barcode));
    if (knownVariant) {
      scanLockedRef.current = false;
      setError(`A variante ${knownVariant.product.name} · ${knownVariant.variant.label} existe no cadastro, mas não consta nesta nota fiscal.`);
      window.setTimeout(() => scanInputRef.current?.focus(), 0);
      return;
    }

    const product = products.find((item) => productCodes(item).includes(barcode));
    if (!product) {
      scanLockedRef.current = false;
      setError(`Código não reconhecido: ${barcode}. Confira se a etiqueta pertence a este produto ou se a variante está cadastrada.`);
      window.setTimeout(() => scanInputRef.current?.focus(), 0);
      return;
    }

    const candidates = items.filter((item) => item.product_id === product.id);
    if (candidates.length > 1) {
      scanLockedRef.current = false;
      setVariantChoice(candidates);
      return;
    }
    if (candidates.length === 1) {
      await registerItemScan(candidates[0], product, barcode);
      return;
    }

    scanLockedRef.current = false;
    const newItem = await createReceivingItem({
      receiving_id: receiving.id,
      product_id: product.id,
      variant_id: null,
      expected_quantity: 0,
      checked_quantity: 1,
      unit_cost: product.current_cost,
      total_cost: product.current_cost,
      status: isBlindReceipt ? "Conferido" : "Divergente",
      lot_number: null,
      manufacturing_date: null,
      expiry_date: null,
    });
    const insertedItem = { ...newItem, product };
    setItems((current) => [...current, insertedItem]);
    setLastScanned({ product, item: insertedItem, quantity: 1, code: barcode });
    window.setTimeout(() => scanInputRef.current?.focus(), 0);
  };

  const handleUpdateQty = async (itemId: string, newQty: number) => {
    if (newQty < 0) return;
    try {
      const item = items.find(i => i.id === itemId);
      if (!item) return;
      const newStatus = isBlindReceipt ? "Conferido" : (newQty > item.expected_quantity ? "Divergente" : (newQty === item.expected_quantity ? "Conferido" : "Pendente"));
      await updateReceivingItem(itemId, { checked_quantity: newQty, status: newStatus });
      setItems(items.map(i => i.id === itemId ? { ...i, checked_quantity: newQty, status: newStatus } : i));
    } catch {
      setError("Erro ao atualizar quantidade.");
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Iniciando ambiente de triagem...</div>;
  if (!receiving) return null;

  const totalExpected = isBlindReceipt ? receiving.total_items : totalExpectedByItems;
  const totalChecked = items.reduce((sum, i) => sum + i.checked_quantity, 0);
  
  const finishTriagem = async () => {
    if (!receiving) return;
    try {
      // For blind receipts, we only care if the global total matches.
      // For regular receipts, we check item-level divergences too.
      let hasDivergences = false;
      if (isBlindReceipt) {
        hasDivergences = totalChecked !== receiving.total_items;
      } else {
        hasDivergences = items.some(i => i.status === "Divergente" || i.checked_quantity !== i.expected_quantity) || (receiving.total_items > 0 && totalChecked !== receiving.total_items);
      }
      await updateReceiving(receiving.id, { status: hasDivergences ? "Divergência" : "Triagem Concluída" });
      router.push(`/dashboard/recebimentos/${receiving.id}`);
    } catch (err) {
      setError("Erro ao concluir a triagem.");
    }
  };

  const progress = totalExpected > 0 ? Math.min(100, Math.round((totalChecked / totalExpected) * 100)) : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/triagem" className="icon-btn bg-white" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Triagem Física</h1>
            <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
              <span className="font-bold text-slate-700">NF: {receiving.invoice_number || "S/N"}</span>
              <span>&bull;</span>
              <span>{receiving.supplier?.trade_name}</span>
              <span>&bull;</span>
              <span className="font-bold text-blue-600">{formatCurrency(receiving.total_amount)}</span>
              <span>&bull;</span>
              <span className="font-semibold text-slate-600">{totalExpected} produtos esperados</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <div className="mr-4 text-right hidden sm:block">
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Progresso</div>
            <div className="flex items-center gap-2">
              <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className={`h-full ${progress === 100 ? 'bg-emerald-500' : 'bg-blue-500'} transition-all duration-500`} style={{ width: `${progress}%` }}></div>
              </div>
              <span className="text-sm font-bold text-slate-700">{progress}%</span>
            </div>
          </div>
          <button onClick={finishTriagem} className="btn btn-primary" disabled={items.length === 0}>
            <CheckCircle className="h-4 w-4" /> Finalizar Triagem
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* Lado Esquerdo - Scanner e Último Produto */}
        <div className="space-y-6">
          <form onSubmit={handleScan} className="card p-6 bg-slate-900 text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
              <ScanLine className="w-32 h-32" />
            </div>
            
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4"><ScanLine className="w-5 h-5 text-blue-400" /> Bipar Produto</h2>
            <p className="text-slate-400 text-sm mb-6">Leia a etiqueta da variante para conferir diretamente ou o código principal para escolher a variante.</p>
            
            <div className="relative z-10">
              <input
                ref={scanInputRef}
                type="text"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                className="w-full bg-slate-800 border-2 border-slate-700 text-white rounded-xl px-4 py-4 font-mono text-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition"
                placeholder="Escaneie o código principal ou da variante..."
                autoFocus
              />
            </div>
            <button type="submit" className="hidden">Bipar</button>
          </form>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl">
              <div className="flex items-start">
                <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
                <div className="ml-3">
                  <h3 className="text-sm font-bold text-red-800">Atenção Necessária</h3>
                  <p className="mt-1 text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {lastScanned && (
            <div className="card p-6 border-2 border-blue-100 bg-blue-50/50 relative overflow-hidden animate-in fade-in slide-in-from-bottom-4">
              <div className="absolute top-0 right-0 p-3">
                <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">Último Leitura</span>
              </div>
              <div className="flex items-center gap-4">
                {lastScanned.product.photo_url ? (
                  <img src={lastScanned.product.photo_url} alt={lastScanned.product.name} className="w-16 h-16 rounded-xl object-cover border border-blue-200" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-white border border-blue-200 flex items-center justify-center">
                    <Package className="w-8 h-8 text-blue-300" />
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 leading-tight">{lastScanned.product.name}{resolveItemVariant(lastScanned.item) ? ` · ${resolveItemVariant(lastScanned.item)?.label}` : ""}</h3>
                  <div className="text-xs text-slate-500 mt-1 font-mono">{lastScanned.code}</div>
                  <div className="text-2xl font-black text-blue-600 mt-2">{lastScanned.quantity} <span className="text-sm font-medium text-slate-500">{lastScanned.product.unit_measure} lidos</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Lado Direito - Lista de Itens */}
        <div className="lg:col-span-2">
          <div className="card h-full flex flex-col">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-800">Produtos da Nota</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Itens fiscais são preservados. A triagem altera somente a quantidade conferida.</p>
              </div>
              <div className="text-sm font-semibold text-slate-500">
                <span className="text-slate-900">{totalChecked}</span> / {totalExpected} un.
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-0">
              {items.length === 0 ? (
                <div className="p-8 text-center">
                  <Package className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-500 text-sm">Nenhum item adicionado Ã  nota ainda.<br/>Comece bipando os produtos para adicioná-los.</p>
                </div>
              ) : (
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Produto</th>
                      <th className="px-4 py-3 font-semibold text-center">Esperado</th>
                      <th className="px-4 py-3 font-semibold text-center">Conferido</th>
                      <th className="px-4 py-3 font-semibold text-center">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Conferência</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const isComplete = item.checked_quantity === item.expected_quantity && item.expected_quantity > 0;
                      const isOver = item.checked_quantity > item.expected_quantity;
                      const isZero = item.checked_quantity === 0;
                      
                      return (
                        <tr key={item.id} className={`transition-colors ${lastScanned?.item.id === item.id ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3 min-w-[200px]">
                              {item.product?.photo_url ? (
                                <img src={item.product.photo_url} className="w-8 h-8 rounded border border-slate-200 object-cover" />
                              ) : (
                                <div className="w-8 h-8 rounded border border-slate-200 bg-slate-50 flex items-center justify-center">
                                  <Package className="w-4 h-4 text-slate-300" />
                                </div>
                              )}
                              <div className="truncate max-w-[250px]">
                                <strong className={`block text-xs ${isComplete ? 'text-slate-500' : 'text-slate-900'}`}>{item.product?.name}{resolveItemVariant(item) ? ` · ${resolveItemVariant(item)?.label}` : ""}</strong>
                                <small className="text-[10px] text-slate-400 font-mono">{resolveItemVariant(item)?.code || item.product?.barcode || item.product?.sku}</small>
                                {(item.lot_number || item.expiry_date) && <small className="mt-0.5 block text-[10px] text-slate-400">{item.lot_number ? `Lote ${item.lot_number}` : "Sem lote"}{item.expiry_date ? ` · Val. ${item.expiry_date}` : ""}</small>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-slate-500 font-bold text-base">
                            {item.expected_quantity}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-bold text-base ${
                              isComplete ? 'bg-emerald-100 text-emerald-700' :
                              isOver ? 'bg-red-100 text-red-700' :
                              isZero ? 'bg-slate-100 text-slate-400' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {item.checked_quantity}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isComplete && <StatusBadge tone="green">OK</StatusBadge>}
                            {isOver && <StatusBadge tone="red">Sobra</StatusBadge>}
                            {(!isComplete && !isOver && !isZero) && <StatusBadge tone="yellow">Em progresso</StatusBadge>}
                            {isZero && <StatusBadge tone="gray">Pendente</StatusBadge>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={item.checked_quantity <= 0}
                                onClick={() => handleUpdateQty(item.id, item.checked_quantity - 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                                title="Desfazer uma unidade conferida"
                              >
                                -
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateQty(item.id, item.checked_quantity + 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition hover:bg-slate-200"
                                title="Adicionar uma unidade conferida"
                              >
                                +
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

      </div>

      <Modal open={variantChoice.length > 0} onClose={() => setVariantChoice([])} title="Qual variante foi conferida?" description="O código principal foi identificado. Selecione a cor, tamanho ou apresentação recebida." size="sm">
        <div className="grid gap-2">
          {variantChoice.map((item) => (
            <button
              type="button"
              key={item.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 p-4 text-left transition hover:border-blue-400 hover:bg-blue-50"
              onClick={() => {
                const product = item.product || productById.get(item.product_id);
                if (product) {
                  scanLockedRef.current = true;
                  void registerItemScan(item, product, productCodes(product)[0]);
                }
              }}
            >
              <span><strong className="block text-sm text-slate-900">{resolveItemVariant(item)?.label || "Produto único"}</strong><small className="mt-1 block font-mono text-xs text-slate-400">{resolveItemVariant(item)?.code || item.product?.barcode}</small></span>
              <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{item.checked_quantity}/{item.expected_quantity}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
