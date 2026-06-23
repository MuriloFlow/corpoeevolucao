"use client";

import { useEffect, useState } from "react";
import { Plus, Search, Tag, Eye, PackageOpen, AlertCircle, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { getProducts } from "@/lib/api";
import type { Product } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { EmptyState, SearchInput, StatusBadge } from "@/components/ui";

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "low_stock">("all");

  useEffect(() => {
    getProducts()
      .then((data) => setProducts(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = products.filter((p) => {
    if (filter === "active" && !p.active) return false;
    if (filter === "inactive" && p.active) return false;
    if (filter === "low_stock" && p.current_stock > p.minimum_stock && !p.variants?.some((variant) => variant.current_stock <= variant.minimum_stock)) return false;
    if (!search) return true;
    const term = search.toLowerCase();
    return p.name.toLowerCase().includes(term) || 
           p.barcode?.includes(term) || 
           p.sku?.toLowerCase().includes(term) ||
           p.variants?.some((variant) =>
             variant.label.toLowerCase().includes(term)
             || variant.code.includes(term)
             || variant.sku?.toLowerCase().includes(term)
           );
  });

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Carregando produtos...</div>;
  }

  const calculateMargin = (cost: number, price: number) => {
    if (!price || !cost) return 0;
    return ((price - cost) / price) * 100;
  };

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Produtos</h1>
          <p className="text-sm text-slate-500">Gerencie o cadastro mestre, preços e estoque</p>
        </div>
        <Link href="/dashboard/produtos/novo" className="btn btn-primary whitespace-nowrap">
          <Plus className="h-4 w-4" /> Novo Produto
        </Link>
      </header>

      <section className="card">
        <div className="table-toolbar flex-wrap gap-4">
          <div className="flex-1 min-w-[280px]">
            <SearchInput 
              value={search} 
              onChange={setSearch} 
              placeholder="Buscar por nome, EAN ou SKU..." 
            />
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                ["all", "Todos"],
                ["active", "Ativos"],
                ["inactive", "Inativos"],
                ["low_stock", "Estoque Baixo"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded-lg px-3 py-2 text-[11px] font-semibold transition ${
                  filter === value
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="hide-mobile">Categoria</th>
                  <th className="text-right">Estoque</th>
                  <th className="text-right hide-mobile">Custo</th>
                  <th className="text-right">Preço</th>
                  <th className="text-right hide-mobile">Margem</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const margin = calculateMargin(p.current_cost, p.selling_price);
                  const isLowStock = p.current_stock <= p.minimum_stock;
                  
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200">
                            <Tag className="w-5 h-5 text-slate-400" />
                          </div>
                          <span className="min-w-0">
                            <strong className="block truncate text-xs text-slate-900">{p.name}</strong>
                            <small className="mt-1 flex items-center gap-2 truncate text-[10px] text-slate-500">
                              {p.barcode ? <span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">EAN: {p.barcode}</span> : null}
                              {p.sku ? <span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">SKU: {p.sku}</span> : null}
                              {p.variants?.length ? <span className="rounded bg-blue-50 px-1.5 py-0.5 font-bold text-blue-600">{p.variants.length} variantes</span> : null}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td className="hide-mobile">
                        <span className="text-xs text-slate-600 font-medium">{p.category || "Sem categoria"}</span>
                      </td>
                      <td className="text-right">
                        <div className="flex flex-col items-end">
                          <span className={`text-sm font-bold ${isLowStock ? "text-red-600" : "text-slate-900"}`}>
                            {p.current_stock} <span className="text-[10px] font-normal text-slate-500">{p.unit_measure}</span>
                          </span>
                          {isLowStock && <span className="text-[10px] text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Baixo</span>}
                        </div>
                      </td>
                      <td className="text-right hide-mobile text-sm font-medium text-slate-500">
                        {formatCurrency(p.current_cost)}
                      </td>
                      <td className="text-right text-sm font-bold text-slate-900">
                        {formatCurrency(p.selling_price)}
                      </td>
                      <td className="text-right hide-mobile">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${margin > 30 ? "text-emerald-600" : margin > 10 ? "text-amber-600" : "text-red-600"}`}>
                          {margin > 30 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {margin.toFixed(1)}%
                        </span>
                      </td>
                      <td>
                        <StatusBadge tone={p.active ? "green" : "gray"}>
                          {p.active ? "Ativo" : "Inativo"}
                        </StatusBadge>
                      </td>
                      <td>
                        <Link href={`/dashboard/produtos/${p.id}/editar`} className="icon-btn" title="Editar produto">
                          <Eye className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState 
            icon={PackageOpen} 
            title="Nenhum produto encontrado" 
            description="Você ainda não possui produtos ou a busca não retornou resultados." 
            action={
              <Link href="/dashboard/produtos/novo" className="btn btn-primary mt-4">
                Cadastrar Produto
              </Link>
            } 
          />
        )}
      </section>
    </>
  );
}
