import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { storage } from "@/src/utils/storage";
import type { Product } from "@/src/api";

const CART_STORAGE_KEY = "cart_items_v1";
const GUEST_ID_KEY = "guest_id_v1";

export type CartLine = {
  product: Product;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
};

type CartItemPersist = CartLine;

type CartContextValue = {
  items: CartLine[];
  guestId: string;
  count: number;
  subtotal: number;
  total: number;
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

  useEffect(() => {
    (async () => {
      const raw = (await storage.getItem(CART_STORAGE_KEY, "")) as string;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as CartItemPersist[];
          if (Array.isArray(parsed)) {
            // Filter out legacy items (pre-variants)
            setItems(parsed.filter((l) => l && l.variantLabel && typeof l.unitPrice === "number"));
          }
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

  const clear = useCallback(() => setItems([]), []);

  const { count, subtotal, total } = useMemo(() => {
    const count = items.reduce((acc, l) => acc + l.quantity, 0);
    const subtotal = items.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
    return { count, subtotal: Math.round(subtotal * 100) / 100, total: Math.round(subtotal * 100) / 100 };
  }, [items]);

  const value = useMemo(
    () => ({
      items, guestId, count, subtotal, total,
      addItem, setQuantity, removeItem, clear, ready,
    }),
    [items, guestId, count, subtotal, total, addItem, setQuantity, removeItem, clear, ready],
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
