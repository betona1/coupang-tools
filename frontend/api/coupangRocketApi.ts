import axios from 'axios';

const api = axios.create({ baseURL: '/api/cpc' });

export interface CoupangApiAccount {
  id: number;
  cupang_id: string;
  account_name?: string;
  vendor_id: string;
  access_key: string;
  is_active: boolean;
  product_count: number;
  created_at: string | null;
  wing_login_id: string;
  has_wing_password: boolean;
  wing_authed_at?: string | null;
  account_status?: string;
  status_detail?: string;
  status_checked_at?: string | null;
}

export interface CoupangRocketProduct {
  id: number;
  account_id: number;
  cupang_id: string;
  vendor_item_id: string;
  marketplace_vendor_item_id?: string;
  seller_product_id: string;
  product_name: string;
  option_name: string;
  barcode: string;
  is_active: boolean;
  alarm_enabled: boolean;
  alarm_threshold: number;
  alarm_notified: boolean;
  has_image: boolean;
  image_crawled_at: string | null;
  last_price: number | null;
  last_stock: number | null;
  last_checked_at: string | null;
  check_error?: string | null;
}

export interface CoupangDailySale {
  date: string;
  sold_quantity: number;
  restock_quantity: number;
  first_stock: number | null;
  last_stock: number | null;
}

// ── 계정(키) ──
export async function getAccounts(): Promise<CoupangApiAccount[]> {
  const { data } = await api.get('/coupang-rocket/accounts/');
  return data;
}

export async function createAccount(form: {
  cupang_id: string; vendor_id: string; access_key: string; secret_key: string;
  wing_login_id?: string; wing_password?: string;
}): Promise<CoupangApiAccount> {
  const { data } = await api.post('/coupang-rocket/accounts/', form);
  return data;
}

export async function updateAccount(
  id: number, form: Partial<{ vendor_id: string; access_key: string; secret_key: string; is_active: boolean; wing_login_id: string; wing_password: string }>,
): Promise<CoupangApiAccount> {
  const { data } = await api.put(`/coupang-rocket/accounts/${id}/`, form);
  return data;
}

export async function deleteAccount(id: number): Promise<void> {
  await api.delete(`/coupang-rocket/accounts/${id}/`);
}

// ── 쿠팡 WING 대화형 로그인 인증 (2FA 문자) + 쿠키 저장 ──
export interface WingAuthStatus {
  status: 'idle' | 'starting' | 'need_otp' | 'submitting' | 'done' | 'error';
  log: string[];
  error: string;
  url?: string;
  authed_at?: string;
}
export async function wingAuthStart(accountId: number): Promise<{ status: string }> {
  const { data } = await api.post('/coupang-rocket/wing-auth/', { account_id: accountId, action: 'start' });
  return data;
}
export async function wingAuthOtp(accountId: number, code: string): Promise<{ ok: boolean }> {
  const { data } = await api.post('/coupang-rocket/wing-auth/', { account_id: accountId, action: 'otp', code });
  return data;
}
export async function wingAuthStatus(accountId: number): Promise<WingAuthStatus> {
  const { data } = await api.get('/coupang-rocket/wing-auth/', { params: { account_id: accountId } });
  return data;
}

// ── 옵션상품 ──
export async function getProducts(accountId?: number): Promise<CoupangRocketProduct[]> {
  const { data } = await api.get('/coupang-rocket/products/', {
    params: accountId ? { account_id: accountId } : {},
  });
  return data;
}

export async function createProduct(form: {
  account_id: number; vendor_item_id: string; seller_product_id?: string; product_name?: string; option_name?: string; barcode?: string;
}): Promise<CoupangRocketProduct> {
  const { data } = await api.post('/coupang-rocket/products/', form);
  return data;
}

export async function updateProduct(
  id: number, form: Partial<{ product_name: string; option_name: string; barcode: string; is_active: boolean; alarm_enabled: boolean; alarm_threshold: number }>,
): Promise<CoupangRocketProduct> {
  const { data } = await api.patch(`/coupang-rocket/products/${id}/`, form);
  return data;
}

export async function deleteProduct(id: number): Promise<void> {
  await api.delete(`/coupang-rocket/products/${id}/`);
}

// ── 대시보드 통계 ──
export interface StatOption {
  vendor_item_id: string;
  product_name: string;
  option_name: string;
  last_price: number | null;
  last_stock: number | null;
  today_qty: number;
  yesterday_qty: number;
  today_amount: number;
  week_qty: number;
  month_qty: number;
  pending_restock?: number;
  total_restock?: number;
}

export interface BestProduct {
  product_key: string;
  product_name: string;
  image_id: number | null;
  option_count: number;
  today_qty: number;
  week_qty: number;
  month_qty: number;
  today_amount: number;
  verdict?: '주말형' | '평일형' | '고른편';
  ratio?: number;
  weekend_avg?: number;
  weekday_avg?: number;
}

export interface HourlyProduct {
  hour: string;
  total_qty: number;
  total_amount: number;
  items: { name: string; qty: number; amount: number; color: string }[];
}

export interface DashboardStats {
  today: string;
  view_date: string;
  hourly_products: HourlyProduct[];
  options: StatOption[];
  top_qty: StatOption | null;
  top_amount: StatOption | null;
  today_total_qty: number;
  today_total_amount: number;
  best_daily: BestProduct[];
  best_weekly: BestProduct[];
  best_monthly: BestProduct[];
  products_meta: { name: string; color: string }[];
  product_daily: Record<string, number | string>[];
  today_by_product: { name: string; color: string; qty: number; amount: number }[];
  revenue_series: { hour: string; amount: number; qty: number; cum_amount: number }[];
  daily_revenue: { date: string; full_date: string; amount: number; qty: number }[];
  hourly_pattern: { hour: string; qty: number; amount: number; is_peak: boolean; today_qty: number; today_amount: number; week_qty: number; month_qty: number }[];
  peak_hour: string | null;
}

// ── 베스트 상품 클릭 → 30일 일별 판매 + 주말/평일 비교 ──
export interface ProductDailyDay { date: string; full_date: string; weekday: string; is_weekend: boolean; qty: number; }
export interface ProductDailyResp {
  product_key: string; product_name: string; option_count?: number;
  days: ProductDailyDay[];
  summary: {
    total: number; weekend_qty: number; weekday_qty: number;
    weekend_days: number; weekday_days: number;
    weekend_avg: number; weekday_avg: number; all_avg: number;
    verdict: string; ratio: number;
  };
}
// ── 쿠팡 리뷰 (데탑 수집분) ──
export interface CoupangReview { rating: number | null; headline: string; content: string; reviewer: string; review_date: string; helpful_count: number; }
export interface ProductReviewsResp {
  product_key: string; count: number; avg: number;
  dist: Record<string, number>; reviews: CoupangReview[];
}
export async function getProductReviews(productKey: string): Promise<ProductReviewsResp> {
  const { data } = await api.get('/coupang-rocket/product-reviews/', { params: { product_key: productKey } });
  return data;
}
// 서버에서 직접 리뷰 수집 (uc Akamai 우회) — NDJSON 스트리밍
export async function startReviewCrawl(productKey?: string, all?: boolean): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/review-crawl/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(productKey ? { product_key: productKey } : { all: !!all }),
  });
}

export async function getProductDaily(productKey: string, accountId?: number, days = 30): Promise<ProductDailyResp> {
  const params: Record<string, string | number> = { product_key: productKey, days };
  if (accountId) params.account_id = accountId;
  const { data } = await api.get('/coupang-rocket/product-daily/', { params });
  return data;
}

export async function getStats(accountId?: number, days: number = 30, date?: string): Promise<DashboardStats> {
  const params: Record<string, number | string> = { days };
  if (accountId) params.account_id = accountId;
  if (date) params.date = date;
  const { data } = await api.get('/coupang-rocket/stats/', { params });
  return data;
}

// ── 상품 상세 히스토리 (30일 판매 + 가격) ──
export interface RestockEntry {
  id: number;
  restock_date: string;
  quantity: number;
  source: string;
  memo: string;
}

export interface ProductHistory {
  vendor_item_id: string;
  days: number;
  total_sold: number;
  total_restock: number;
  series: { date: string; full_date: string; sold: number; restock: number; stock: number | null; price: number | null }[];
  price_changes: { changed_at: string; old_price: number | null; new_price: number | null }[];
  restocks: RestockEntry[];
}

export async function getProductHistory(id: number, days = 30): Promise<ProductHistory> {
  const { data } = await api.get(`/coupang-rocket/products/${id}/history/`, { params: { days } });
  return data;
}

export async function addRestock(id: number, form: { restock_date: string; quantity: number; memo?: string }): Promise<void> {
  await api.post(`/coupang-rocket/products/${id}/restock/`, form);
}

export async function deleteRestock(restockId: number): Promise<void> {
  await api.delete(`/coupang-rocket/restocks/${restockId}/`);
}

// ── 쿠팡 정산(지급내역) ──
export interface SettlementRow {
  cupang_id: string;
  settlement_type: string;
  settlement_date: string | null;
  revenue_ym: string;
  recognition_from: string | null;
  recognition_to: string | null;
  total_sale: number;
  service_fee: number;
  settlement_target: number;
  settlement_amount: number;
  deduction_amount: number;
  last_amount: number;
  final_amount: number;
  status: string;
  bank_name: string;
  bank_account: string;
  bank_holder: string;
}

export interface SettlementResponse {
  rows: SettlementRow[];
  totals: { count: number; total_sale: number; service_fee: number; final_amount: number };
}

export async function getSettlements(accountId?: number, yearMonth?: string): Promise<SettlementResponse> {
  const params: Record<string, string | number> = {};
  if (accountId) params.account_id = accountId;
  if (yearMonth) params.year_month = yearMonth;
  const { data } = await api.get('/coupang-rocket/settlements/', { params });
  return data;
}

export interface RevenueRow {
  order_id: number; sale_type: string; sale_date: string; recognition_date: string; settlement_date: string;
  product_name: string; vendor_item_id: number | null; sku: string;
  quantity: number; sale_amount: number; service_fee: number; service_fee_ratio: number; settlement_amount: number;
}
export interface RevenueResponse {
  rows: RevenueRow[]; error?: string;
  totals: { count: number; quantity: number; sale_amount: number; service_fee: number; settlement_amount: number };
}
export async function getRevenue(from: string, to: string, cupangId = 'exansys'): Promise<RevenueResponse> {
  const { data } = await api.get('/coupang-rocket/revenue/', { params: { from, to, cupang_id: cupangId } });
  return data;
}

export interface ReconcileRow {
  order_id: string; product: string; qty: number; recognition_date: string;
  coupang_sale: number; coupang_fee: number; coupang_settle: number;
  order_settle: number | null; order_returned?: number; order_status: string | null; diff: number | null; status: string;
}
export interface ReconcileResponse {
  rows: ReconcileRow[]; error?: string;
  totals: { count: number; matched: number; mismatch: number; db_missing: number; coupang_settle: number; order_settle: number; order_returned?: number; diff: number };
}
export async function getReconcile(from: string, to: string, cupangId = 'exansys'): Promise<ReconcileResponse> {
  const { data } = await api.get('/coupang-rocket/reconcile/', { params: { from, to, cupang_id: cupangId } });
  return data;
}

// ── 상품별 정산 (order DB 06.쿠팡) ──
export interface ProductSettlementRow {
  product_name: string; seller_alias: string; product_seller_code: string; exposure_id?: string;
  qty: number; settle: number; pay: number; supply: number; shipping?: number;
  unit_cost?: number; bundle_size?: number; ship_excluded?: boolean;
  ad_cost?: number; ad_sales?: number; roas?: number; acos?: number; profit_ad?: number;
  profit: number; margin: number; cancel_cnt: number; cancel_amt: number; cnt: number;
  cost_source?: 'map' | 'order' | 'importbase' | 'saip' | 'none'; import_name?: string;
  import_suggest_cost?: number; import_suggest_name?: string; import_suggest_src?: string;
}
export interface ProductSettlementResponse {
  rows: ProductSettlementRow[];
  totals: { qty: number; settle: number; pay: number; supply: number; shipping?: number; profit: number; margin: number; ad_cost?: number; ad_sales?: number; roas?: number; profit_ad?: number; cancel_cnt: number; cancel_amt: number };
  sellers: string[];
}
export async function getProductSettlement(sellerAlias?: string, from?: string, to?: string): Promise<ProductSettlementResponse> {
  const params: Record<string, string> = {};
  if (sellerAlias) params.seller_alias = sellerAlias;
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await api.get('/coupang-rocket/product-settlement/', { params });
  return data;
}

// ── 상품 원가/번들 매핑 ──
export interface ProductCostMap {
  id: number; exposure_id: string; product_seller_code: string; product_name: string;
  unit_cost: number; bundle_size: number; ship_excluded: boolean; importbase_name: string; memo: string;
}
export async function saveProductCostMap(form: {
  exposure_id?: string; product_seller_code?: string; product_name?: string;
  unit_cost: number; bundle_size: number; ship_excluded?: boolean; importbase_name?: string; memo?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post('/coupang-rocket/product-cost-map/', form);
  return data;
}
export async function deleteProductCostMap(id: number): Promise<void> {
  await api.delete('/coupang-rocket/product-cost-map/', { params: { id } });
}

// ── 쿠팡 광고리포트 엑셀 업로드 (WING 광고관리 다운로드 파일) ──
export interface AdUploadResult {
  inserted: number; dates?: string[]; total_ad_cost?: number;
  detected?: Record<string, string | null>; error?: string;
}
export async function uploadCoupangAd(file: File, cupangId: string, date?: string): Promise<AdUploadResult> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('cupang_id', cupangId);
  if (date) fd.append('date', date);
  const { data } = await api.post('/coupang-rocket/ad-cost/upload/', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  return data;
}

// 광고센터 자동 수집 (advertising.coupang.com 로그인→보고서→파싱, NDJSON 스트리밍)
export async function startCoupangAdCrawl(cupangId: string, from?: string, to?: string): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/ad-cost/crawl/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cupang_id: cupangId, from: from || null, to: to || null }),
  });
}

// ── 광고비효율 대시보드 ──
export interface AdEffMetrics {
  ad_cost: number; ad_sales: number; impressions: number; clicks: number; ad_orders?: number;
  roas: number; acos: number; ctr: number; cpc: number;
}
export interface AdEffProduct extends AdEffMetrics { name: string; exposure_id: string; }
export interface AdEffAccount extends AdEffMetrics { cupang_id: string; }
export interface AdEfficiencyResponse {
  range: { from: string; to: string };
  totals: AdEffMetrics & { product_count: number; low_roas_cost: number };
  accounts: AdEffAccount[];
  products: AdEffProduct[];
  daily: { date: string; full_date: string; ad_cost: number; ad_sales: number }[];
}
export async function getAdEfficiency(from: string, to: string, cupangId?: string): Promise<AdEfficiencyResponse> {
  const params: Record<string, string> = { from, to };
  if (cupangId) params.cupang_id = cupangId;
  const { data } = await api.get('/coupang-rocket/ad-efficiency/', { params });
  return data;
}

// ── 캠페인별 집계 ──
export interface AdCampaignProduct { name: string; exposure_id: string; ad_cost: number; ad_sales: number; clicks: number; roas: number; }
export interface AdCampaign {
  campaign_name: string; ad_cost: number; ad_sales: number; impressions: number; clicks: number;
  ad_orders: number; roas: number; acos: number; product_count: number;
  products: AdCampaignProduct[]; change_history: AdChange[];
}
export async function getAdCampaigns(from: string, to: string, cupangId?: string): Promise<{ campaigns: AdCampaign[] }> {
  const params: Record<string, string> = { from, to };
  if (cupangId) params.cupang_id = cupangId;
  const { data } = await api.get('/coupang-rocket/ad-campaigns/', { params });
  return data;
}

// ── 광고 설정 변경이력 ──
export type AdChangeType = 'budget' | 'product_split' | 'onoff' | 'etc';
export interface AdChange {
  id?: number; cupang_id?: string; change_date: string; change_type: AdChangeType;
  campaign_name: string; budget_before: number | null; budget_after: number | null;
  products?: { name: string; exposure_id?: string }[]; memo: string;
}
export async function getAdChanges(cupangId?: string): Promise<AdChange[]> {
  const { data } = await api.get('/coupang-rocket/ad-changes/', { params: cupangId ? { cupang_id: cupangId } : {} });
  return data.changes;
}
export async function saveAdChange(c: AdChange): Promise<{ id: number }> {
  const { data } = await api.post('/coupang-rocket/ad-changes/', c);
  return data;
}
export async function deleteAdChange(id: number): Promise<void> {
  await api.delete(`/coupang-rocket/ad-changes/${id}/`);
}

// 옵션ID→노출상품ID 카탈로그 동기화 (전 상품 순회, NDJSON 스트리밍)
export async function startVidMapSync(cupangId: string): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/ad-cost/vidmap-sync/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cupang_id: cupangId }),
  });
}

// ── 통합 정산 (전 계정 로켓그로스 + 마켓플레이스) ──
export interface UnifiedSettlementRow {
  cupang_id: string; account_name: string; alias: string; has_api_key: boolean;
  mp_api_final: number; mp_cnt: number; mp_source: string;
  rocket_final: number; rg_cnt: number;
  ledger: number; ledger_cnt: number; confirmed: number; verified: boolean;
}
export interface UnifiedSettlementResponse {
  rows: UnifiedSettlementRow[];
  totals: { mp_api: number; rocket: number; confirmed: number; ledger: number };
}
export async function getUnifiedSettlement(from?: string, to?: string): Promise<UnifiedSettlementResponse> {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await api.get('/coupang-rocket/unified-settlement/', { params });
  return data;
}

// ── 정산 검증 결과 ──
export interface VerifyCheck { name: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface SettlementVerifyResponse {
  checks: VerifyCheck[];
  summary: { pass: number; warn: number; fail: number };
  date_from: string;
}
export async function getSettlementVerify(from?: string): Promise<SettlementVerifyResponse> {
  const { data } = await api.get('/coupang-rocket/settlement-verify/', { params: from ? { from } : {} });
  return data;
}

// ── 옵션/SKU별 정산 대조 (쿠팡 실제정산 API ↔ 내 대장) ──
export interface OptionSettlementRow {
  sku: string; exposure_id?: string; product_name: string; vids: string[];
  api_qty: number; api_sale: number; api_fee: number; api_settle: number;
  odb_qty: number; odb_settle: number; odb_pay?: number;
  peak_hour?: number | null; hours?: { hour: number; qty: number }[];
  diff: number;
  match: 'both' | 'api_only' | 'odb_only';
}
export interface OptionSettlementResponse {
  rows: OptionSettlementRow[];
  totals: {
    sku_count: number; api_qty: number; api_sale: number; api_fee: number;
    api_settle: number; odb_qty?: number; odb_settle: number; odb_pay?: number; diff: number;
    both: number; api_only: number; odb_only: number;
  };
  range: { from: string; to: string };
  accounts: string[];
  error?: string;
}
export async function getOptionSettlement(cupangId: string, from?: string, to?: string): Promise<OptionSettlementResponse> {
  const params: Record<string, string> = { cupang_id: cupangId };
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await api.get('/coupang-rocket/option-settlement/', { params });
  return data;
}

// ── 로켓그로스 정산현황 (WING 크롤링) ──
export interface RocketSettlementRow {
  cupang_id?: string;
  account_name?: string;
  settlement_date: string | null;
  settlement_type: string;
  pay_ratio: number | null;
  recognition_from: string | null;
  recognition_to: string | null;
  final_amount: number;
  synced_at: string | null;
  has_detail?: boolean;
  gross_sale?: number; cancel_amount?: number;
  revenue_a?: number; commission_b?: number; coupon_c?: number;
  base_revenue_d?: number; payment_h?: number;
  fulfillment_j?: number; inventory_k?: number;
  ff_inout?: number; ff_shipping?: number; ff_storage?: number;
  ff_return?: number; ff_restock?: number; ff_outbound?: number;
}
export interface RocketSettlementResponse {
  rows: RocketSettlementRow[];
  totals: { count: number; final_amount: number };
  per_account?: Record<string, number>;
}
// cupangId 생략 시 전체 계정
export async function getRocketSettlements(cupangId?: string): Promise<RocketSettlementResponse> {
  const { data } = await api.get('/coupang-rocket/rocket-settlement/', { params: cupangId ? { cupang_id: cupangId } : {} });
  return data;
}
// cupangId 생략 시 전체 활성 계정 크롤링
export async function syncRocketSettlements(cupangId?: string, months = 36): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/rocket-settlement/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cupang_id: cupangId || null, months }),
  });
}

export async function syncSettlements(accountId?: number, yearMonth?: string): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/settlements/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId || null, year_month: yearMonth || null }),
  });
}

// ── 재고 증가 이벤트 (주문취소/입고 분류) ──
export interface IncreaseEvent {
  id: number; vendor_item_id: string; product_name: string; option_name: string;
  checked_at: string; date: string; prev_stock: number | null; stock: number | null;
  delta: number; marked_restock: boolean;
}
export async function getIncreaseEvents(vendorItemId?: string, days = 30): Promise<{ rows: IncreaseEvent[] }> {
  const { data } = await api.get('/coupang-rocket/increases/', {
    params: { ...(vendorItemId ? { vendor_item_id: vendorItemId } : {}), days },
  });
  return data;
}
export async function setIncreaseKind(id: number, isRestock: boolean): Promise<void> {
  await api.post('/coupang-rocket/increases/', { id, is_restock: isRestock });
}

// ── 입고 예정 (자동 매칭) ──
export interface ExpectedRestock {
  id: number; vendor_item_id: string; product_id: number | null; has_image: boolean;
  product_name: string; option_name: string;
  expected_quantity: number; window_days: number; status: 'pending' | 'matched' | 'expired';
  matched_at: string | null; matched_qty: number | null; memo: string; registered_at: string | null;
}
export async function getExpectedRestocks(vendorItemId?: string): Promise<{ rows: ExpectedRestock[]; summary: Record<string, { pending_qty: number; total_restock: number }> }> {
  const { data } = await api.get('/coupang-rocket/expected-restock/', { params: vendorItemId ? { vendor_item_id: vendorItemId } : {} });
  return data;
}
export async function registerExpectedRestock(vendorItemId: string, quantity: number, windowDays = 7, memo = ''): Promise<void> {
  await api.post('/coupang-rocket/expected-restock/', { vendor_item_id: vendorItemId, quantity, window_days: windowDays, memo });
}
export async function deleteExpectedRestock(id: number): Promise<void> {
  await api.delete('/coupang-rocket/expected-restock/', { params: { id } });
}

// ── 일별 판매량 ──
export async function getDailySales(vendorItemId: string): Promise<CoupangDailySale[]> {
  const { data } = await api.get('/coupang-rocket/daily/', {
    params: { vendor_item_id: vendorItemId },
  });
  return data;
}

// ── 전역 설정 (자동점검 주기) ──
export interface RocketConfig {
  check_interval_min: number;
  allowed_intervals: number[];
}

export async function getConfig(): Promise<RocketConfig> {
  const { data } = await api.get('/coupang-rocket/config/');
  return data;
}

export async function saveConfig(checkIntervalMin: number): Promise<RocketConfig> {
  const { data } = await api.post('/coupang-rocket/config/', { check_interval_min: checkIntervalMin });
  return data;
}

// ── 수동 재고 체크 (NDJSON 스트리밍) ──
export async function startStockCheck(accountId?: number): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/check/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId || null }),
  });
}

// ── 전 상품 옵션ID 검증 (판매자ID→로켓ID 자동전환, NDJSON) ──
export async function startVerifyVendorIds(): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/verify-vendor-ids/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

// ── 노출상품ID의 형제 옵션 전체 자동등록 (NDJSON 스트리밍) ──
export async function startRegisterOptions(accountId: number, sellerProductId: string): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/register-options/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, seller_product_id: sellerProductId }),
  });
}

// ── 입고 상세 (총입고 클릭 모달) ──
export interface RestockDetailRow { date: string; time: string; qty: number; source: string; memo: string }
export interface RestockDetail {
  rows: RestockDetailRow[]; total: number; product_name: string; option_name: string;
}
export async function getRestockDetail(productId: number): Promise<RestockDetail> {
  const { data } = await api.get(`/coupang-rocket/products/${productId}/restock-detail/`);
  return data;
}

// ── 이미지 크롤링 (NDJSON 스트리밍). productIds 없으면 전체 ──
export async function startImageCrawl(productIds?: number[]): Promise<Response> {
  return fetch('/api/cpc/coupang-rocket/crawl-images/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_ids: productIds || null }),
  });
}

export function productImageUrl(id: number): string {
  return `/api/cpc/coupang-rocket/products/${id}/image/`;
}
