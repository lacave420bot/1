const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export type Category = {
  id: string;
  name: string;
  icon: string;
  image: string;
  kind: "restaurant" | "grocery";
};

export type WeightVariant = { label: string; price: number };

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category_id: string;
  category_kind: "restaurant" | "grocery" | "cbd";
  unit?: string | null;
  popular?: boolean;
  promo?: boolean;
  variants?: WeightVariant[];
};

export function minVariantPrice(p: Product): number {
  if (p.variants && p.variants.length > 0) {
    return Math.min(...p.variants.map((v) => v.price));
  }
  return p.price;
}

export type OrderItem = {
  product_id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  variant_label?: string | null;
};

export type Order = {
  id: string;
  guest_id: string;
  customer_name: string;
  address: string;
  phone: string;
  notes: string;
  delivery_mode?: "delivery" | "pickup";
  items: OrderItem[];
  subtotal: number;
  delivery_fee: number;
  promo_code?: string | null;
  discount_amount: number;
  points_used: number;
  points_earned: number;
  total: number;
  status: string;
  created_at: string;
};

export type PromoCode = {
  id: string;
  code: string;
  kind: "percent" | "amount" | "amount_min";
  value: number;
  min_subtotal: number;
  max_uses: number | null;
  times_used: number;
  expires_at: string | null;
  enabled: boolean;
  created_at: string;
};

export type PromoValidateResult = {
  valid: boolean;
  code?: string | null;
  kind?: string | null;
  discount: number;
  error?: string | null;
};

export type Loyalty = {
  guest_id: string;
  points_balance: number;
  total_earned: number;
  total_spent: number;
  orders_count: number;
};

export type AdminToken = {
  access_token: string;
  token_type: string;
  expires_hours: number;
};

let adminToken: string | null = null;
export function setAdminToken(t: string | null) {
  adminToken = t;
}
export function getAdminToken(): string | null {
  return adminToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (adminToken) headers["Authorization"] = `Bearer ${adminToken}`;
  // Merge with caller-provided headers
  const callerHeaders = (init?.headers as Record<string, string>) || {};
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...init,
    headers: { ...headers, ...callerHeaders },
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      throw new Error(parsed.detail || text || `HTTP ${res.status}`);
    } catch {
      throw new Error(text || `HTTP ${res.status}`);
    }
  }
  return res.json();
}

export const api = {
  getCategories: () => request<Category[]>("/categories"),
  getProducts: (params: {
    category_id?: string;
    kind?: string;
    search?: string;
    popular?: boolean;
    promo?: boolean;
  } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") q.append(k, String(v));
    });
    const qs = q.toString();
    return request<Product[]>(`/products${qs ? `?${qs}` : ""}`);
  },
  getProduct: (id: string) => request<Product>(`/products/${id}`),
  createOrder: (body: {
    guest_id: string;
    customer_name: string;
    address: string;
    phone: string;
    notes?: string;
    delivery_mode?: "delivery" | "pickup";
    promo_code?: string | null;
    items: { product_id: string; quantity: number; variant_label?: string }[];
  }) =>
    request<Order>(`/orders`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getOrders: (guest_id: string) =>
    request<Order[]>(`/orders?guest_id=${encodeURIComponent(guest_id)}`),
  getOrder: (id: string) => request<Order>(`/orders/${id}`),
  getLoyalty: (guest_id: string) =>
    request<Loyalty>(`/loyalty/${encodeURIComponent(guest_id)}`),

  adminLogin: (pin: string) =>
    request<AdminToken>(`/admin/login`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  adminChangePin: (current_pin: string, new_pin: string) =>
    request<{ status: string }>(`/admin/change-pin`, {
      method: "POST",
      body: JSON.stringify({ current_pin, new_pin }),
    }),
  adminCreateProduct: (body: Partial<Product>) =>
    request<Product>(`/admin/products`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminUpdateProduct: (id: string, body: Partial<Product>) =>
    request<Product>(`/admin/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  adminDeleteProduct: (id: string) =>
    request<{ status: string }>(`/admin/products/${id}`, { method: "DELETE" }),
  adminCreateCategory: (body: Category) =>
    request<Category>(`/admin/categories`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminUpdateCategory: (id: string, body: Partial<Category>) =>
    request<Category>(`/admin/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  adminDeleteCategory: (id: string) =>
    request<{ status: string }>(`/admin/categories/${id}`, { method: "DELETE" }),
  adminListOrders: () => request<Order[]>(`/admin/orders`),
  adminUpdateOrderStatus: (id: string, status: string) =>
    request<Order>(`/admin/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  adminDeleteOrder: (id: string) =>
    request<{ status: string; deleted: number }>(`/admin/orders/${id}`, { method: "DELETE" }),
  adminBulkDeleteOrders: (ids: string[]) =>
    request<{ status: string; deleted: number }>(`/admin/orders/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  adminGetTelegram: () =>
    request<{ bot_token_masked: string; has_token: boolean; chat_id: string }>(
      `/admin/telegram`,
    ),
  adminSaveTelegram: (bot_token: string, chat_id: string) =>
    request<{ status: string }>(`/admin/telegram`, {
      method: "POST",
      body: JSON.stringify({ bot_token, chat_id }),
    }),
  adminDiscoverChats: () =>
    request<{ chats: { id: string; type?: string; title?: string }[] }>(
      `/admin/telegram/discover`,
      { method: "POST" },
    ),
  adminTestTelegram: () =>
    request<{ status: string }>(`/admin/telegram/test`, { method: "POST" }),

  validatePromo: (code: string, subtotal: number) =>
    request<PromoValidateResult>(`/promo/validate`, {
      method: "POST",
      body: JSON.stringify({ code, subtotal }),
    }),
  adminListPromos: () => request<PromoCode[]>(`/admin/promo-codes`),
  adminCreatePromo: (body: {
    code: string;
    kind: "percent" | "amount" | "amount_min";
    value: number;
    min_subtotal?: number;
    max_uses?: number | null;
    expires_at?: string | null;
    enabled?: boolean;
  }) =>
    request<PromoCode>(`/admin/promo-codes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminUpdatePromo: (id: string, body: Partial<PromoCode>) =>
    request<PromoCode>(`/admin/promo-codes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  adminDeletePromo: (id: string) =>
    request<{ status: string }>(`/admin/promo-codes/${id}`, { method: "DELETE" }),
};
