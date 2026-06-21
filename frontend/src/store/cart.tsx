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
  quantity: number;
};

type CartItemPersist = { product: Product; quantity: number };

type CartContextValue = {
  items: CartLine[];
  guestId: string;
  count: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  addItem: (product: Product, qty?: number) => void;
  setQuantity: (productId: string, qty: number) => void;
  removeItem: (productId: string) => void;
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

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [guestId, setGuestId] = useState<string>("");
  const [ready, setReady] = useState(false);

  // Hydrate from storage
  useEffect(() => {
    (async () => {
      const raw = (await storage.getItem(CART_STORAGE_KEY, "")) as string;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as CartItemPersist[];
          if (Array.isArray(parsed)) setItems(parsed);
        } catch {
          // ignore
        }
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

  // Persist on change
  useEffect(() => {
    if (!ready) return;
    storage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items, ready]);

  const addItem = useCallback((product: Product, qty: number = 1) => {
    setItems((prev) => {
      const idx = prev.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return next;
      }
      return [...prev, { product, quantity: qty }];
    });
  }, []);

  const setQuantity = useCallback((productId: string, qty: number) => {
    setItems((prev) => {
      if (qty <= 0) return prev.filter((l) => l.product.id !== productId);
      return prev.map((l) =>
        l.product.id === productId ? { ...l, quantity: qty } : l,
      );
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((l) => l.product.id !== productId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const { count, subtotal, deliveryFee, total } = useMemo(() => {
    const count = items.reduce((acc, l) => acc + l.quantity, 0);
    const subtotal = items.reduce(
      (acc, l) => acc + l.product.price * l.quantity,
      0,
    );
    const deliveryFee = subtotal === 0 ? 0 : subtotal >= 30 ? 0 : 2.99;
    const total = Math.round((subtotal + deliveryFee) * 100) / 100;
    return { count, subtotal: Math.round(subtotal * 100) / 100, deliveryFee, total };
  }, [items]);

  const value = useMemo(
    () => ({
      items,
      guestId,
      count,
      subtotal,
      deliveryFee,
      total,
      addItem,
      setQuantity,
      removeItem,
      clear,
      ready,
    }),
    [items, guestId, count, subtotal, deliveryFee, total, addItem, setQuantity, removeItem, clear, ready],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

export function formatPrice(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}
