import axios from 'axios';

const api = axios.create({ baseURL: '/api/cpc' });

export interface SaleRow {
  order_code: string;
  order_date: string | null;
  site_name: string;
  seller_alias: string;
  receiver_name: string;
  buyer_name: string;
  product_name: string;
  quantity: number;
  sale: number;          // 매출(정상=정산가 / 가구매=구입가격)
  cost: number;          // 원가(정상=사입원가 / 가구매=실손실)
  profit: number;
  is_fake: boolean;
  settlement: number;    // 정산가
  purchase_price: number;// 고객 구입가
  fee: number;           // 수수료
  shipping: number;      // 배송비
  product_cost: number;  // 사입원가
  packaging: number;     // 포장비
  loss: number;          // 영업비(합산)
  memo: string;
}

export interface SalesResponse {
  days: number;
  rows: SaleRow[];
  totals: {
    count: number; sale: number; profit: number;
    fake_count: number; fake_loss: number; fake_refund: number;
  };
}

export interface FakeMark {
  order_code: string;
  order_date: string | null;
  site_name: string;
  receiver_name: string;
  product_name: string;
  quantity: number | null;
  purchase_price: number | null;
  settlement_price: number | null;
  fee: number | null;
  shipping_price: number | null;
  unit_cost: number | null;
  bundle_count: number;
  product_cost: number | null;
  packaging: number;
  loss: number;
  transferred: boolean;
  transferred_at: string | null;
  memo: string;
}

export async function getMarks(): Promise<FakeMark[]> {
  const { data } = await api.get('/fake-purchase/marks/');
  return data;
}

export async function batchTransfer(orderCodes: string[], transferred = true): Promise<{ count: number }> {
  const { data } = await api.post('/fake-purchase/batch-transfer/', { order_codes: orderCodes, transferred });
  return data;
}

export async function updateMark(orderCode: string, fields: Partial<{ unit_cost: number; bundle_count: number; quantity: number; product_cost: number; shipping_price: number; transferred: boolean; memo: string }>): Promise<void> {
  await api.post('/fake-purchase/mark-update/', { order_code: orderCode, ...fields });
}

// 실배송비 조회 — order_code 단건 {found, shipping, waybill} / 미지정 전체 {updated}
export async function lookupShipping(orderCode?: string): Promise<any> {
  const { data } = await api.post('/fake-purchase/shipping-lookup/', orderCode ? { order_code: orderCode } : {});
  return data;
}

export async function getFakeConfig(): Promise<{ default_shipping_cost: number; packaging_cost: number }> {
  const { data } = await api.get('/fake-purchase/config/');
  return data;
}

export async function setDefaultShipping(value: number, applyExisting = true): Promise<{ default_shipping_cost: number; updated: number }> {
  const { data } = await api.post('/fake-purchase/config/', { default_shipping_cost: value, apply_existing: applyExisting });
  return data;
}

export interface CostCandidate {
  id: number;
  customs_name: string;
  color_option: string;
  size: string;
  name_1688: string;
  unit_price_cny: number;
  unit_cost: number | null;   // 추정 개당원가(KRW)
  is_soldout: boolean;
}

export async function lookupCost(q: string): Promise<CostCandidate[]> {
  const { data } = await api.get('/fake-purchase/cost-lookup/', { params: { q } });
  return Array.isArray(data) ? data : [];
}

export interface ManualEntry {
  id: number;
  purchase_date: string | null;
  recipient: string;
  site_name: string;
  product_name: string;
  is_rocket: boolean;
  amount: number;
  product_cost: number;
  unit_cost: number;
  bundle_count: number;
  quantity: number;
  fee: number;
  shipping: number;
  loss: number;
  deposit_memo: string;
  memo: string;
  transferred: boolean;
  transferred_at: string | null;
}

export async function getSales(days = 7, q?: string, onlyFake = false): Promise<SalesResponse> {
  const params: Record<string, string | number> = { days };
  if (q) params.q = q;
  if (onlyFake) params.only_fake = 1;
  const { data } = await api.get('/fake-purchase/sales/', { params });
  return data;
}

export async function markFake(
  orderCode: string, isFake: boolean, opts?: { adjusted_cost?: number | null; memo?: string },
): Promise<void> {
  await api.post('/fake-purchase/mark/', {
    order_code: orderCode,
    is_fake: isFake,
    adjusted_cost: opts?.adjusted_cost ?? null,
    memo: opts?.memo ?? '',
  });
}

export async function getManual(): Promise<ManualEntry[]> {
  const { data } = await api.get('/fake-purchase/manual/');
  return data;
}

export async function createManual(form: Partial<ManualEntry> & Record<string, any>): Promise<void> {
  await api.post('/fake-purchase/manual/', form);
}

export async function updateManual(id: number, fields: Partial<{ transferred: boolean; product_cost: number; unit_cost: number; bundle_count: number; quantity: number; fee: number; shipping: number; amount: number; recipient: string; product_name: string; site_name: string; deposit_memo: string; memo: string; purchase_date: string; is_rocket: boolean }>): Promise<void> {
  await api.patch(`/fake-purchase/manual/${id}/`, fields);
}

export async function batchTransferManual(ids: number[], transferred = true): Promise<{ count: number }> {
  const { data } = await api.post('/fake-purchase/batch-transfer/', { ids, transferred });
  return data;
}

export async function deleteManual(id: number): Promise<void> {
  await api.delete(`/fake-purchase/manual/${id}/`);
}

// ── 치트키 가구매방 (crossbuy) ──
export interface GagumaeConfig { base: string; user: string; has_pw: boolean; auto_enter: boolean; start_hour: number; retry_min: number; fail_notify_min: number; telegram: boolean; }
export interface GagumaeStatus {
  ok: boolean; error?: string; user?: string; base?: string; rooms?: number;
  open_room?: { id: number; date: string; is_open: boolean } | null;
  latest_room?: { id: number; date: string; is_open: boolean } | null;
  my_register?: { products: number; designations: number } | null;
  need_register?: boolean;
}
export async function getGagumaeConfig(): Promise<GagumaeConfig> {
  const { data } = await api.get('/fake-purchase/gagumae/config/'); return data;
}
export async function saveGagumaeConfig(cfg: { base: string; user: string; pw?: string; auto_enter: boolean; start_hour?: number; retry_min?: number; fail_notify_min?: number; telegram?: boolean }): Promise<void> {
  await api.post('/fake-purchase/gagumae/config/', cfg);
}
export async function checkGagumae(): Promise<GagumaeStatus> {
  const { data } = await api.get('/fake-purchase/gagumae/check/'); return data;
}
export async function enterGagumaeRoom(roomId?: number): Promise<any> {
  const { data } = await api.post('/fake-purchase/gagumae/enter/', roomId ? { room_id: roomId } : {}); return data;
}

export interface GagumaeBuyer {
  product_name: string; external_product_id: string; source_url: string;
  shipping_type: string; option_text: string; quantity: number; price: number;
  buyer_name: string; buyer_username: string; buyer_bank: string;
  buyer_account: string; buyer_depositor: string; purchased: boolean;
}
export async function getGagumaeBuyers(roomId?: number, save?: boolean): Promise<{ count: number; buyers: GagumaeBuyer[]; saved?: number; error?: string }> {
  const params: Record<string, any> = {}; if (roomId) params.room_id = roomId; if (save) params.save = 1;
  const { data } = await api.get('/fake-purchase/gagumae/buyers/', { params });
  return data;
}
