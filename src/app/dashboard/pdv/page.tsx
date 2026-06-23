"use client";

import React, { useEffect, useState, useRef } from "react";
import { Search, ShoppingCart, Plus, Minus, Trash2, CreditCard, Banknote, QrCode, CheckCircle, Package, ScanLine, ArrowRight } from "lucide-react";
import { getProducts, expandProductsWithVariants, createSale, createSaleItem, updateProduct, updateProductVariant, createInventoryTransaction, createPixSale } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { ErrorBanner, Modal } from "@/components/ui";
import { useDeviceSelector } from "@/components/device-selector";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";

interface CartItem extends Product {
  cart_quantity: number;
}

export default function PdvPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "credit_card" | "debit_card" | "cash">("pix");
  const [processing, setProcessing] = useState(false);
  const [saleCompleted, setSaleCompleted] = useState(false);
  const [pixSale, setPixSale] = useState<any>(null);
  
  const [lastScanned, setLastScanned] = useState<Product | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const { selectDevice, DeviceSelectorModal } = useDeviceSelector();

  const loadProducts = () => {
    getProducts()
      .then(prods => setProducts(expandProductsWithVariants(prods).filter(p => p.active)))
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadProducts(); }, []);
  useRealtimeSync(loadProducts);

  // Barcode scanner listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If we are in an input, don't intercept unless it's the search input specifically
      if (document.activeElement?.tagName === 'INPUT' && document.activeElement !== searchInputRef.current) return;
      
      if (e.key === 'Enter' && search.trim()) {
        e.preventDefault();
        const barcode = search.trim();
        const product = products.find(p => p.barcode === barcode || p.sku === barcode || p.internal_code === barcode);
        
        if (product) {
          addToCart(product);
          setSearch("");
          setLastScanned(product);
        } else {
          // Keep search for manual lookups
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [search, products]);

  // Keep focus on input unless clicking somewhere else
  useEffect(() => {
    const interval = setInterval(() => {
      if (!checkoutModalOpen && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'BUTTON') {
        searchInputRef.current?.focus();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [checkoutModalOpen]);

  const addToCart = (product: Product) => {
    if (product.current_stock <= 0) {
      setError(`O produto ${product.name} está sem estoque.`);
      return;
    }
    
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) {
        if (existing.cart_quantity >= product.current_stock) {
          setError(`Estoque insuficiente para ${product.name}. Máximo: ${product.current_stock}`);
          return prev;
        }
        setError(null);
        return prev.map(i => i.id === product.id ? { ...i, cart_quantity: i.cart_quantity + 1 } : i);
      }
      setError(null);
      return [{ ...product, cart_quantity: 1 }, ...prev]; // Adiciona no topo como no supermercado
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.id === id) {
        const newQty = i.cart_quantity + delta;
        if (newQty > i.current_stock) {
          setError(`Estoque insuficiente. Máximo: ${i.current_stock}`);
          return i;
        }
        if (newQty < 1) return i;
        setError(null);
        return { ...i, cart_quantity: newQty };
      }
      return i;
    }));
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
    setError(null);
  };

  const generatePix = async () => {
    if (cart.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      const totalAmount = cart.reduce((sum, item) => sum + (item.selling_price * item.cart_quantity), 0);
      const sale = await createSale({
        student_id: null,
        payment_method: "pix",
        total_amount: totalAmount,
        discount: 0,
        final_amount: totalAmount,
        status: "pending"
      });
      const pix = await createPixSale(sale.id);
      setPixSale(pix);

      const targetDeviceId = await selectDevice();
      if (targetDeviceId !== null) {
        let channel = supabase.getChannels().find((c: any) => c.topic === `realtime:pos-terminal-channel`);
        if (!channel) channel = supabase.channel("pos-terminal-channel");
        
        const sendSignal = () => {
          channel.send({ type: "broadcast", event: "SHOW_PIX_SALE", payload: { sale_id: sale.id, pix_qr_base64: (pix as any).pix_qr_base64, pix_code: (pix as any).pix_code, total_amount: sale.total_amount, targetDeviceId } });
        };
        
        if (channel.state === "joined") {
          sendSignal();
        } else {
          channel.subscribe((status: string) => {
            if (status === "SUBSCRIBED") {
              sendSignal();
            }
          });
        }
      }
      
      // Setup polling for status
      const poll = setInterval(async () => {
        try {
          const { data } = await supabase.from('sales').select('status').eq('id', sale.id).single();
          if (data && data.status === 'completed') {
            clearInterval(poll);
            await finalizeSale(sale);
          }
        } catch(err){}
      }, 3000);
      
    } catch (err: any) {
      setError(err.message || "Erro ao gerar PIX.");
    } finally {
      setProcessing(false);
    }
  };

  const finalizeSale = async (existingSale: any = null) => {
    if (cart.length === 0) return;
    setProcessing(true);
    setError(null);

    try {
      const totalAmount = cart.reduce((sum, item) => sum + (item.selling_price * item.cart_quantity), 0);
      
      let sale = existingSale || pixSale;
      if (!sale) {
        sale = await createSale({
          student_id: null,
          payment_method: paymentMethod,
          total_amount: totalAmount,
          discount: 0,
          final_amount: totalAmount,
          status: "completed"
        });
      } else if (sale.status !== "completed") {
        await supabase.from('sales').update({ status: 'completed' }).eq('id', sale.id);
      }

      for (const item of cart) {
        await createSaleItem({
          sale_id: sale.id,
          product_id: item.parent_product_id || item.id,
          variant_id: item.parent_product_id ? item.id : null,
          batch_id: null,
          quantity: item.cart_quantity,
          unit_price: item.selling_price,
          total_price: item.selling_price * item.cart_quantity
        });

        const newStock = item.current_stock - item.cart_quantity;
        if (item.parent_product_id) {
          await updateProductVariant(item.id, { current_stock: newStock });
        } else {
          await updateProduct(item.id, { current_stock: newStock });
        }
        
        await createInventoryTransaction({
          product_id: item.parent_product_id || item.id,
          variant_id: item.parent_product_id ? item.id : null,
          batch_id: null,
          transaction_type: "OUT",
          quantity: item.cart_quantity,
          previous_stock: item.current_stock,
          new_stock: newStock,
          reason: `Venda PDV #${sale.id}`,
          reference_id: sale.id
        });
      }
      setSaleCompleted(true);
      
      // Notify mobile terminal immediately
      let channel = supabase.getChannels().find((c: any) => c.topic === `realtime:pos-terminal-channel`);
      if (channel) {
        channel.send({ type: "broadcast", event: "SALE_APPROVED", payload: { sale_id: sale.id } });
      }
      
      // Update local products state with new stock values so we don't have stale limits for the next sale
      setProducts(prev => prev.map(p => {
        const cartItem = cart.find(c => c.id === p.id);
        if (cartItem) {
          return { ...p, current_stock: p.current_stock - cartItem.cart_quantity };
        }
        return p;
      }));

      setTimeout(() => {
        setCart([]);
        setCheckoutModalOpen(false);
        setSaleCompleted(false);
        setPixSale(null);
        setSearch("");
        setLastScanned(null);
      }, 3000);
      
    } catch (err) {
      setError("Erro ao processar a venda.");
    } finally {
      setProcessing(false);
    }
  };

  const handleCheckout = async () => {
    if (paymentMethod === "pix" && !pixSale) {
       await generatePix();
    } else {
       await finalizeSale();
    }
  };

  const searchQuery = search.trim().toLowerCase();
  const filteredProducts = searchQuery.length >= 2 
    ? products.filter(p => 
        p.name.toLowerCase().includes(searchQuery) || 
        p.barcode?.toLowerCase().includes(searchQuery) || 
        p.sku?.toLowerCase().includes(searchQuery) ||
        p.internal_code?.toLowerCase().includes(searchQuery)
      )
    : [];

  const cartTotal = cart.reduce((sum, item) => sum + (item.selling_price * item.cart_quantity), 0);
  const cartItemsCount = cart.reduce((sum, item) => sum + item.cart_quantity, 0);

  if (loading) return <div className="p-8 text-center text-slate-500">Iniciando Caixa...</div>;

  return (
    <div className="flex flex-col lg:flex-row h-full w-full bg-slate-100 overflow-hidden">
      
      {/* Lado Esquerdo - Scanner e Busca */}
      <div className="flex-1 flex flex-col p-4 md:p-8 min-w-0 bg-slate-50 border-r border-slate-200">
        
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Caixa Aberto</h1>
            <p className="text-sm text-slate-500 font-medium mt-1">Ponto de Venda • Operador Padrão</p>
          </div>
          <div className="bg-emerald-50 text-emerald-600 text-xs px-3 py-1.5 rounded-md font-bold flex items-center gap-2 border border-emerald-100">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
            Online
          </div>
        </header>

        {/* Input de Scanner Elegante */}
        <div className="relative mb-6 shadow-sm">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <ScanLine className="h-5 w-5 text-blue-500" />
          </div>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="block w-full pl-12 pr-12 py-4 border border-slate-200 rounded-xl text-lg font-semibold bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-slate-900 shadow-sm"
            placeholder="Bipe ou digite o código do produto..."
            autoFocus
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600">
              <span className="bg-slate-100 text-[10px] font-bold px-2 py-0.5 rounded text-slate-500">ESC</span>
            </button>
          )}
        </div>

        <ErrorBanner message={error} />

        {/* Exibição do Produto Atual (Supermercado style) */}
        {lastScanned && !search && cart.length > 0 && (
          <div className="card p-6 bg-blue-600 text-white border-0 shadow-lg shadow-blue-900/10 flex items-center gap-6 mb-6 animate-in slide-in-from-bottom-4">
            <div className="w-24 h-24 rounded-xl bg-white p-1.5 shrink-0 shadow-sm">
              {lastScanned.photo_url ? (
                <img src={lastScanned.photo_url} className="w-full h-full object-cover rounded-lg" />
              ) : (
                <div className="w-full h-full bg-slate-50 rounded-lg flex items-center justify-center">
                  <Package className="w-8 h-8 text-slate-300" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-black truncate mb-1">{lastScanned.name}</h2>
              <p className="text-blue-200 font-mono text-sm mb-3">{lastScanned.barcode || lastScanned.sku}</p>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-blue-200 text-xs font-bold uppercase tracking-wider mb-0.5">Valor Unitário</div>
                  <div className="text-3xl font-black">{formatCurrency(lastScanned.selling_price)}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Resultados da Busca Manual */}
        <div className="flex-1 overflow-y-auto pb-4">
          {search.length >= 2 && filteredProducts.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <Search className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-lg">Produto não encontrado</p>
            </div>
          )}

          {search.length >= 2 && filteredProducts.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    addToCart(p);
                    setSearch("");
                    setLastScanned(p);
                    searchInputRef.current?.focus();
                  }}
                  className="bg-white p-4 rounded-2xl border-2 border-transparent hover:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 transition text-left group shadow-sm flex flex-col h-full"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
                      {p.photo_url ? (
                        <img src={p.photo_url} className="w-full h-full object-cover" alt={p.name} />
                      ) : (
                        <Package className="w-6 h-6 text-slate-300" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-base leading-tight mb-1 line-clamp-2 group-hover:text-blue-600 transition-colors">{p.name}</h3>
                      <p className="text-xs text-slate-400 font-mono">{p.barcode || p.sku}</p>
                    </div>
                  </div>
                  <div className="flex items-end justify-between mt-auto">
                    <span className="font-black text-xl text-slate-900">{formatCurrency(p.selling_price)}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${p.current_stock > 0 ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-600'}`}>
                      {p.current_stock} un.
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lado Direito - Cupom Fiscal Full Height */}
      <div className="w-full lg:w-[450px] xl:w-[500px] flex flex-col bg-white shadow-2xl shrink-0 h-full border-l border-slate-200 relative z-10">
        
        <div className="bg-slate-900 p-6 flex items-center justify-between shadow-md z-20 shrink-0">
          <div className="flex items-center gap-3 text-white">
            <ShoppingCart className="w-7 h-7 text-blue-400" />
            <h2 className="text-2xl font-black tracking-tight">Cupom Fiscal</h2>
          </div>
          <div className="bg-slate-800 text-blue-300 text-sm font-black px-3 py-1.5 rounded-lg border border-slate-700">
            {cartItemsCount} UN
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-slate-50 relative">
          {cart.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300">
              <ShoppingCart className="w-24 h-24 mb-6 opacity-50" />
              <p className="font-bold text-xl text-slate-400">Caixa Livre</p>
              <p className="text-slate-500 mt-2 text-center max-w-[250px]">Passe o produto no leitor para iniciar a venda.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((item, index) => (
                <div key={item.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-start gap-4 animate-in fade-in slide-in-from-right-4">
                  <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 overflow-hidden relative shadow-sm">
                    {item.photo_url ? (
                      <img src={item.photo_url} className="w-full h-full object-cover" alt={item.name} />
                    ) : (
                      <Package className="w-5 h-5 text-slate-300" />
                    )}
                    <div className="absolute -top-2 -right-2 w-5 h-5 bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center rounded-full shadow">
                      {cart.length - index}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base font-bold text-slate-900 leading-tight mb-1">{item.name}</h4>
                    <div className="text-sm text-slate-500 font-mono mb-3">{formatCurrency(item.selling_price)} un.</div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                        <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 flex items-center justify-center rounded bg-white shadow-sm text-slate-700 hover:text-blue-600 transition"><Minus className="w-4 h-4" /></button>
                        <span className="w-10 text-center font-black text-base text-slate-900">{item.cart_quantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 flex items-center justify-center rounded bg-white shadow-sm text-slate-700 hover:text-blue-600 transition"><Plus className="w-4 h-4" /></button>
                      </div>
                      <span className="font-black text-xl text-slate-900">
                        {formatCurrency(item.selling_price * item.cart_quantity)}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => removeFromCart(item.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition shrink-0">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-6 md:p-8 shrink-0 shadow-[0_-15px_40px_-15px_rgba(0,0,0,0.1)] z-20">
          <div className="flex justify-between items-end mb-6">
            <span className="text-slate-500 font-black uppercase tracking-wider">Total</span>
            <span className="text-5xl font-black tracking-tighter text-blue-600 leading-none">{formatCurrency(cartTotal)}</span>
          </div>
          
          <button 
            onClick={() => setCheckoutModalOpen(true)}
            disabled={cart.length === 0}
            className="w-full flex items-center justify-center gap-3 py-6 rounded-2xl shadow-xl shadow-blue-600/30 text-2xl font-black text-white bg-blue-600 hover:bg-blue-700 hover:scale-[1.02] focus:outline-none focus:ring-4 focus:ring-blue-500/50 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed transition-all"
          >
            PAGAR <ArrowRight className="w-8 h-8" />
          </button>
        </div>
      </div>

      <Modal open={checkoutModalOpen} onClose={() => {if (!processing && !saleCompleted) setCheckoutModalOpen(false)}} title="Pagamento" size="md">
        {saleCompleted ? (
          <div className="py-12 text-center animate-in zoom-in fade-in duration-300">
            <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-12 h-12" />
            </div>
            <h2 className="text-4xl font-black text-slate-900 mb-2">Venda Concluída!</h2>
            <p className="text-slate-500 text-xl font-medium">O estoque foi atualizado com sucesso.</p>
            <p className="text-sm font-bold text-slate-400 mt-8 animate-pulse">Preparando próximo caixa...</p>
          </div>
        ) : (
          <div className="py-4">
            <div className="text-center mb-8 bg-slate-50 p-6 rounded-3xl">
              <p className="text-slate-500 font-black uppercase tracking-widest text-sm mb-2">Total a Pagar</p>
              <div className="text-6xl font-black tracking-tighter text-slate-900">{formatCurrency(cartTotal)}</div>
            </div>

            <div className="space-y-4">
              <h3 className="font-bold text-slate-400 uppercase tracking-wider text-sm mb-4">Selecione a Forma</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("pix")}
                  className={`flex flex-col items-center justify-center p-6 rounded-2xl border-4 transition ${paymentMethod === 'pix' ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-lg shadow-blue-500/20' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <QrCode className="w-10 h-10 mb-3" />
                  <span className="font-black text-lg">PIX</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("credit_card")}
                  className={`flex flex-col items-center justify-center p-6 rounded-2xl border-4 transition ${paymentMethod === 'credit_card' ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-lg shadow-blue-500/20' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <CreditCard className="w-10 h-10 mb-3" />
                  <span className="font-black text-lg">Crédito</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("debit_card")}
                  className={`flex flex-col items-center justify-center p-6 rounded-2xl border-4 transition ${paymentMethod === 'debit_card' ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-lg shadow-blue-500/20' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <CreditCard className="w-10 h-10 mb-3" />
                  <span className="font-black text-lg">Débito</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("cash")}
                  className={`flex flex-col items-center justify-center p-6 rounded-2xl border-4 transition ${paymentMethod === 'cash' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-lg shadow-emerald-500/20' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <Banknote className="w-10 h-10 mb-3" />
                  <span className="font-black text-lg">Dinheiro</span>
                </button>
              </div>

              {paymentMethod === "pix" ? (
                pixSale ? (
                  <div className="bg-slate-900 rounded-2xl p-6 mt-6 text-center animate-in fade-in slide-in-from-bottom-4 shadow-2xl">
                    <h4 className="text-white font-bold mb-4">Mostre o QR Code para o Cliente</h4>
                    <div className="w-48 h-48 bg-white rounded-xl mx-auto flex items-center justify-center mb-4 p-2 relative overflow-hidden">
                      {(pixSale as any).pix_qr_base64 ? <img src={`data:image/jpeg;base64,${(pixSale as any).pix_qr_base64}`} className="w-full h-full object-contain" /> : <QrCode className="w-full h-full text-slate-900" />}
                      {processing && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>}
                    </div>
                    <p className="text-lg font-bold text-blue-400 animate-pulse">Aguardando pagamento PIX...</p>
                    <div className="mt-4 flex flex-col gap-2">
                      <button 
                        type="button" 
                        disabled={processing}
                        className="text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl transition shadow-lg w-full"
                        onClick={async () => {
                          const targetDeviceId = await selectDevice();
                          if (targetDeviceId === null) return;
                          
                          let channel = supabase.getChannels().find((c: any) => c.topic === `realtime:pos-terminal-channel`);
                          if (!channel) channel = supabase.channel("pos-terminal-channel");
                          
                          const sendSignal = () => {
                            channel.send({ type: "broadcast", event: "SHOW_PIX_SALE", payload: { sale_id: pixSale.id, pix_qr_base64: (pixSale as any).pix_qr_base64, pix_code: (pixSale as any).pix_code, total_amount: pixSale.total_amount, targetDeviceId } });
                            alert("Sinal enviado!");
                          };
                          
                          if (channel.state === "joined") {
                            sendSignal();
                          } else {
                            channel.subscribe((status: string) => {
                              if (status === "SUBSCRIBED") {
                                sendSignal();
                              }
                            });
                          }
                        }}
                      >
                        Espelhar na Máquina / Celular
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900 rounded-2xl p-6 mt-6 text-center animate-in fade-in slide-in-from-bottom-4 shadow-2xl">
                    <h4 className="text-white font-bold mb-4">Pronto para gerar o PIX</h4>
                    <p className="text-sm text-slate-400 mb-4">O QR Code será exibido e enviado para o terminal.</p>
                  </div>
                )
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 mt-6 text-center animate-in fade-in slide-in-from-bottom-4">
                  <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8" />
                  </div>
                  <h4 className="text-amber-800 font-bold mb-2">Confirmação Manual</h4>
                  <p className="text-sm text-amber-700">Por favor, passe a transação na maquininha ou receba o dinheiro físico. Somente confirme abaixo se o pagamento foi bem sucedido.</p>
                </div>
              )}
            </div>

            <div className="mt-8 flex gap-3">
              <button 
                onClick={() => { setCheckoutModalOpen(false); setPixSale(null); }} 
                className="flex-1 py-4 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
                disabled={processing}
              >
                Cancelar
              </button>
              <button 
                onClick={handleCheckout} 
                disabled={processing}
                className="flex-[2] py-4 rounded-xl font-black text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/30 flex justify-center items-center gap-2"
              >
                {processing ? "Processando..." : paymentMethod === "pix" ? (pixSale ? "Forçar Confirmação (Admin)" : "Gerar PIX e Cobrar") : "Sim, Pagamento Recebido"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <DeviceSelectorModal />
    </div>
  );
}
