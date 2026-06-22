import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import type { Product } from "@/src/api";

const CART_STORAGE_KEY = "cart_items_v1";
const GUEST_ID_KEY = "guest_id_v1";
const PROMO_STORAGE_KEY = "cart_promo_v1";

export type CartLine = {
  product: Product;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
};

type CartItemPersist = CartLine;

type PromoState = { code: string; discount: number; kind?: string | null };

type CartContextValue = {
  items: CartLine[];
  guestId: string;
  count: number;
  subtotal: number;
  discount: number;
  total: number;
  promoCode: string | null;
  promoError: string | null;
  promoValidating: boolean;
  applyPromo: (code: string) => Promise<boolean>;
  clearPromo: () => void;
  addItem: (product: Product, variantLabel: string, unitPrice: number, qty?: number) => void;
  setQuantity: (lineKey: string, qty: number) => void;
  removeItem: (lineKey: string) => void;
  clear: () => void;
  ready: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);

function genGuestId(): string {
  return (
    "g_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

function lineKey(productId: string, variantLabel: string): string {
  return `${productId}::${variantLabel}`;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [guestId, setGuestId] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [promo, setPromo] = useState<PromoState | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoValidating, setPromoValidating] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = (await storage.getItem(CART_STORAGE_KEY, "")) as string;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as CartItemPersist[];
          if (Array.isArray(parsed)) {
            setItems(parsed.filter((l) => l && l.variantLabel && typeof l.unitPrice === "number"));
          }
        } catch { /* ignore */ }
      }
      const promoRaw = (await storage.getItem(PROMO_STORAGE_KEY, "")) as string;
      if (promoRaw) {
        try {
          const parsed = JSON.parse(promoRaw) as PromoState;
          if (parsed && parsed.code) setPromo(parsed);
        } catch { /* ignore */ }
      }
      let gid = (await storage.getItem(GUEST_ID_KEY, "")) as string;
      if (!gid) {
        gid = genGuestId();
        await storage.setItem(GUEST_ID_KEY, gid);
      }
      setGuestId(gid);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    storage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items, ready]);

  useEffect(() => {
    if (!ready) return;
    if (promo) {
      storage.setItem(PROMO_STORAGE_KEY, JSON.stringify(promo));
    } else {
      storage.removeItem(PROMO_STORAGE_KEY);
    }
  }, [promo, ready]);

  const addItem = useCallback(
    (product: Product, variantLabel: string, unitPrice: number, qty: number = 1) => {
      setItems((prev) => {
        const key = lineKey(product.id, variantLabel);
        const idx = prev.findIndex((l) => lineKey(l.product.id, l.variantLabel) === key);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
          return next;
        }
        return [...prev, { product, variantLabel, unitPrice, quantity: qty }];
      });
    },
    [],
  );

  const setQuantity = useCallback((key: string, qty: number) => {
    setItems((prev) => {
      if (qty <= 0) return prev.filter((l) => lineKey(l.product.id, l.variantLabel) !== key);
      return prev.map((l) =>
        lineKey(l.product.id, l.variantLabel) === key ? { ...l, quantity: qty } : l,
      );
    });
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((l) => lineKey(l.product.id, l.variantLabel) !== key));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setPromo(null);
    setPromoError(null);
  }, []);

  const { count, subtotal } = useMemo(() => {
    const c = items.reduce((acc, l) => acc + l.quantity, 0);
    const s = items.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
    return { count: c, subtotal: Math.round(s * 100) / 100 };
  }, [items]);

  // Re-validate promo whenever subtotal changes so the displayed discount stays in sync
  useEffect(() => {
    if (!promo || !ready) return;
    let aborted = false;
    (async () => {
      try {
        const res = await api.validatePromo(promo.code, subtotal);
        if (aborted) return;
        if (!res.valid) {
          setPromo(null);
          setPromoError(res.error || "Code non valide pour ce panier.");
        } else {
          setPromo({ code: res.code || promo.code, discount: res.discount, kind: res.kind });
          setPromoError(null);
        }
      } catch {
        // silent
      }
    })();
    return () => { aborted = true; };
  }, [subtotal, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const discount = useMemo(() => {
    if (!promo) return 0;
    return Math.min(promo.discount, subtotal);
  }, [promo, subtotal]);

  const total = useMemo(
    () => Math.round(Math.max(0, subtotal - discount) * 100) / 100,
    [subtotal, discount],
  );

  const applyPromo = useCallback(
    async (code: string): Promise<boolean> => {
      const clean = code.trim().toUpperCase();
      if (!clean) {
        setPromoError("Veuillez saisir un code.");
        return false;
      }
      setPromoValidating(true);
      setPromoError(null);
      try {
        const res = await api.validatePromo(clean, subtotal);
        if (!res.valid) {
          setPromoError(res.error || "Code invalide.");
          setPromo(null);
          return false;
        }
        setPromo({ code: res.code || clean, discount: res.discount, kind: res.kind });
        return true;
      } catch (e: any) {
        setPromoError(e?.message || "Erreur lors de la validation.");
        return false;
      } finally {
        setPromoValidating(false);
      }
    },
    [subtotal],
  );

  const clearPromo = useCallback(() => {
    setPromo(null);
    setPromoError(null);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      guestId,
      count,
      subtotal,
      discount,
      total,
      promoCode: promo?.code ?? null,
      promoError,
      promoValidating,
      applyPromo,
      clearPromo,
      addItem,
      setQuantity,
      removeItem,
      clear,
      ready,
    }),
    [
      items, guestId, count, subtotal, discount, total,
      promo, promoError, promoValidating, applyPromo, clearPromo,
      addItem, setQuantity, removeItem, clear, ready,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export { lineKey };

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

export function formatPrice(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}
