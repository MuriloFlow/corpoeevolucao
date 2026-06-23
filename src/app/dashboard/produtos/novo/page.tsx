"use client";

import { useState } from "react";
import { ArrowLeft, Save, Tag, Barcode, DollarSign, Package, FileText, MapPin, Layers3 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createProduct, createProductVariant } from "@/lib/api";
import { ErrorBanner, FieldLabel } from "@/components/ui";

const VARIANT_SIZES = ["P", "M", "G", "GG", "G1", "G2", "G3"];

function splitVariants(value: string) {
  return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

const SIZE_CODES: Record<string, string> = {
  P: "01", M: "02", G: "03", GG: "04", G1: "05", G2: "06", G3: "07",
};

function stableNumericCode(value: string, length: number) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  let hash = 0;
  for (const char of normalized) hash = (hash * 31 + char.charCodeAt(0)) % (10 ** length);
  return String(hash || 1).padStart(length, "0");
}

function numericBaseCode(base: string) {
  const digits = base.replace(/\D/g, "");
  return digits || stableNumericCode(base, 8);
}

function variantCode(base: string, index: number, color?: string, size?: string) {
  const baseDigits = numericBaseCode(base);
  const sequence = String(index + 1).padStart(2, "0");
  const colorCode = color ? stableNumericCode(color, 3) : "000";
  const sizeCode = size ? (SIZE_CODES[size.toUpperCase()] || stableNumericCode(size, 2)) : "00";
  return `${baseDigits}${sequence}${colorCode}${sizeCode}`.slice(0, 32);
}

export default function NovoProdutoPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantsEnabled, setVariantsEnabled] = useState(false);
  const [variantColors, setVariantColors] = useState("");
  const [variantSizes, setVariantSizes] = useState<string[]>([]);

  const [form, setForm] = useState({
    name: "",
    barcode: "",
    sku: "",
    internal_code: "",
    category: "",
    subcategory: "",
    brand: "",
    unit_measure: "UN",
    weight: "",
    volume: "",
    current_cost: "",
    selling_price: "",
    minimum_stock: "1",
    maximum_stock: "",
    current_stock: "0",
    physical_location: "",
    ncm: "",
    cfop: "",
    cest: "",
    active: true,
    track_lots: false,
    track_expiry: false,
    photo_base64: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(prev => ({ ...prev, photo_base64: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const variantCombinations = (() => {
    if (!variantsEnabled) return [];
    const colors = splitVariants(variantColors);
    if (!colors.length && !variantSizes.length) return [];
    if (!colors.length) return variantSizes.map((size) => ({ color: "", size }));
    if (!variantSizes.length) return colors.map((color) => ({ color, size: "" }));
    return colors.flatMap((color) => variantSizes.map((size) => ({ color, size })));
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.selling_price) {
      setError("O nome do produto e o preço de venda são obrigatórios.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const product = await createProduct({
        parent_product_id: null,
        variant_color: null,
        variant_size: null,
        variant_label: null,
        primary_barcode: form.barcode.trim() || form.sku.trim() || form.internal_code.trim() || null,
        name: form.name.trim(),
        barcode: form.barcode.trim() || null,
        sku: form.sku.trim() || null,
        internal_code: form.internal_code.trim() || null,
        category: form.category.trim() || null,
        subcategory: form.subcategory.trim() || null,
        brand: form.brand.trim() || null,
        unit_measure: form.unit_measure,
        weight: form.weight ? Number(form.weight) : null,
        volume: form.volume ? Number(form.volume) : null,
        current_cost: form.current_cost ? Number(form.current_cost) : 0,
        average_cost: form.current_cost ? Number(form.current_cost) : 0,
        selling_price: Number(form.selling_price),
        minimum_stock: Number(form.minimum_stock) || 0,
        maximum_stock: Number(form.maximum_stock) || 0,
        physical_location: form.physical_location.trim() || null,
        ncm: form.ncm.trim() || null,
        cfop: form.cfop.trim() || null,
        cest: form.cest.trim() || null,
        active: form.active,
        has_variants: variantCombinations.length > 0,
        track_lots: form.track_lots || form.track_expiry,
        track_expiry: form.track_expiry,
        current_stock: variantCombinations.length ? 0 : Number(form.current_stock) || 0,
      });

      if (variantCombinations.length) {
        const baseCode = form.barcode.trim() || form.sku.trim() || form.internal_code.trim() || product.id.slice(0, 8);
        await Promise.all(variantCombinations.map((variant, index) => {
          const code = variantCode(baseCode, index, variant.color, variant.size);
          return createProductVariant({
            product_id: product.id,
            code,
            barcode: null,
            sku: null,
            color: variant.color || null,
            size: variant.size || null,
            label: [variant.color, variant.size].filter(Boolean).join(" / ") || `Variação ${index + 1}`,
            current_stock: 0,
            minimum_stock: Number(form.minimum_stock) || 0,
            maximum_stock: Number(form.maximum_stock) || 0,
            current_cost: form.current_cost ? Number(form.current_cost) : 0,
            selling_price: Number(form.selling_price),
            physical_location: form.physical_location.trim() || null,
            active: form.active,
            sort_order: index,
          });
        }));
      }

      if (form.photo_base64) {
        try {
          const { supabase } = await import("@/lib/supabase");
          const res = await fetch(form.photo_base64);
          const blob = await res.blob();
          await supabase.storage.from("product-photos").upload(`${product.id}.jpg`, blob, {
            contentType: "image/jpeg",
            upsert: true
          });
          const photo_url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-photos/${product.id}.jpg?t=${Date.now()}`;
          await supabase.from("products").update({ photo_url }).eq("id", product.id);
        } catch (err) {
          console.error("Failed to upload photo", err);
        }
      }

      router.push("/dashboard/produtos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar o produto.");
      setSaving(false);
    }
  };

  const margin = (Number(form.selling_price) && Number(form.current_cost))
    ? (((Number(form.selling_price) - Number(form.current_cost)) / Number(form.selling_price)) * 100).toFixed(1)
    : "0.0";

  return (
    <form onSubmit={submit} className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/produtos" className="icon-btn bg-white" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Novo Produto</h1>
            <p className="text-sm text-slate-500">Cadastre um novo item no estoque</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/produtos" className="btn btn-secondary">Cancelar</Link>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar Produto"}
          </button>
        </div>
      </header>

      <ErrorBanner message={error} />

      <div className="grid gap-6 lg:grid-cols-3 mt-6">
        
        {/* Coluna Principal */}
        <div className="lg:col-span-2 space-y-6">
          <section className="card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-slate-800"><Tag className="w-5 h-5 text-blue-500" /> Informações Básicas</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel>Nome do Produto *</FieldLabel>
                <input required type="text" name="name" value={form.name} onChange={handleChange} className="field" placeholder="Ex: Whey Protein Concentrado 900g" autoFocus />
              </div>
              <div>
                <FieldLabel>Marca</FieldLabel>
                <input type="text" name="brand" value={form.brand} onChange={handleChange} className="field" placeholder="Ex: Max Titanium" />
              </div>
              <div>
                <FieldLabel>Categoria</FieldLabel>
                <input type="text" name="category" value={form.category} onChange={handleChange} className="field" placeholder="Ex: Suplementos" />
              </div>
              <div className="sm:col-span-2 mt-2">
                <FieldLabel>Foto do Produto</FieldLabel>
                <div className="mt-2 flex items-center gap-4">
                  {form.photo_base64 ? (
                    <img src={form.photo_base64} alt="Preview" className="w-20 h-20 object-cover rounded-xl border-2 border-slate-200" />
                  ) : (
                    <div className="w-20 h-20 bg-slate-100 rounded-xl border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400">
                      <Tag className="w-6 h-6" />
                    </div>
                  )}
                  <div className="flex-1">
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
                    <p className="mt-1 text-xs text-slate-400">Recomendado: 500x500px, fundo branco.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-slate-800"><Barcode className="w-5 h-5 text-blue-500" /> Códigos e Identificação</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel>Cód. Barras (EAN)</FieldLabel>
                <input type="text" name="barcode" value={form.barcode} onChange={handleChange} className="field font-mono text-sm" placeholder="Ex: 7891234567890" />
              </div>
              <div>
                <FieldLabel>SKU</FieldLabel>
                <input type="text" name="sku" value={form.sku} onChange={handleChange} className="field font-mono text-sm" placeholder="Ex: WHEY-MAX-900-MOR" />
              </div>
              <div>
                <FieldLabel>Cód. Interno</FieldLabel>
                <input type="text" name="internal_code" value={form.internal_code} onChange={handleChange} className="field font-mono text-sm" placeholder="Ex: 00125" />
              </div>
            </div>
          </section>

          <section className="card p-6">
            <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800"><Layers3 className="w-5 h-5 text-blue-500" /> Variantes do mesmo produto</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">Crie cores, tamanhos ou sabores vinculados ao produto principal. O codigo principal vira a base das variantes.</p>
              </div>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">
                <input type="checkbox" checked={variantsEnabled} onChange={(event) => setVariantsEnabled(event.target.checked)} className="h-4 w-4" />
                Tem variantes
              </label>
            </div>

            {variantsEnabled && (
              <div className="grid gap-4">
                <div>
                  <FieldLabel>Cores, sabores ou tipos</FieldLabel>
                  <input className="field" value={variantColors} onChange={(event) => setVariantColors(event.target.value)} placeholder="Ex: Branca, Preta, Verde ou Morango, Chocolate" />
                  <p className="mt-1 text-[11px] text-slate-400">Separe por virgula. Para produto com apenas tamanho, deixe este campo vazio.</p>
                </div>
                <div>
                  <FieldLabel>Tamanhos / numeracao</FieldLabel>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {VARIANT_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setVariantSizes((current) => current.includes(size) ? current.filter((item) => item !== size) : [...current, size])}
                        className={`rounded-xl border px-4 py-2 text-xs font-black transition ${variantSizes.includes(size) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:border-blue-200"}`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                  <strong>{variantCombinations.length} variante(s) serao criadas</strong>
                  <p className="mt-1 text-xs leading-5 text-blue-700">
                    Exemplo numérico: {variantCode(form.barcode || form.sku || form.internal_code || "PRODUTO", 0, variantCombinations[0]?.color, variantCombinations[0]?.size)}. A sequência identifica a variante sem gravar cor ou tamanho por extenso.
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-slate-800"><FileText className="w-5 h-5 text-orange-500" /> Rastreabilidade</h2>
            <div className="grid gap-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
                <input type="checkbox" checked={form.track_lots} onChange={(event) => setForm((current) => ({ ...current, track_lots: event.target.checked }))} className="mt-0.5 h-4 w-4" />
                <span><strong className="block text-sm text-slate-800">Controlar lote</strong><small className="mt-1 block text-xs text-slate-500">Recomendado para alimentos, suplementos, cosméticos e itens com rastreabilidade.</small></span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
                <input type="checkbox" checked={form.track_expiry} onChange={(event) => setForm((current) => ({ ...current, track_expiry: event.target.checked, track_lots: event.target.checked || current.track_lots }))} className="mt-0.5 h-4 w-4" />
                <span><strong className="block text-sm text-slate-800">Controlar validade</strong><small className="mt-1 block text-xs text-slate-500">Exige validade no recebimento e prepara o estoque para FEFO: vence primeiro, sai primeiro.</small></span>
              </label>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-slate-800"><DollarSign className="w-5 h-5 text-emerald-500" /> Preço e Custos</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel>Custo Atual (R$)</FieldLabel>
                <input type="number" step="0.01" name="current_cost" value={form.current_cost} onChange={handleChange} className="field" placeholder="0.00" />
              </div>
              <div>
                <FieldLabel>Preço de Venda (R$) *</FieldLabel>
                <input required type="number" step="0.01" name="selling_price" value={form.selling_price} onChange={handleChange} className="field" placeholder="0.00" />
              </div>
              <div>
                <FieldLabel>Margem Bruta</FieldLabel>
                <div className={`flex h-10 items-center justify-center rounded-xl border border-dashed text-sm font-bold ${Number(margin) >= 30 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : Number(margin) >= 10 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                  {margin}%
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Coluna Lateral */}
        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-slate-800"><Package className="w-5 h-5 text-indigo-500" /> Estoque</h2>
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Unidade</FieldLabel>
                  <select name="unit_measure" value={form.unit_measure} onChange={handleChange} className="field">
                    <option value="UN">Unidade (UN)</option>
                    <option value="KG">Quilo (KG)</option>
                    <option value="CX">Caixa (CX)</option>
                    <option value="PCT">Pacote (PCT)</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Estoque Atual</FieldLabel>
                  <input type="number" name="current_stock" value={form.current_stock} onChange={handleChange} className="field font-bold text-blue-600" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Estoque Mínimo</FieldLabel>
                  <input type="number" name="minimum_stock" value={form.minimum_stock} onChange={handleChange} className="field" />
                </div>
                <div>
                  <FieldLabel>Estoque Máximo</FieldLabel>
                  <input type="number" name="maximum_stock" value={form.maximum_stock} onChange={handleChange} className="field" />
                </div>
              </div>
              <div>
                <FieldLabel>Localização Física</FieldLabel>
                <input type="text" name="physical_location" value={form.physical_location} onChange={handleChange} className="field" placeholder="Ex: Prateleira A2" />
              </div>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-slate-800"><FileText className="w-5 h-5 text-orange-500" /> Fiscal</h2>
            <div className="grid gap-4">
              <div>
                <FieldLabel>NCM</FieldLabel>
                <input type="text" name="ncm" value={form.ncm} onChange={handleChange} className="field font-mono text-sm" placeholder="Ex: 2106.90.30" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>CFOP Padrão</FieldLabel>
                  <input type="text" name="cfop" value={form.cfop} onChange={handleChange} className="field font-mono text-sm" placeholder="Ex: 5102" />
                </div>
                <div>
                  <FieldLabel>CEST</FieldLabel>
                  <input type="text" name="cest" value={form.cest} onChange={handleChange} className="field font-mono text-sm" />
                </div>
              </div>
            </div>
          </section>

          <section className="card p-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" name="active" checked={form.active} onChange={handleChange} className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <span className="font-bold text-slate-800">Produto Ativo</span>
            </label>
            <p className="text-xs text-slate-500 mt-2 ml-8">Produtos inativos não aparecem no PDV para venda.</p>
          </section>

        </div>
      </div>
    </form>
  );
}
