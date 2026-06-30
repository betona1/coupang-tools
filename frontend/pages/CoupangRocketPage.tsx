import { useState, useEffect, useCallback, Fragment, type ReactNode } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, ComposedChart, Line,
  PieChart, Pie, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts';
import {
  getAccounts, createAccount, deleteAccount, updateAccount,
  wingAuthStart, wingAuthOtp, wingAuthStatus, type WingAuthStatus,
  getProducts, createProduct, updateProduct, deleteProduct,
  startStockCheck, getStats, getConfig, saveConfig,
  startImageCrawl, startRegisterOptions, startVerifyVendorIds, productImageUrl, getProductHistory, addRestock, deleteRestock,
  getRestockDetail, type RestockDetail,
  getIncreaseEvents, setIncreaseKind, type IncreaseEvent,
  getExpectedRestocks, registerExpectedRestock, deleteExpectedRestock, type ExpectedRestock,
  getProductDaily, type ProductDailyResp,
  getProductReviews, startReviewCrawl, getReviewReport, type ProductReviewsResp, type ReviewReport,
  type CoupangApiAccount, type CoupangRocketProduct,
  type DashboardStats, type ProductHistory, type BestProduct,
} from '../api/coupangRocketApi';
import BarcodeModal from '../components/BarcodeModal';

const won = (n: number) => '₩' + (n || 0).toLocaleString();

// 로컬(KST) 기준 YYYY-MM-DD
const localYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayYmd = () => localYmd(new Date());
const shiftYmd = (ymd: string, delta: number) => {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return localYmd(d);
};

export default function CoupangRocketPage() {
  const [accounts, setAccounts] = useState<CoupangApiAccount[]>([]);
  const [products, setProducts] = useState<CoupangRocketProduct[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showIncreases, setShowIncreases] = useState(false);
  const [restockFor, setRestockFor] = useState<CoupangRocketProduct | null>(null);
  const [barcodeFor, setBarcodeFor] = useState('');
  const [restockDetailFor, setRestockDetailFor] = useState<number | null>(null);
  const [filterAccount, setFilterAccount] = useState<number | 0>(0);
  const [dailyModal, setDailyModal] = useState<BestProduct | null>(null);
  const [modalTab, setModalTab] = useState<'daily' | 'reviews'>('daily');
  const openReviews = (p: CoupangRocketProduct) => {
    setModalTab('reviews');
    setDailyModal({ product_key: p.seller_product_id, product_name: p.product_name,
      image_id: p.image_file ? p.id : null, option_count: 1,
      today_qty: 0, week_qty: 0, month_qty: 0, today_amount: 0 });
  };
  const [patternDays, setPatternDays] = useState<7 | 30>(30);
  // 매출그래프 + 시간대별 상품리스트 표시 날짜 (◀▶ / 좌우 화살표키로 이동)
  const [viewDate, setViewDate] = useState<string>(todayYmd());

  // 재고 체크 스트리밍
  const [checking, setChecking] = useState(false);
  const [imgCrawling, setImgCrawling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);

  // 행 확장 (상세 히스토리 그래프)
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [history, setHistory] = useState<ProductHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 정렬 (기본: 재고 오름차순 → 품절/부족 상품이 맨 위로)
  const [sortKey, setSortKey] = useState<string>('last_stock');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // 행 편집 모드 (✏️ 아이콘으로 활성화)
  const [editRows, setEditRows] = useState<Set<number>>(new Set());
  const toggleEditRow = (id: number) => setEditRows(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [accs, prods] = await Promise.all([
        getAccounts(),
        getProducts(filterAccount || undefined),
      ]);
      setAccounts(accs);
      setProducts(prods);
    } finally {
      setLoading(false);
    }
  }, [filterAccount]);

  const loadStats = useCallback(async () => {
    setStats(await getStats(filterAccount || undefined, patternDays, viewDate));
  }, [filterAccount, patternDays, viewDate]);

  // 날짜 이동 (오늘 이후로는 못 감)
  const goDate = useCallback((delta: number) => {
    setViewDate(d => {
      const next = shiftYmd(d, delta);
      return next > todayYmd() ? d : next;
    });
  }, []);
  const goToday = useCallback(() => setViewDate(todayYmd()), []);

  // 좌우 화살표 키 = 날짜 이전/다음 (입력 필드 포커스 시 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') goDate(-1);
      else if (e.key === 'ArrowRight') goDate(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goDate]);

  const refresh = useCallback(() => { loadAll(); loadStats(); }, [loadAll, loadStats]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadStats(); }, [loadStats]);

  // ── 자동 새로고침 (크롤링 주기에 맞춰 1분마다 폴링) ──
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      getProducts(filterAccount || undefined).then(setProducts).catch(() => {});
      getStats(filterAccount || undefined, patternDays, viewDate).then(setStats).catch(() => {});
      setLastRefresh(new Date());
    }, 60000);
    return () => window.clearInterval(id);
  }, [autoRefresh, filterAccount, patternDays, viewDate]);

  // ── 재고 수동체크 ──
  const runCheck = async () => {
    setChecking(true);
    setShowLog(true);
    setLogs(['재고 체크 요청...']);
    try {
      const resp = await startStockCheck(filterAccount || undefined);
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.t === 'log') setLogs(p => [...p, ev.m]);
            else if (ev.t === 'done') setLogs(p => [...p, `✅ 완료 — 성공 ${ev.ok} / 실패 ${ev.fail} / 전체 ${ev.total}`]);
          } catch { /* ignore */ }
        }
      }
      await refresh();
    } catch (e) {
      setLogs(p => [...p, `오류: ${e}`]);
    } finally {
      setChecking(false);
    }
  };

  // ── 전 상품 옵션ID 검증 (판매자ID → 로켓ID 자동전환) ──
  const [verifying, setVerifying] = useState(false);
  const runVerifyVendorIds = async () => {
    setVerifying(true);
    setShowLog(true);
    setLogs(['옵션ID 검증 시작 — 판매자옵션ID로 잘못 등록된 상품을 로켓ID로 자동 전환합니다...']);
    try {
      const resp = await startVerifyVendorIds();
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.t === 'log') setLogs(p => [...p, ev.m]);
            else if (ev.t === 'done') setLogs(p => [...p, `✅ 검증완료 — 정상 ${ev.ok} / 수정 ${ev.fixed} / 실패 ${ev.fail}`]);
          } catch { /* ignore */ }
        }
      }
      await refresh();
    } catch (e) {
      setLogs(p => [...p, `오류: ${e}`]);
    } finally {
      setVerifying(false);
    }
  };

  // ── 노출상품ID 클릭 → 형제 옵션 전체 자동등록 (Open API) ──
  const [registering, setRegistering] = useState(false);
  const runRegisterOptions = async (accountId: number, spid: string, label: string) => {
    if (!spid) return;
    if (!window.confirm(`「${label}」\n노출상품ID ${spid} 의 나머지 옵션을 전부 가져와 등록할까요?\n(옵션 정보 + 이미지 + 재고 자동 수집)`)) return;
    setRegistering(true);
    setShowLog(true);
    setLogs([`노출상품ID ${spid} 옵션 자동등록 시작...`]);
    try {
      const resp = await startRegisterOptions(accountId, spid);
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.t === 'log') setLogs(p => [...p, ev.m]);
            else if (ev.t === 'done') setLogs(p => [...p, ev.fail ? `❌ 실패` : `✅ 완료 — ${ev.product_name || ''} 신규 ${ev.ok} / 갱신 ${ev.updated} / 이미지 ${ev.images}`]);
          } catch { /* ignore */ }
        }
      }
      await refresh();
    } catch (e) {
      setLogs(p => [...p, `오류: ${e}`]);
    } finally {
      setRegistering(false);
    }
  };

  // ── 이미지 크롤링 (전체 또는 일부) ──
  const runImageCrawl = async (productIds?: number[]) => {
    setImgCrawling(true);
    setShowLog(true);
    setLogs(['이미지 크롤링 시작 (쿠팡 봇탐지 우회 — 다소 느립니다)...']);
    try {
      const resp = await startImageCrawl(productIds);
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.t === 'log') setLogs(p => [...p, ev.m]);
            else if (ev.t === 'done') setLogs(p => [...p, `🖼 이미지 완료 — 성공 ${ev.ok} / 실패 ${ev.fail} / 전체 ${ev.total}`]);
          } catch { /* ignore */ }
        }
      }
      await loadAll();
    } catch (e) {
      setLogs(p => [...p, `오류: ${e}`]);
    } finally {
      setImgCrawling(false);
    }
  };

  const loadHistory = async (id: number) => {
    setHistory(null);
    setHistoryLoading(true);
    try {
      setHistory(await getProductHistory(id, 30));
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    await loadHistory(id);
  };

  const openExpand = async (id: number) => {
    setExpandedId(id);
    await loadHistory(id);
  };

  // 입고/가격 변경 후 그래프 + 상단 데이터 갱신
  const onHistoryChanged = async (id: number) => {
    await Promise.all([loadHistory(id), loadAll(), loadStats()]);
  };

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const onDeleteProduct = async (id: number) => {
    if (!confirm('이 옵션을 추적 목록에서 삭제할까요?')) return;
    await deleteProduct(id);
    refresh();
  };

  const saveField = async (id: number, field: 'barcode' | 'product_name' | 'option_name', value: string) => {
    const cur = products.find(p => p.id === id);
    if (cur && (cur as any)[field] === value) return;
    setProducts(ps => ps.map(p => p.id === id ? { ...p, [field]: value } : p));
    await updateProduct(id, { [field]: value });
  };

  const setAlarm = async (id: number, patch: { alarm_enabled?: boolean; alarm_threshold?: number }) => {
    setProducts(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
    await updateProduct(id, patch);
  };

  const salesByVid = new Map((stats?.options || []).map(o => [o.vendor_item_id, o]));

  // 정렬값 추출 (판매량 항목은 stats 에서)
  const sortVal = (p: CoupangRocketProduct): string | number => {
    const s = salesByVid.get(p.vendor_item_id);
    switch (sortKey) {
      case 'cupang_id': return p.cupang_id || '';
      case 'product_name': return p.product_name || '';
      case 'option_name': return p.option_name || '';
      case 'vendor_item_id': return p.vendor_item_id || '';
      case 'seller_product_id': return p.seller_product_id || '';
      case 'barcode': return p.barcode || '';
      case 'last_price': return p.last_price ?? -1;
      case 'last_stock': return p.last_stock ?? 999999;
      case 'today_qty': return s?.today_qty ?? 0;
      case 'yesterday_qty': return s?.yesterday_qty ?? 0;
      case 'week_qty': return s?.week_qty ?? 0;
      case 'month_qty': return s?.month_qty ?? 0;
      case 'last_checked_at': return p.last_checked_at || '';
      default: return p.product_name || '';
    }
  };
  const sortedProducts = [...products].sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    let cmp: number;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb), 'ko');
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // 전 옵션의 마지막 재고체크 시각(대부분 동일) — 가장 최근 1개만 상단 표시
  const lastCheckedAt = products.reduce((mx, p) => (p.last_checked_at && p.last_checked_at > mx ? p.last_checked_at : mx), '')
    .replace(/^2026[-./]\s?/, '');

  const SortHeader = ({ label, k, align = 'left', className = '' }: { label: string; k: string; align?: 'left' | 'right' | 'center'; className?: string }) => (
    <th
      className={`px-2 py-2 text-${align} cursor-pointer select-none hover:bg-gray-200 whitespace-nowrap ${className}`}
      onClick={() => toggleSort(k)}
    >
      {label}
      <span className="ml-0.5 text-[10px] text-gray-400">
        {sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );

  return (
    <div className="p-4 max-w-[1800px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <RocketGrowthBadge />
          <span>재고추적</span>
        </h1>
        <select
          value={filterAccount}
          onChange={e => setFilterAccount(Number(e.target.value))}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value={0}>전체 계정</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.cupang_id} ({a.product_count})</option>
          ))}
        </select>
        <button
          onClick={() => runImageCrawl()}
          disabled={imgCrawling || products.length === 0}
          className="px-3 py-1 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-50"
          title="등록된 모든 상품 이미지를 쿠팡에서 크롤링"
        >
          {imgCrawling ? '이미지 수집 중...' : '🖼 전체 이미지'}
        </button>
        <button
          onClick={() => setShowIncreases(true)}
          className="px-3 py-1 rounded bg-amber-500 text-white text-sm font-semibold"
          title="재고가 늘어난 내역 — 기본 주문취소, 입고면 입고로 표시"
        >
          📥 재고증가(취소/입고)
        </button>
        <button
          onClick={runVerifyVendorIds}
          disabled={verifying || products.length === 0}
          className="px-3 py-1 rounded bg-rose-600 text-white text-sm font-semibold disabled:opacity-50"
          title="판매자옵션ID로 잘못 등록된 상품을 찾아 로켓ID로 자동 전환"
        >
          {verifying ? '검증 중...' : '🔍 옵션ID 검증'}
        </button>
        <button
          onClick={() => setShowSettings(s => !s)}
          className="px-3 py-1 rounded bg-gray-700 text-white text-sm font-semibold"
        >
          ⚙ 설정
        </button>
        {loading && <span className="text-xs text-gray-400 animate-pulse">불러오는 중...</span>}
        {/* 오른쪽 끝: 최근체크(1개) + 동기화(실시간 체크) + 자동갱신 */}
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs text-gray-500 whitespace-nowrap" title="모든 옵션의 마지막 재고체크 시각">
            최근체크 <b className="text-gray-700">{lastCheckedAt || '미체크'}</b>
          </span>
          <button
            onClick={runCheck}
            disabled={checking || products.length === 0}
            className="px-3 py-1 rounded bg-[#e44232] text-white text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
            title="지금 전 옵션 재고를 실시간으로 다시 조회"
          >
            {checking ? '동기화 중...' : '🔄 동기화'}
          </button>
          <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer whitespace-nowrap" title="크롤링(5분)에 맞춰 1분마다 자동 갱신">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-[#16a34a]" />
            <span className={autoRefresh ? 'text-[#16a34a] font-semibold' : ''}>자동갱신{autoRefresh ? ' ON' : ' OFF'}</span>
          </label>
        </div>
      </div>

      {showSettings && <SettingsPanel accounts={accounts} onChange={refresh} />}
      {showIncreases && <IncreaseEventsModal onClose={() => setShowIncreases(false)} onChanged={refresh} />}
      {restockFor && <ExpectedRestockModal product={restockFor} onClose={() => setRestockFor(null)} onChanged={refresh} />}
      {barcodeFor && <BarcodeModal code={barcodeFor} onClose={() => setBarcodeFor('')} />}
      {dailyModal && <ProductDailyModal product={dailyModal} accountId={filterAccount} initialTab={modalTab} onClose={() => setDailyModal(null)} />}
      {restockDetailFor != null && <RestockDetailModal productId={restockDetailFor} onClose={() => setRestockDetailFor(null)} />}
      <RestockArrivedPopup />
      {stats?.restock_needed && stats.restock_needed.length > 0 && <RestockNeededPopup items={stats.restock_needed} />}
      <ReviewIncreasePopup />

      {stats && (
        <Dashboard
          stats={stats}
          onBestClick={(b) => { setModalTab('daily'); setDailyModal(b); }}
          patternDays={patternDays}
          onPatternDaysChange={setPatternDays}
          viewDate={viewDate}
          isToday={viewDate >= todayYmd()}
          onPrevDate={() => goDate(-1)}
          onNextDate={() => goDate(1)}
          onToday={goToday}
        />
      )}

      <AddProductForm accounts={accounts} onAdded={refresh} />

      {/* 재고 테이블 */}
      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <SortHeader label="쿠팡ID" k="cupang_id" />
              <th className="px-1.5 py-2 text-center">이미지</th>
              <SortHeader label="상품 / 옵션 · 바코드" k="product_name" />
              <th className="px-1.5 py-2 text-left text-[11px]" title="옵션ID / 노출상품ID">ID</th>
              <SortHeader label="판매가" k="last_price" align="right" />
              <SortHeader label="재고" k="last_stock" align="right" />
              <SortHeader label="오늘" k="today_qty" align="right" className="bg-red-50" />
              <SortHeader label="어제" k="yesterday_qty" align="right" />
              <SortHeader label="7일" k="week_qty" align="right" />
              <SortHeader label="30일" k="month_qty" align="right" />
              <th className="px-1.5 py-2 text-right text-blue-600" title="입고 예정수량 (등록)">입고예정</th>
              <th className="px-1.5 py-2 text-right text-emerald-600" title="총 입고수량 (누적)">총입고</th>
              <th className="px-1.5 py-2 text-center">알람</th>
              <th className="px-1.5 py-2 text-center">관리</th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map(p => (
              <Fragment key={p.id}>
              <tr className={`border-t hover:bg-gray-50 ${expandedId === p.id ? 'bg-blue-50' : ''}`}>
                <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">{p.cupang_id}<RocketGrowthBadge small /></span>
                </td>
                <td className="px-1.5 py-1.5 text-center">
                  {p.has_image ? (
                    <a href={productImageUrl(p.id)} target="_blank" rel="noreferrer">
                      <img src={`${productImageUrl(p.id)}?t=${p.image_crawled_at || ''}`} alt="" className="w-14 h-14 object-cover rounded-md border mx-auto" />
                    </a>
                  ) : (
                    <button
                      onClick={() => runImageCrawl([p.id])}
                      disabled={imgCrawling}
                      className="w-14 h-14 text-[10px] rounded-md border text-[#0074e9] border-dashed border-[#0074e9] hover:bg-blue-50 disabled:opacity-40 mx-auto flex items-center justify-center text-center leading-tight"
                      title="이 상품 이미지 크롤링"
                    >
                      🖼<br />가져오기
                    </button>
                  )}
                </td>
                {/* 상품명(크게) + 옵션명 + 바코드 한 셀 */}
                <td className="px-2 py-1.5 min-w-[260px] max-w-[420px]">
                  {editRows.has(p.id) ? (
                    <div className="space-y-1">
                      <EditableCell value={p.product_name} placeholder="상품명 입력" startOpen onSave={v => saveField(p.id, 'product_name', v)} />
                      <EditableCell value={p.option_name} placeholder="옵션명 입력" startOpen onSave={v => saveField(p.id, 'option_name', v)} />
                      <EditableCell value={p.barcode} placeholder="바코드 입력" mono startOpen onSave={v => saveField(p.id, 'barcode', v)} />
                    </div>
                  ) : (
                    <div className="leading-snug">
                      <button onClick={() => toggleExpand(p.id)} className="text-left hover:text-blue-600 font-semibold text-[13px] flex items-start gap-1 w-full" title="판매·가격 그래프 보기">
                        <span className="text-[10px] text-gray-400 mt-0.5 shrink-0">{expandedId === p.id ? '▼' : '▶'}</span>
                        <span className="break-words">{p.product_name || <span className="text-gray-300">(상품명없음)</span>}</span>
                      </button>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5 pl-3.5">
                        {p.option_name && <span className="text-xs text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">{p.option_name}</span>}
                        {p.barcode
                          ? <button onClick={() => setBarcodeFor(p.barcode)} title="클릭 → 바코드 생성(738×327, JPG 다운로드)"
                              className="font-mono text-[11px] text-blue-600 hover:underline hover:text-blue-800">🏷️ {p.barcode}</button>
                          : null}
                        {p.seller_product_id && (
                          <button onClick={() => openReviews(p)} title="이 상품 쿠팡 리뷰 보기"
                            className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold hover:bg-amber-200">⭐ 리뷰</button>
                        )}
                      </div>
                    </div>
                  )}
                </td>
                {/* 옵션ID / 노출상품ID 한 셀, 작게 — 클릭 시 쿠팡 상품페이지 */}
                <td className="px-1.5 py-1.5 font-mono text-[10px] text-gray-500 whitespace-nowrap leading-tight">
                  {p.seller_product_id ? (
                    <a href={`https://www.coupang.com/vp/products/${p.seller_product_id}?vendorItemId=${p.vendor_item_id}`}
                       target="_blank" rel="noreferrer" title="쿠팡 상품페이지 열기"
                       className="block hover:text-blue-700">
                      <div title="로켓그로스 옵션ID(재고추적)"><span className="text-rose-400">로</span> {p.vendor_item_id}</div>
                      {p.marketplace_vendor_item_id && <div className="text-gray-400" title="판매자윙(마켓플레이스) 옵션ID"><span className="text-gray-300">판</span> {p.marketplace_vendor_item_id}</div>}
                      <div className="text-blue-600 hover:underline"><span className="text-gray-300">노</span> {p.seller_product_id} 🔗</div>
                    </a>
                  ) : (
                    <div title="로켓그로스 옵션ID"><span className="text-rose-400">로</span> {p.vendor_item_id}</div>
                  )}
                  {p.seller_product_id && (
                    <button disabled={registering}
                      onClick={() => runRegisterOptions(p.account_id, p.seller_product_id, p.product_name || p.option_name || p.vendor_item_id)}
                      title="이 상품의 나머지 옵션 전부 자동등록"
                      className="mt-0.5 text-[9px] px-1 rounded border text-emerald-600 border-emerald-300 hover:bg-emerald-50 disabled:opacity-50">➕옵션등록</button>
                  )}
                </td>
                <td className="px-1.5 py-1.5 text-right whitespace-nowrap">{p.last_price != null ? p.last_price.toLocaleString() : '-'}</td>
                <td className={`px-1.5 py-1.5 text-right font-bold whitespace-nowrap ${p.last_stock != null && p.last_stock <= 10 ? 'text-red-600' : ''}`}>
                  {p.last_stock != null ? p.last_stock.toLocaleString() : '-'}
                  {p.last_stock != null && p.last_stock <= 0 && (
                    <span className="ml-1 px-1 py-[1px] bg-red-600 text-white text-[9px] rounded font-bold align-middle">품절</span>
                  )}
                  {salesByVid.get(p.vendor_item_id)?.restock_needed && (p.last_stock ?? 0) > 0 && (
                    <span className="ml-1 px-1 py-[1px] bg-orange-500 text-white text-[9px] rounded font-bold align-middle animate-pulse" title="현재고 < 1달 판매량 · 선입고 미등록">입고필요</span>
                  )}
                </td>
                <td className="px-1.5 py-1.5 text-right font-bold text-[#e44232] bg-red-50">{salesByVid.get(p.vendor_item_id)?.today_qty ?? 0}</td>
                <td className="px-1.5 py-1.5 text-right text-gray-700">{salesByVid.get(p.vendor_item_id)?.yesterday_qty ?? 0}</td>
                <td className="px-1.5 py-1.5 text-right text-gray-600">{salesByVid.get(p.vendor_item_id)?.week_qty ?? 0}</td>
                <td className="px-1.5 py-1.5 text-right text-gray-600">{salesByVid.get(p.vendor_item_id)?.month_qty ?? 0}</td>
                <td className="px-1.5 py-1.5 text-right">
                  <button onClick={() => setRestockFor(p)} className="text-blue-600 hover:underline font-semibold" title="입고 예정 등록/관리">
                    {salesByVid.get(p.vendor_item_id)?.pending_restock ? (salesByVid.get(p.vendor_item_id)!.pending_restock!).toLocaleString() : <span className="text-gray-300">+등록</span>}
                  </button>
                </td>
                <td className="px-1.5 py-1.5 text-right font-semibold text-emerald-600">
                  {(() => { const t = salesByVid.get(p.vendor_item_id)?.total_restock ?? 0;
                    return t > 0
                      ? <button onClick={() => setRestockDetailFor(p.id)} className="hover:underline" title="입고 날짜·수량 보기">{t.toLocaleString()}</button>
                      : <span className="text-gray-300">0</span>; })()}
                </td>
                <td className="px-1.5 py-1.5 text-center whitespace-nowrap">
                  <label className="inline-flex items-center gap-1 cursor-pointer" title="체크 시 재고가 임계 이하로 떨어지면 텔레그램 알람">
                    <input
                      type="checkbox"
                      checked={p.alarm_enabled}
                      onChange={e => setAlarm(p.id, { alarm_enabled: e.target.checked })}
                      className="accent-[#e44232]"
                    />
                    {p.alarm_enabled && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-gray-500">
                        ≤
                        <input
                          type="number"
                          value={p.alarm_threshold}
                          onChange={e => setAlarm(p.id, { alarm_threshold: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                          className="border rounded w-12 px-1 py-0.5 text-right text-[11px]"
                        />
                        개
                      </span>
                    )}
                  </label>
                  {p.alarm_enabled && p.alarm_notified && (
                    <div className="text-[9px] text-red-500 font-bold mt-0.5">알람발송됨</div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center whitespace-nowrap">
                  <button
                    onClick={() => toggleEditRow(p.id)}
                    className={`text-xs mr-1 px-1.5 py-0.5 rounded ${editRows.has(p.id) ? 'bg-green-600 text-white' : 'hover:bg-gray-100'}`}
                    title={editRows.has(p.id) ? '수정 완료' : '수정'}
                  >
                    {editRows.has(p.id) ? '✓ 완료' : '✏️ 수정'}
                  </button>
                  <button
                    onClick={() => openExpand(p.id)}
                    className="text-xs mr-1 px-1.5 py-0.5 rounded text-[#0074e9] hover:bg-blue-50"
                    title="입고 등록"
                  >
                    📦 입고
                  </button>
                  <button onClick={() => onDeleteProduct(p.id)} className="text-red-500 hover:underline text-xs">삭제</button>
                </td>
              </tr>
              {expandedId === p.id && (
                <tr className="bg-slate-50">
                  <td colSpan={14} className="px-4 py-3">
                    <ProductHistoryPanel loading={historyLoading} history={history} product={p} onChanged={() => onHistoryChanged(p.id)} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {sortedProducts.length === 0 && (
              <tr><td colSpan={14} className="px-2 py-8 text-center text-gray-400">등록된 옵션이 없습니다. 위에서 옵션ID를 추가하세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 로그 패널 */}
      {showLog && (
        <div className="fixed bottom-4 right-4 w-[440px] max-h-[50vh] bg-[#1a1a2e] text-gray-200 rounded-lg shadow-xl flex flex-col z-40">
          <div className="flex justify-between items-center px-3 py-2 border-b border-gray-700">
            <span className="text-sm font-semibold">재고 체크 로그</span>
            <button onClick={() => setShowLog(false)} className="text-gray-400">×</button>
          </div>
          <div className="overflow-auto p-2 text-xs font-mono space-y-0.5">
            {logs.map((l, i) => (
              <div key={i} className={l.includes('❌') ? 'text-red-400' : l.includes('✅') ? 'text-green-400' : ''}>{l}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 대시보드 (요약카드 + 오늘 매출 그래프) ──
function Dashboard({ stats, patternDays, onPatternDaysChange, viewDate, isToday, onPrevDate, onNextDate, onToday, onBestClick }: {
  stats: DashboardStats; patternDays: 7 | 30; onPatternDaysChange: (d: 7 | 30) => void;
  viewDate: string; isToday: boolean; onPrevDate: () => void; onNextDate: () => void; onToday: () => void;
  onBestClick: (b: BestProduct) => void;
}) {
  // 표시 날짜 라벨 (오늘/어제 강조)
  const dateLabel = isToday ? '오늘' : (shiftYmd(todayYmd(), -1) === viewDate ? '어제' : viewDate);

  // 매출 그래프 범위: 오늘(시간대별) / 7일·30일(일별 실매출 추이)
  const [revRange, setRevRange] = useState<'today' | 'week' | 'month'>('today');
  // 일별 실매출 (백엔드: inventory_log 실제 판매가 기준)
  const rangeRevenue = (() => {
    const rows = revRange === 'week' ? stats.daily_revenue.slice(-7) : stats.daily_revenue;
    let cum = 0;
    return rows.map(r => { cum += r.amount; return { date: r.date, amount: r.amount, cum_amount: cum }; });
  })();

  const [hourlyMetric, setHourlyMetric] = useState<'qty' | 'amount'>('qty');
  const [hourlyRange, setHourlyRange] = useState<'today' | 'all'>('all');
  // 토글에 따라 막대로 그릴 필드 결정
  const barKey = hourlyRange === 'today'
    ? (hourlyMetric === 'qty' ? 'today_qty' : 'today_amount')
    : hourlyMetric;
  const barMax = Math.max(0, ...stats.hourly_pattern.map(d => (d as any)[barKey] || 0));
  const fmtName = (o: { product_name: string; option_name: string } | null) =>
    o ? `${o.product_name || '(상품명없음)'}${o.option_name ? ' · ' + o.option_name : ''}` : '판매 없음';

  return (
    <div className="mb-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* 요약 카드 3종 */}
      <div className="grid grid-cols-2 gap-3 lg:col-span-1">
        <Card title="🏆 판매수량 1등" accent="#e44232">
          <div className="text-sm font-bold truncate">{fmtName(stats.top_qty)}</div>
          <div className="text-2xl font-extrabold text-[#e44232]">{stats.top_qty?.today_qty ?? 0}<span className="text-sm font-medium text-gray-400 ml-1">개</span></div>
        </Card>
        <Card title="💰 판매금액 1등" accent="#0074e9">
          <div className="text-sm font-bold truncate">{fmtName(stats.top_amount)}</div>
          <div className="text-2xl font-extrabold text-[#0074e9]">{won(stats.top_amount?.today_amount ?? 0)}</div>
        </Card>
        <Card title="오늘 총 판매수량" accent="#6b7280">
          <div className="text-2xl font-extrabold">{stats.today_total_qty}<span className="text-sm font-medium text-gray-400 ml-1">개</span></div>
        </Card>
        <Card title="오늘 총 매출액" accent="#16a34a">
          <div className="text-2xl font-extrabold text-green-600">{won(stats.today_total_amount)}</div>
        </Card>
      </div>

      {/* 매출 그래프 — 오늘(시간대별, ◀▶/←→ 날짜이동) / 7일·30일(일별 추이) */}
      <div className="bg-white border rounded-lg p-3 lg:col-span-2">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <span className="text-sm font-bold">
            {revRange === 'today'
              ? <>{dateLabel}의 매출액 <span className="text-gray-400 font-normal">({stats.view_date})</span></>
              : revRange === 'week' ? '최근 7일 매출액' : '최근 30일 매출액'}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {revRange === 'today' && (
              <div className="flex items-center gap-1">
                <button onClick={onPrevDate} title="이전 날짜 (←)"
                  className="px-2 py-0.5 rounded border text-sm font-bold text-gray-600 hover:bg-gray-100">◀</button>
                <button onClick={onToday} disabled={isToday} title="오늘로"
                  className={`px-2 py-0.5 rounded border text-xs font-semibold ${isToday ? 'text-gray-300 cursor-default' : 'text-[#e44232] hover:bg-red-50'}`}>오늘</button>
                <button onClick={onNextDate} disabled={isToday} title="다음 날짜 (→)"
                  className={`px-2 py-0.5 rounded border text-sm font-bold ${isToday ? 'text-gray-300 cursor-default' : 'text-gray-600 hover:bg-gray-100'}`}>▶</button>
              </div>
            )}
            <Toggle options={[['today', '오늘'], ['week', '7일'], ['month', '30일']]} value={revRange} onChange={v => setRevRange(v as 'today' | 'week' | 'month')} />
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          {revRange === 'today' ? (
            <AreaChart data={stats.revenue_series} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e44232" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#e44232" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 10000 ? `${Math.round(v / 10000)}만` : `${v}`} />
              <Tooltip
                formatter={(v: number, name: string) => [won(v), name === 'cum_amount' ? '누적매출' : '매출']}
                labelFormatter={(l) => `${l}`}
              />
              <Area type="monotone" dataKey="cum_amount" stroke="#0074e9" fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
              <Area type="monotone" dataKey="amount" stroke="#e44232" fill="url(#rev)" strokeWidth={2} />
            </AreaChart>
          ) : (
            <AreaChart data={rangeRevenue} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revRange" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e44232" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#e44232" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={revRange === 'week' ? 0 : 2} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 10000 ? `${Math.round(v / 10000)}만` : `${v}`} />
              <Tooltip
                formatter={(v: number, name: string) => [won(v), name === 'cum_amount' ? '누적매출' : '매출']}
                labelFormatter={(l) => `${l}`}
              />
              <Area type="monotone" dataKey="cum_amount" stroke="#0074e9" fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
              <Area type="monotone" dataKey="amount" stroke="#e44232" fill="url(#revRange)" strokeWidth={2} />
            </AreaChart>
          )}
        </ResponsiveContainer>
        {revRange !== 'today' && (
          <div className="text-[11px] text-gray-400 mt-1 text-right">
            기간 합계 <b className="text-[#e44232]">{won(rangeRevenue.reduce((s, r) => s + r.amount, 0))}</b> · 실제 판매가 기준 실매출
          </div>
        )}
      </div>

      {/* 일간/주간/월간 베스트 상품 */}
      <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <BestList title="🥇 일간 베스트" sub="오늘" items={stats.best_daily} accent="#e44232" onClickItem={onBestClick} />
        <BestList title="🥈 주간 베스트" sub="최근 7일" items={stats.best_weekly} accent="#0074e9" onClickItem={onBestClick} />
        <BestList title="🥉 월간 베스트" sub="최근 30일" items={stats.best_monthly} accent="#16a34a" onClickItem={onBestClick} />
      </div>

      {/* 시간대별 판매 패턴 */}
      <div className="bg-white border rounded-lg p-3 lg:col-span-3">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <span className="text-sm font-bold">시간대별 {hourlyRange === 'today' ? '오늘' : `전체(${patternDays}일)`} {hourlyMetric === 'qty' ? '판매수량' : '판매금액'} 패턴 <span className="text-gray-400 font-normal">(어느 시간에 많이 팔리는지)</span></span>
          <div className="flex items-center gap-2 flex-wrap">
            {stats.peak_hour && hourlyRange === 'all' && <span className="text-xs font-bold text-[#e44232]">🔥 피크 {stats.peak_hour}</span>}
            <Toggle options={[['today', '오늘'], ['all', '전체']]} value={hourlyRange} onChange={v => setHourlyRange(v as 'today' | 'all')} />
            <Toggle options={[['qty', '수량'], ['amount', '금액']]} value={hourlyMetric} onChange={v => setHourlyMetric(v as 'qty' | 'amount')} />
            {hourlyRange === 'all' && <Toggle options={[[7, '7일'], [30, '30일']]} value={patternDays} onChange={v => onPatternDaysChange(v as 7 | 30)} />}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={stats.hourly_pattern} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} tickFormatter={(v) => hourlyMetric === 'amount' && v >= 10000 ? `${Math.round(v / 10000)}만` : `${v}`} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const d: any = payload[0].payload;
              return (
                <div className="bg-white border rounded shadow px-3 py-2 text-xs">
                  <div className="font-bold mb-1">{d.hour}대 {((d as any)[barKey] || 0) === barMax && barMax > 0 ? '🔥최다' : ''}</div>
                  <div className="text-[#e44232] font-semibold">
                    {hourlyRange === 'today' ? '오늘' : `전체(${patternDays}일)`} · {hourlyMetric === 'amount' ? won((d as any)[barKey]) : `${(d as any)[barKey]}개`}
                  </div>
                  <div className="mt-1 pt-1 border-t text-gray-600">
                    <div>오늘: <b className="text-[#e44232]">{d.today_qty}개</b> ({won(d.today_amount)})</div>
                    <div>7일: <b>{d.week_qty}개</b></div>
                    <div>30일: <b>{d.month_qty}개</b></div>
                  </div>
                </div>
              );
            }} />
            <Bar dataKey={barKey} radius={[3, 3, 0, 0]}>
              {stats.hourly_pattern.map((d, i) => (
                <Cell key={i} fill={((d as any)[barKey] || 0) === barMax && barMax > 0 ? '#e44232' : '#f9a8a0'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 시간대별 판매 상품 리스트 (선택일 · 시간 행 + 상품칩 줄바꿈) */}
      <div className="bg-white border rounded-lg p-3 lg:col-span-3">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <span className="text-sm font-bold">시간대별 판매 상품 <span className="text-gray-400 font-normal">({stats.view_date})</span></span>
          <span className="text-xs text-gray-400">위 그래프와 동일 날짜 · 시간마다 팔린 상품</span>
        </div>
        {stats.hourly_products.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center">{dateLabel} 판매 데이터 없음</div>
        ) : (
          <div className="divide-y">
            {stats.hourly_products.map(h => (
              <div key={h.hour} className="flex items-start gap-3 py-2">
                <div className="shrink-0 w-24 pt-0.5">
                  <div className="text-sm font-bold text-gray-700">{h.hour}</div>
                  <div className="text-[11px] text-gray-400">{h.total_qty}개 · {won(h.total_amount)}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {h.items.map((it, i) => (
                    <span key={i}
                      className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-xs"
                      style={{ borderColor: it.color }}
                      title={`${it.name} · ${it.qty}개 · ${won(it.amount)}`}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: it.color }} />
                      <span className="text-gray-700 max-w-[180px] truncate">{it.name}</span>
                      <b style={{ color: it.color }}>×{it.qty}</b>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 상품별 판매 추이 (일간 파이 / 주간·30일 누적막대) */}
      <div className="lg:col-span-3">
        <ProductTrend stats={stats} />
      </div>
    </div>
  );
}

// ── 토글 버튼 ──
function Toggle<T extends string | number>({ options, value, onChange }: {
  options: [T, string][]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md overflow-hidden border text-xs">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          onClick={() => onChange(v)}
          className={`px-3 py-1 font-semibold transition-colors ${
            value === v ? 'bg-[#e44232] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── 상품별 판매 추이 (탭: 일간/주간/30일) ──
function ProductTrend({ stats }: { stats: DashboardStats }) {
  const [tab, setTab] = useState<'day' | 'week' | 'month'>('day');
  const metas = stats.products_meta;
  const weekData = stats.product_daily.slice(-7);
  const monthData = stats.product_daily;

  return (
    <div className="bg-white border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className="text-sm font-bold">상품별 판매 추이</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-2">
            {metas.map(m => (
              <span key={m.name} className="inline-flex items-center gap-1 text-[11px] text-gray-600">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: m.color }} />{m.name}
              </span>
            ))}
          </div>
          <Toggle options={[['day', '일간'], ['week', '주간'], ['month', '최근30일']]} value={tab} onChange={v => setTab(v as any)} />
        </div>
      </div>

      {tab === 'day' && (
        stats.today_by_product.length === 0 ? (
          <div className="text-sm text-gray-400 py-12 text-center">오늘 판매 데이터 없음</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={stats.today_by_product} dataKey="qty" nameKey="name" cx="50%" cy="50%"
                innerRadius={55} outerRadius={95} paddingAngle={2}
                label={(e: any) => `${e.name} ${e.qty}개`} labelLine={false}>
                {stats.today_by_product.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(v: number, _n, e: any) => [`${v}개 / ${won(e?.payload?.amount ?? 0)}`, e?.payload?.name]} />
            </PieChart>
          </ResponsiveContainer>
        )
      )}

      {tab !== 'day' && (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={tab === 'week' ? weekData : monthData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={tab === 'week' ? 0 : 2} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip formatter={(v: number, n: string) => [`${v}개`, n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {metas.map(m => (
              <Bar key={m.name} dataKey={m.name} stackId="s" fill={m.color} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── 베스트 상품 랭킹 리스트 (상품별 + 이미지) ──
// ── 베스트 상품 30일 판매추이 + 주말/평일 비교 모달 ──
function ProductDailyModal({ product, accountId, onClose, initialTab = 'daily' }: {
  product: BestProduct; accountId: number; onClose: () => void; initialTab?: 'daily' | 'reviews';
}) {
  const [data, setData] = useState<ProductDailyResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'daily' | 'reviews'>(initialTab);
  const [reviews, setReviews] = useState<ProductReviewsResp | null>(null);
  useEffect(() => {
    setLoading(true);
    getProductDaily(product.product_key, accountId || undefined, 30)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
    getProductReviews(product.product_key).then(setReviews).catch(() => setReviews(null));
  }, [product.product_key, accountId]);

  const s = data?.summary;
  const verdictColor = s?.verdict === '주말형' ? '#e44232' : s?.verdict === '평일형' ? '#0074e9' : '#16a34a';
  const maxQty = Math.max(1, ...(data?.days || []).map(d => d.qty));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-bold text-lg">{product.product_name || '(상품명없음)'}</div>
            <div className="text-xs text-gray-400">노출ID {product.product_key} · 옵션 {product.option_count}개</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        {/* 탭 */}
        <div className="inline-flex rounded-md overflow-hidden border text-sm mb-3">
          <button onClick={() => setTab('daily')}
            className={`px-3 py-1 font-semibold ${tab === 'daily' ? 'bg-[#0074e9] text-white' : 'bg-white text-gray-500'}`}>📈 30일 판매추이</button>
          <button onClick={() => setTab('reviews')}
            className={`px-3 py-1 font-semibold ${tab === 'reviews' ? 'bg-[#0074e9] text-white' : 'bg-white text-gray-500'}`}>
            ⭐ 리뷰{reviews?.rated_count ? ` ${reviews.rated_count}` : (reviews?.count ? ` ${reviews.count}` : '')}
          </button>
        </div>

        {tab === 'reviews' ? (
          <ReviewSection reviews={reviews} productKey={product.product_key}
            onReloaded={() => getProductReviews(product.product_key).then(setReviews).catch(() => {})} />
        ) : loading ? (
          <div className="py-16 text-center text-gray-400 animate-pulse">불러오는 중...</div>
        ) : !data || !s ? (
          <div className="py-16 text-center text-gray-400">데이터 없음</div>
        ) : (
          <>
            {/* 주말 vs 평일 비교 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <div className="border rounded-lg px-3 py-2">
                <div className="text-[11px] text-gray-500">30일 총 판매</div>
                <div className="text-xl font-bold tabular-nums">{s.total}개</div>
                <div className="text-[11px] text-gray-400">일평균 {s.all_avg}개</div>
              </div>
              <div className="border rounded-lg px-3 py-2" style={{ borderColor: '#fecaca' }}>
                <div className="text-[11px] text-[#e44232] font-semibold">주말 일평균</div>
                <div className="text-xl font-bold tabular-nums text-[#e44232]">{s.weekend_avg}개</div>
                <div className="text-[11px] text-gray-400">{s.weekend_qty}개 / {s.weekend_days}일</div>
              </div>
              <div className="border rounded-lg px-3 py-2" style={{ borderColor: '#bfdbfe' }}>
                <div className="text-[11px] text-[#0074e9] font-semibold">평일 일평균</div>
                <div className="text-xl font-bold tabular-nums text-[#0074e9]">{s.weekday_avg}개</div>
                <div className="text-[11px] text-gray-400">{s.weekday_qty}개 / {s.weekday_days}일</div>
              </div>
              <div className="border rounded-lg px-3 py-2 flex flex-col justify-center" style={{ background: verdictColor + '11', borderColor: verdictColor + '55' }}>
                <div className="text-[11px] text-gray-500">판정</div>
                <div className="text-lg font-bold" style={{ color: verdictColor }}>
                  {s.verdict === '주말형' ? '🔴 주말에 잘팔림' : s.verdict === '평일형' ? '🔵 평일에 잘팔림' : '🟢 고르게 팔림'}
                </div>
                <div className="text-[11px] text-gray-500">{s.verdict !== '고른편' ? `${s.ratio}배 차이` : '주말≈평일'}</div>
              </div>
            </div>

            {/* 30일 일별 막대 (주말 빨강) */}
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.days} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="date" interval={0} tick={(props: any) => {
                  const d = data.days[props.index];
                  return <text x={props.x} y={props.y + 10} textAnchor="middle" fontSize={9}
                    fill={d?.is_weekend ? '#e44232' : '#94a3b8'} fontWeight={d?.is_weekend ? 700 : 400}
                    transform={`rotate(-60 ${props.x} ${props.y + 10})`}>{props.payload.value}</text>;
                }} height={40} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <ReferenceLine y={s.all_avg} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `평균 ${s.all_avg}`, fontSize: 10, fill: '#94a3b8', position: 'right' }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d: any = payload[0].payload;
                  return (
                    <div className="bg-white border rounded shadow px-3 py-2 text-xs">
                      <div className="font-bold" style={{ color: d.is_weekend ? '#e44232' : '#111' }}>
                        {d.full_date} ({d.weekday}){d.is_weekend ? ' 주말' : ''}
                      </div>
                      <div className="font-semibold">{d.qty}개 판매</div>
                    </div>
                  );
                }} />
                <Bar dataKey="qty" radius={[3, 3, 0, 0]} maxBarSize={22}>
                  {data.days.map((d, i) => (
                    <Cell key={i} fill={d.is_weekend ? '#e44232' : '#0074e9'} fillOpacity={d.qty === maxQty ? 1 : 0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="text-[11px] text-gray-400 text-center mt-1">파랑=평일 · 빨강=주말 · 점선=일평균</div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 쿠팡 리뷰 섹션 (평균별점 + 분포 + 목록) ──
function Stars({ n }: { n: number }) {
  const full = Math.round(n);
  return <span className="text-amber-400 tracking-tight">{'★'.repeat(full)}<span className="text-gray-200">{'★'.repeat(5 - full)}</span></span>;
}

function ReviewSection({ reviews, productKey, onReloaded }: {
  reviews: ProductReviewsResp | null; productKey: string; onReloaded: () => void;
}) {
  const [crawling, setCrawling] = useState(false);
  const [msg, setMsg] = useState('');
  const collect = async () => {
    setCrawling(true); setMsg('서버에서 수집 중... (Akamai 우회 uc, 30초~)');
    try {
      const resp = await startReviewCrawl(productKey);
      const reader = resp.body!.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const ln of lines) { if (!ln.trim()) continue; try { const ev = JSON.parse(ln); if (ev.t === 'log') setMsg(ev.m); } catch { /* */ } }
      }
      setMsg('✅ 수집 완료'); onReloaded();
    } catch (e: any) { setMsg(`❌ ${e?.message || e}`); }
    finally { setCrawling(false); }
  };
  const collectBtn = (
    <button onClick={collect} disabled={crawling}
      className="px-3 py-1 rounded bg-amber-500 text-white text-xs font-bold disabled:opacity-50">
      {crawling ? '수집 중...' : '🔄 서버에서 리뷰 수집'}
    </button>
  );

  if (!reviews) return <div className="py-16 text-center text-gray-400 animate-pulse">리뷰 불러오는 중...</div>;
  if (!reviews.count && !reviews.rated_count) {
    return (
      <div className="py-12 text-center text-gray-400">
        수집된 리뷰가 없습니다.<br />
        <div className="my-3">{collectBtn}</div>
        {msg && <div className="text-[11px] text-gray-500">{msg}</div>}
      </div>
    );
  }
  const max = Math.max(1, ...Object.values(reviews.dist));
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {collectBtn}
        {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
      </div>
      {/* 요약: 평균 별점 + 분포 */}
      <div className="flex items-center gap-6 mb-4 flex-wrap border rounded-lg p-3 bg-amber-50/40">
        <div className="text-center">
          <div className="text-4xl font-bold text-amber-500 tabular-nums">{reviews.avg}</div>
          <Stars n={reviews.avg} />
          <div className="text-[11px] text-gray-500 mt-0.5">{reviews.rated_count ?? reviews.count}개 별점</div>
        </div>
        <div className="flex-1 min-w-[200px] space-y-1">
          {[5, 4, 3, 2, 1].map(star => {
            const c = reviews.dist[String(star)] || 0;
            return (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="w-7 text-gray-500">{star}점</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${c / max * 100}%` }} />
                </div>
                <span className="w-8 text-right text-gray-500 tabular-nums">{c}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 리뷰 목록 (내용 있는 것만, 최근순) */}
      <div className="text-xs font-semibold text-gray-600 mb-1">📝 내용 리뷰 {reviews.count}건 <span className="text-gray-400 font-normal">(최근순 · 별점만인 건 제외)</span></div>
      <div className="space-y-2 max-h-[44vh] overflow-auto pr-1">
        {reviews.reviews.length === 0 && <div className="text-gray-400 text-sm py-6 text-center">내용 있는 리뷰가 없습니다 (별점만 있음)</div>}
        {reviews.reviews.map((r, i) => (
          <div key={i} className="border rounded-lg p-2.5">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <Stars n={r.rating || 0} />
              <span className="text-sm font-semibold">{r.rating ?? '-'}</span>
              {r.headline && <span className="text-sm font-medium text-gray-800">{r.headline}</span>}
              <span className="ml-auto text-[11px] text-gray-400">{r.reviewer} · {r.review_date}</span>
            </div>
            {r.content && <div className="text-sm text-gray-600 whitespace-pre-line">{r.content}</div>}
            {r.helpful_count > 0 && <div className="text-[11px] text-gray-400 mt-1">👍 도움돼요 {r.helpful_count}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict, ratio }: { verdict?: string; ratio?: number }) {
  if (!verdict || verdict === '고른편') return null;
  const isWeekend = verdict === '주말형';
  return (
    <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle"
      style={{ background: isWeekend ? '#fee2e2' : '#dbeafe', color: isWeekend ? '#e44232' : '#0074e9' }}
      title={`${verdict} (${ratio}배 차이)`}>
      {isWeekend ? '주말형' : '평일형'}{ratio && ratio >= 1.5 ? ` ${ratio}x` : ''}
    </span>
  );
}

function BestList({ title, sub, items, accent, onClickItem }: {
  title: string; sub: string; items: BestProduct[]; accent: string; onClickItem?: (b: BestProduct) => void;
}) {
  const qtyOf = (b: BestProduct) => sub === '오늘' ? b.today_qty : sub === '최근 7일' ? b.week_qty : b.month_qty;
  return (
    <div className="bg-white border rounded-lg p-3" style={{ borderTopColor: accent, borderTopWidth: 3 }}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-bold">{title}</span>
        <span className="text-[11px] text-gray-400">{sub} · 클릭→30일추이</span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 py-4 text-center">판매 데이터 없음</div>
      ) : (
        <ol className="space-y-1.5">
          {items.map((b, i) => (
            <li key={b.product_key} onClick={() => onClickItem?.(b)}
              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1">
              <span className={`w-4 text-center font-bold ${i === 0 ? 'text-[#e44232]' : 'text-gray-400'}`}>{i + 1}</span>
              {b.image_id != null ? (
                <img src={productImageUrl(b.image_id)} alt="" className="w-8 h-8 object-cover rounded border shrink-0" />
              ) : (
                <span className="w-8 h-8 rounded border bg-gray-50 shrink-0 flex items-center justify-center text-gray-300 text-[9px]">없음</span>
              )}
              <span className="flex-1 truncate">
                <span className="font-medium">{b.product_name || '(상품명없음)'}</span>
                <VerdictBadge verdict={b.verdict} ratio={b.ratio} />
                <span className="text-gray-400 text-[11px]"> · 옵션 {b.option_count}</span>
              </span>
              <span className="font-bold tabular-nums" style={{ color: accent }}>{qtyOf(b)}개</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Card({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div className="bg-white border rounded-lg p-3 flex flex-col gap-1" style={{ borderTopColor: accent, borderTopWidth: 3 }}>
      <div className="text-xs text-gray-500 font-semibold">{title}</div>
      {children}
    </div>
  );
}

// ── 상품 상세 히스토리 패널 (행 확장) ──
function ProductHistoryPanel({ loading, history, product, onChanged }: {
  loading: boolean; history: ProductHistory | null; product: CoupangRocketProduct; onChanged: () => void;
}) {
  if (loading || !history) {
    return <div className="text-sm text-gray-400 py-6 text-center animate-pulse">그래프 불러오는 중...</div>;
  }
  const title = `${product.product_name || ''} ${product.option_name || product.vendor_item_id}`.trim();
  return (
    <div>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <span className="text-sm font-bold">{title}</span>
        <span className="text-xs text-gray-500">최근 30일 · 총 판매 {history.total_sold}개</span>
        <span className="text-xs text-gray-500">현재가 {won(product.last_price ?? 0)} · 재고 {product.last_stock ?? '-'}</span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* 판매량 + 가격 복합 그래프 */}
        <div className="xl:col-span-2 bg-white border rounded-lg p-2">
          <div className="text-xs font-semibold text-gray-600 mb-1 px-1">일별 판매량(막대) + 판매가 변동(선)</div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={history.series} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={2} />
              <YAxis yAxisId="qty" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10 }}
                domain={['dataMin - 500', 'dataMax + 500']}
                tickFormatter={(v) => v >= 10000 ? `${(v / 10000).toFixed(1)}만` : `${v}`} />
              <Tooltip formatter={(v: number, n: string) => n === '판매가' ? [won(v), n] : [`${v}개`, n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {history.restocks.map(r => {
                const lbl = r.restock_date.slice(5).replace('-', '-'); // MM-DD
                return (
                  <ReferenceLine key={r.id} yAxisId="qty" x={lbl} stroke="#0074e9" strokeDasharray="3 3"
                    label={{ value: `📦+${r.quantity}`, position: 'top', fontSize: 9, fill: '#0074e9' }} />
                );
              })}
              <Bar yAxisId="qty" dataKey="sold" name="판매량" fill="#e44232" radius={[3, 3, 0, 0]} barSize={14} />
              <Line yAxisId="price" type="stepAfter" dataKey="price" name="판매가" stroke="#0074e9" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* 가격 변동 이력 */}
        <div className="bg-white border rounded-lg p-2 flex flex-col">
          <div className="text-xs font-semibold text-gray-600 mb-1 px-1">💲 가격 변동 이력</div>
          {history.price_changes.length === 0 ? (
            <div className="text-xs text-gray-400 py-6 text-center flex-1">가격 변동 없음</div>
          ) : (
            <div className="overflow-auto max-h-[210px]">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0"><tr>
                  <th className="px-2 py-1 text-left">변경시각</th>
                  <th className="px-2 py-1 text-right">변경 전</th>
                  <th className="px-2 py-1 text-right">변경 후</th>
                </tr></thead>
                <tbody>
                  {history.price_changes.map((c, i) => {
                    const up = (c.new_price ?? 0) > (c.old_price ?? 0);
                    return (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{c.changed_at}</td>
                        <td className="px-2 py-1 text-right text-gray-400 line-through">{won(c.old_price ?? 0)}</td>
                        <td className={`px-2 py-1 text-right font-bold ${up ? 'text-red-500' : 'text-blue-600'}`}>
                          {up ? '▲' : '▼'} {won(c.new_price ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 입고 관리 */}
      <RestockSection product={product} restocks={history.restocks} totalRestock={history.total_restock} onChanged={onChanged} />
    </div>
  );
}

// ── 입고 등록 + 이력 ──
function RestockSection({ product, restocks, totalRestock, onChanged }: {
  product: CoupangRocketProduct; restocks: ProductHistory['restocks']; totalRestock: number; onChanged: () => void;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayStr);
  const [qty, setQty] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    const q = parseInt(qty, 10);
    if (!date) { setErr('입고일자 입력'); return; }
    if (!q) { setErr('입고수량 입력'); return; }
    setBusy(true);
    try {
      await addRestock(product.id, { restock_date: date, quantity: q, memo });
      setQty(''); setMemo('');
      onChanged();
    } catch (e: any) {
      setErr(e?.response?.data?.error || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDel = async (id: number) => {
    if (!confirm('이 입고 이력을 삭제할까요? (재고 시계열도 재계산됩니다)')) return;
    await deleteRestock(id);
    onChanged();
  };

  return (
    <div className="mt-3 bg-white border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-600">📦 입고 등록</span>
        <span className="text-[11px] text-gray-400">누적 입고 {totalRestock.toLocaleString()}개 · 향후 쿠팡 입고API 자동연동 예정</span>
      </div>
      <div className="flex items-end gap-2 flex-wrap mb-2">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">입고일자</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">입고수량</label>
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="개수" className="border rounded px-2 py-1 text-sm w-24" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">메모(선택)</label>
          <input value={memo} onChange={e => setMemo(e.target.value)} className="border rounded px-2 py-1 text-sm w-48" />
        </div>
        <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-50">
          {busy ? '등록 중...' : '입고 등록'}
        </button>
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>
      {restocks.length > 0 && (
        <table className="w-full text-xs mt-1">
          <thead className="bg-gray-50"><tr>
            <th className="px-2 py-1 text-left">입고일자</th>
            <th className="px-2 py-1 text-right">수량</th>
            <th className="px-2 py-1 text-left">구분</th>
            <th className="px-2 py-1 text-left">메모</th>
            <th className="px-2 py-1 text-center">삭제</th>
          </tr></thead>
          <tbody>
            {restocks.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-2 py-1">{r.restock_date}</td>
                <td className="px-2 py-1 text-right font-bold text-[#0074e9]">+{r.quantity}</td>
                <td className="px-2 py-1">{r.source === 'coupang' ? '쿠팡자동' : '수동'}</td>
                <td className="px-2 py-1 text-gray-500">{r.memo || '-'}</td>
                <td className="px-2 py-1 text-center">
                  <button onClick={() => onDel(r.id)} className="text-red-400 hover:underline">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── 로켓그로스 뱃지 ──
function RocketGrowthBadge({ small }: { small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold text-white shadow-sm ${
        small ? 'px-1.5 py-[1px] text-[9px]' : 'px-2.5 py-1 text-xs'
      }`}
      style={{ background: 'linear-gradient(135deg,#0074e9 0%,#00b2e3 100%)' }}
      title="쿠팡 로켓그로스 (Rocket Growth)"
    >
      <svg width={small ? 9 : 12} height={small ? 9 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
      로켓그로스
    </span>
  );
}

// ── 인라인 편집 셀 ──
function EditableCell({ value, placeholder, mono, startOpen, onSave }: {
  value: string; placeholder?: string; mono?: boolean; startOpen?: boolean; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(!!startOpen);
  const [val, setVal] = useState(value);
  useEffect(() => { setVal(value); }, [value]);

  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { setEditing(false); onSave(val.trim()); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.currentTarget.blur(); }
          if (e.key === 'Escape') { setVal(value); setEditing(false); }
        }}
        className={`border rounded px-1 py-0.5 text-sm w-full ${mono ? 'font-mono' : ''}`}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer hover:bg-yellow-50 rounded px-1 -mx-1 block min-h-[20px] ${mono ? 'font-mono' : ''} ${value ? '' : 'text-gray-300'}`}
      title="클릭하여 편집"
    >
      {value || placeholder || '-'}
    </span>
  );
}

// ── 옵션 추가 폼 ──
function AddProductForm({ accounts, onAdded }: { accounts: CoupangApiAccount[]; onAdded: () => void }) {
  const [accountId, setAccountId] = useState<number>(0);
  const [vid, setVid] = useState('');
  const [spid, setSpid] = useState('');
  const [name, setName] = useState('');
  const [optName, setOptName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  const submit = async () => {
    setErr('');
    if (!accountId) { setErr('먼저 API 계정을 등록하세요'); return; }
    if (!vid.trim()) { setErr('옵션ID 입력'); return; }
    setBusy(true);
    try {
      const r = await createProduct({ account_id: accountId, vendor_item_id: vid.trim(), seller_product_id: spid.trim(), product_name: name, option_name: optName, barcode });
      if (r.check_error) setErr(`등록됨(조회실패): ${r.check_error}`);
      setVid(''); setSpid(''); setName(''); setOptName(''); setBarcode('');
      onAdded();
    } catch (e: any) {
      setErr(e?.response?.data?.error || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border rounded p-3 mb-4 flex items-end gap-2 flex-wrap">
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">계정</label>
        <select value={accountId} onChange={e => setAccountId(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
          {accounts.map(a => <option key={a.id} value={a.id}>{a.cupang_id}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">옵션ID (vendorItemId) *</label>
        <input value={vid} onChange={e => setVid(e.target.value)} placeholder="숫자" className="border rounded px-2 py-1 text-sm w-40 font-mono" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">노출상품ID(선택)</label>
        <input value={spid} onChange={e => setSpid(e.target.value)} placeholder="숫자" className="border rounded px-2 py-1 text-sm w-36 font-mono" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">상품명(선택)</label>
        <input value={name} onChange={e => setName(e.target.value)} className="border rounded px-2 py-1 text-sm w-44" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">옵션명(선택)</label>
        <input value={optName} onChange={e => setOptName(e.target.value)} placeholder="예: 그린 3개" className="border rounded px-2 py-1 text-sm w-32" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-0.5">바코드(선택)</label>
        <input value={barcode} onChange={e => setBarcode(e.target.value)} className="border rounded px-2 py-1 text-sm w-32" />
      </div>
      <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
        {busy ? '추가 중...' : '옵션 추가'}
      </button>
      {err && <span className="text-xs text-red-500">{err}</span>}
    </div>
  );
}

// ── API 키 설정 패널 ──
// ── 자동점검 주기 설정 ──
function IntervalSetting() {
  const [interval, setInterval] = useState<number>(10);
  const [allowed, setAllowed] = useState<number[]>([5, 10, 15, 20, 30]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfig().then(c => { setInterval(c.check_interval_min); setAllowed(c.allowed_intervals); }).catch(() => {});
  }, []);

  const onSave = async (v: number) => {
    setInterval(v);
    setSaving(true); setSaved(false);
    try {
      await saveConfig(v);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 mb-4 pb-3 border-b">
      <h3 className="font-bold text-sm">⏱ 자동점검 주기</h3>
      <select
        value={interval}
        onChange={e => onSave(Number(e.target.value))}
        disabled={saving}
        className="border rounded px-2 py-1 text-sm font-semibold"
      >
        {allowed.map(m => <option key={m} value={m}>{m}분마다</option>)}
      </select>
      <span className="text-xs text-gray-400">선택 시 자동 저장 (crontab 자동 반영)</span>
      {saving && <span className="text-xs text-gray-400 animate-pulse">저장 중...</span>}
      {saved && <span className="text-xs text-green-600 font-semibold">✓ 저장됨</span>}
    </div>
  );
}

// 입고 완료(매칭) 팝업 — 오늘 자동입고된 건을 이미지+수량+시간으로 표시. "확인" 시 당일 다시 안 봄.
// ── 리뷰 증가 리포트 팝업 (일일 크롤 후 직전 대비 증가) · "오늘 하루 안보기" ──
function ReviewIncreasePopup() {
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => { getReviewReport().then(setReport).catch(() => {}); }, []);
  if (closed || !report || !report.products?.length) return null;
  // 같은 날짜 리포트를 "오늘 하루 안보기" 했으면 숨김
  const dismissKey = `review-report-dismiss-${report.date}`;
  if (localStorage.getItem(dismissKey)) return null;
  const dismiss = () => { localStorage.setItem(dismissKey, '1'); setClosed(true); };
  return (
    <div className="fixed bottom-4 left-4 z-40 w-[380px] bg-white border-2 border-amber-400 rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500 text-white">
        <span className="font-bold">⭐ 새 리뷰 +{report.total_increase}건</span>
        <span className="text-[11px] opacity-90">{report.date}</span>
        <button onClick={() => setClosed(true)} className="ml-auto text-white/80 hover:text-white">✕</button>
      </div>
      <div className="max-h-[280px] overflow-auto divide-y">
        {report.products.map((p, i) => (
          <div key={i} className="px-3 py-2 text-sm flex items-center gap-2">
            <span className="flex-1 truncate font-medium">{p.product_name}</span>
            <span className="text-emerald-600 font-bold whitespace-nowrap">+{p.increase}</span>
            <span className="text-gray-400 text-[11px] whitespace-nowrap">총 {p.total}</span>
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 bg-amber-50 flex items-center">
        <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
          <input type="checkbox" onChange={(e) => { if (e.target.checked) dismiss(); }} /> 오늘 하루 안보기
        </label>
      </div>
    </div>
  );
}

// ── 입고필요 팝업 (현재고 < 1달판매 AND 선입고 미등록) ──
function RestockNeededPopup({ items }: { items: NonNullable<DashboardStats['restock_needed']> }) {
  const [closed, setClosed] = useState(false);
  if (closed || !items.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[360px] bg-white border-2 border-orange-400 rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-orange-500 text-white">
        <span className="font-bold">📦 입고 필요 {items.length}건</span>
        <span className="text-[11px] opacity-90">현재고 &lt; 1달 판매량</span>
        <button onClick={() => setClosed(true)} className="ml-auto text-white/80 hover:text-white">✕</button>
      </div>
      <div className="max-h-[300px] overflow-auto divide-y">
        {items.map((o, i) => (
          <div key={i} className="px-3 py-2 text-sm flex items-center gap-2">
            <span className="flex-1 truncate">
              <span className="font-medium">{o.product_name}</span>
              <span className="text-gray-400 text-[11px]"> · {o.option_name}</span>
            </span>
            <span className="text-right whitespace-nowrap">
              <span className="text-red-600 font-bold">{o.last_stock ?? 0}</span>
              <span className="text-gray-400 text-[11px]"> / 월{o.month_qty}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 text-[11px] text-gray-500 bg-orange-50">
        선입고(예정) 등록하면 목록에서 빠집니다.
      </div>
    </div>
  );
}

function RestockArrivedPopup() {
  const [items, setItems] = useState<ExpectedRestock[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    getExpectedRestocks().then(d => {
      const matched = d.rows.filter(r =>
        r.status === 'matched' && r.matched_at && r.matched_at.slice(0, 10) === today
        && localStorage.getItem(`rg_restock_seen_${r.id}_${today}`) !== '1');
      setItems(matched);
    }).catch(() => {});
  }, []);

  if (items.length === 0 || idx >= items.length) return null;
  const r = items[idx];
  const isFirst = (r.memo || '').includes('첫입고');
  const today = new Date().toISOString().slice(0, 10);
  const dismiss = () => {
    localStorage.setItem(`rg_restock_seen_${r.id}_${today}`, '1');
    setIdx(i => i + 1);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={dismiss}>
      <div className="bg-white rounded-xl shadow-2xl w-[400px] max-w-[92vw] p-6 text-center" onClick={e => e.stopPropagation()}>
        <div className="text-2xl mb-1">{isFirst ? '🎉 첫입고됨!' : '📦 입고 완료!'}</div>
        <div className="text-xs text-gray-400 mb-3">{isFirst ? '로켓 물류센터에 처음 입고되었습니다' : '예정했던 상품이 입고되었습니다'} {items.length > 1 ? `(${idx + 1}/${items.length})` : ''}</div>
        {r.has_image && r.product_id
          ? <img src={productImageUrl(r.product_id)} alt="" className="w-28 h-28 object-cover rounded-lg border mx-auto mb-3" />
          : <div className="w-28 h-28 bg-gray-100 rounded-lg mx-auto mb-3 flex items-center justify-center text-gray-300 text-4xl">📦</div>}
        <div className="font-bold text-base">{r.product_name}</div>
        <div className="text-sm text-gray-500 mb-3">{r.option_name}</div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
          <div className="text-3xl font-extrabold text-emerald-600">{(r.matched_qty ?? 0).toLocaleString()}개</div>
          <div className="text-xs text-gray-500 mt-1">입고 시각: <b>{r.matched_at}</b></div>
          {r.matched_qty != null && r.matched_qty < r.expected_quantity && (
            <div className="text-[11px] text-amber-600 mt-1">예정 {r.expected_quantity}개 중 {r.matched_qty}개 입고</div>
          )}
        </div>
        <button onClick={dismiss} className="w-full px-4 py-2 rounded-lg bg-[#0074e9] text-white text-sm font-semibold">확인 (오늘 다시 안 봄)</button>
      </div>
    </div>
  );
}

// 총입고 클릭 → 입고 날짜·수량 모달
function RestockDetailModal({ productId, onClose }: { productId: number; onClose: () => void }) {
  const [data, setData] = useState<RestockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    getRestockDetail(productId).then(d => { if (alive) { setData(d); setLoading(false); } }).catch(() => setLoading(false));
    return () => { alive = false; };
  }, [productId]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-5 max-w-[460px] w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold">📦 입고 내역</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        {data && (
          <div className="text-sm text-gray-600 mb-3">
            {data.product_name} <span className="text-gray-400">{data.option_name}</span>
          </div>
        )}
        {loading ? (
          <div className="py-8 text-center text-gray-400">불러오는 중...</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-8 text-center text-gray-400">입고 내역이 없습니다</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-gray-600"><tr>
                <th className="px-2 py-1.5 text-left">입고일시</th>
                <th className="px-2 py-1.5 text-center">구분</th>
                <th className="px-2 py-1.5 text-right">수량</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1.5">{r.date}{r.time ? ` ${r.time}` : ''}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded ${r.source === '자동감지' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>{r.source}</span>
                      {r.memo && <div className="text-[10px] text-gray-400 mt-0.5">{r.memo}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-emerald-600">+{r.qty.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="px-2 py-1.5" colSpan={2}>총입고</td>
                  <td className="px-2 py-1.5 text-right text-emerald-700">{data.total.toLocaleString()}개</td>
                </tr>
              </tfoot>
            </table>
            <p className="text-[11px] text-gray-400 mt-2">※ 자동감지 = 등록한 입고예정 수량이 재고 증가로 확인된 건 (쿠팡 입고는 나눠 들어와 누적 합산)</p>
          </>
        )}
      </div>
    </div>
  );
}

// 입고 예정 등록/관리 모달 (옵션별)
function ExpectedRestockModal({ product, onClose, onChanged }: { product: CoupangRocketProduct; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<ExpectedRestock[]>([]);
  const [summary, setSummary] = useState<{ pending_qty: number; total_restock: number }>({ pending_qty: 0, total_restock: 0 });
  const [qty, setQty] = useState('');
  const [windowDays, setWindowDays] = useState(7);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await getExpectedRestocks(product.vendor_item_id);
    setRows(d.rows);
    setSummary(d.summary[product.vendor_item_id] || { pending_qty: 0, total_restock: 0 });
  }, [product.vendor_item_id]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const q = parseInt(qty.replace(/[^\d]/g, ''), 10);
    if (!q) return;
    setBusy(true);
    try { await registerExpectedRestock(product.vendor_item_id, q, windowDays); setQty(''); await load(); onChanged(); }
    finally { setBusy(false); }
  };
  const del = async (id: number) => { await deleteExpectedRestock(id); await load(); onChanged(); };

  const stBadge = (s: string) => {
    const m: Record<string, string> = { pending: 'bg-blue-100 text-blue-700', matched: 'bg-green-100 text-green-700', expired: 'bg-gray-200 text-gray-500' };
    const t: Record<string, string> = { pending: '대기중', matched: '입고확인', expired: '기간만료' };
    return <span className={`text-[10px] px-1.5 py-[1px] rounded font-bold ${m[s]}`}>{t[s] || s}</span>;
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[640px] max-w-[94vw] max-h-[85vh] flex flex-col p-5" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-bold text-base">📦 입고 예정 — {product.product_name} <span className="text-gray-500 font-normal">{product.option_name}</span></h3>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="flex gap-3 mb-3 text-sm">
          <span className="text-blue-600 font-semibold">입고예정 합계: {summary.pending_qty.toLocaleString()}</span>
          <span className="text-emerald-600 font-semibold">총입고 누적: {summary.total_restock.toLocaleString()}</span>
        </div>
        <div className="flex items-end gap-2 mb-3 bg-blue-50 border border-blue-200 rounded p-2">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">입고 예정수량</label>
            <input value={qty} onChange={e => setQty(e.target.value)} inputMode="numeric" placeholder="예: 300" className="border rounded px-2 py-1 text-sm w-28" onKeyDown={e => { if (e.key === 'Enter') add(); }} autoFocus />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">매칭 기간</label>
            <select value={windowDays} onChange={e => setWindowDays(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
              {[2, 3, 5, 7, 10, 14].map(d => <option key={d} value={d}>{d}일 내</option>)}
            </select>
          </div>
          <button onClick={add} disabled={busy} className="px-3 py-1.5 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-50">예정 등록</button>
          <span className="text-[11px] text-gray-500 ml-1">기간 내 재고가 예정수량에 근접하게(조금 작게~동일) 늘면 자동 "입고" 처리 + 입고일시 기록</span>
        </div>
        <div className="overflow-auto flex-1 border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-600 sticky top-0"><tr>
              <th className="px-2 py-1.5 text-right">예정수량</th>
              <th className="px-2 py-1.5 text-center">기간</th>
              <th className="px-2 py-1.5 text-center">상태</th>
              <th className="px-2 py-1.5 text-left">실제 입고일시</th>
              <th className="px-2 py-1.5 text-right">실제수량</th>
              <th className="px-2 py-1.5 text-left">등록일</th>
              <th className="px-2 py-1.5"></th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="px-2 py-1.5 text-right font-semibold">{r.expected_quantity.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-center text-xs text-gray-500">{r.window_days}일</td>
                  <td className="px-2 py-1.5 text-center">{stBadge(r.status)}</td>
                  <td className="px-2 py-1.5 text-xs text-green-700 font-semibold">{r.matched_at || '-'}</td>
                  <td className="px-2 py-1.5 text-right">{r.matched_qty != null ? r.matched_qty.toLocaleString() : '-'}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-400">{r.registered_at}</td>
                  <td className="px-2 py-1.5 text-center"><button onClick={() => del(r.id)} className="text-red-400 hover:underline text-xs">삭제</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-2 py-6 text-center text-gray-400">등록된 입고 예정이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 재고 증가(주문취소/입고) 내역 모달
function IncreaseEventsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<IncreaseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await getIncreaseEvents(undefined, days); setRows(d.rows); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (ev: IncreaseEvent, restock: boolean) => {
    if (ev.marked_restock === restock) return;
    setRows(rs => rs.map(r => r.id === ev.id ? { ...r, marked_restock: restock } : r));
    try { await setIncreaseKind(ev.id, restock); onChanged(); }
    catch { load(); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[760px] max-w-[95vw] max-h-[85vh] flex flex-col p-5" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold text-base">📥 재고 증가 내역 <span className="text-xs font-normal text-gray-500">(기본=주문취소, 입고면 "입고"로 변경)</span></h3>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="flex items-center gap-2 mb-2 text-sm">
          <span className="text-gray-500 text-xs">최근</span>
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="border rounded px-2 py-0.5 text-sm">
            {[7, 30, 90, 180].map(d => <option key={d} value={d}>{d}일</option>)}
          </select>
          {loading && <span className="text-xs text-gray-400 animate-pulse">불러오는 중...</span>}
          <span className="ml-auto text-xs text-gray-400">증가 = 재고가 늘어난 시점 (주문취소거나 입고)</span>
        </div>
        <div className="overflow-auto flex-1 border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-600 sticky top-0"><tr>
              <th className="px-2 py-1.5 text-left">시각</th>
              <th className="px-2 py-1.5 text-left">상품/옵션</th>
              <th className="px-2 py-1.5 text-right">증가량</th>
              <th className="px-2 py-1.5 text-center">재고변동</th>
              <th className="px-2 py-1.5 text-center">분류</th>
            </tr></thead>
            <tbody>
              {rows.map(ev => (
                <tr key={ev.id} className={`border-t ${ev.marked_restock ? 'bg-blue-50' : 'bg-amber-50/40'}`}>
                  <td className="px-2 py-1.5 whitespace-nowrap text-xs">{ev.checked_at}</td>
                  <td className="px-2 py-1.5 max-w-[240px] truncate" title={`${ev.product_name} ${ev.option_name}`}>
                    <span className="text-gray-700">{ev.product_name}</span> <span className="text-gray-400 text-xs">{ev.option_name}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-bold text-emerald-600">+{ev.delta}</td>
                  <td className="px-2 py-1.5 text-center text-xs text-gray-500">{ev.prev_stock}→{ev.stock}</td>
                  <td className="px-2 py-1.5 text-center">
                    <div className="inline-flex rounded overflow-hidden border text-xs">
                      <button onClick={() => toggle(ev, false)}
                        className={`px-2 py-1 font-semibold ${!ev.marked_restock ? 'bg-amber-500 text-white' : 'bg-white text-gray-500'}`}>주문취소</button>
                      <button onClick={() => toggle(ev, true)}
                        className={`px-2 py-1 font-semibold ${ev.marked_restock ? 'bg-[#0074e9] text-white' : 'bg-white text-gray-500'}`}>입고</button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-2 py-8 text-center text-gray-400">{loading ? '불러오는 중...' : '재고 증가 내역이 없습니다.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-gray-400">분류를 바꾸면 해당 날짜의 판매량이 자동 재집계됩니다. (주문취소 = 순판매에서 차감 / 입고 = 판매 영향 없음)</div>
      </div>
    </div>
  );
}

function SettingsPanel({ accounts, onChange }: { accounts: CoupangApiAccount[]; onChange: () => void }) {
  const [cupangId, setCupangId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    setBusy(true);
    try {
      await createAccount({ cupang_id: cupangId.trim(), vendor_id: vendorId.trim(), access_key: accessKey.trim(), secret_key: secretKey.trim() });
      setCupangId(''); setVendorId(''); setAccessKey(''); setSecretKey('');
      onChange();
    } catch (e: any) {
      setErr(e?.response?.data?.error || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDel = async (id: number, name: string) => {
    if (!confirm(`계정 ${name} 삭제? (등록된 옵션도 함께 삭제됩니다)`)) return;
    await deleteAccount(id);
    onChange();
  };

  return (
    <div className="bg-gray-50 border rounded p-4 mb-4">
      <IntervalSetting />
      <h3 className="font-bold mb-2 text-sm">쿠팡 Open API 키 등록</h3>
      <p className="text-xs text-gray-500 mb-3">WING → 판매자정보/Open API 에서 발급. secret-key는 암호화 저장되며 다시 표시되지 않습니다.</p>
      <div className="flex items-end gap-2 flex-wrap mb-3">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">쿠팡ID(식별자) *</label>
          <input value={cupangId} onChange={e => setCupangId(e.target.value)} placeholder="예: exansys" className="border rounded px-2 py-1 text-sm w-32" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">vendorId(선택)</label>
          <input value={vendorId} onChange={e => setVendorId(e.target.value)} placeholder="예: A00962985" className="border rounded px-2 py-1 text-sm w-32 font-mono" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">access-key *</label>
          <input value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder="UUID" className="border rounded px-2 py-1 text-sm w-72 font-mono" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">secret-key *</label>
          <input value={secretKey} onChange={e => setSecretKey(e.target.value)} type="password" placeholder="hex 40자" className="border rounded px-2 py-1 text-sm w-72 font-mono" />
        </div>
        <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded bg-green-600 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? '저장 중...' : '계정 저장'}
        </button>
      </div>
      {err && <div className="text-xs text-red-500 mb-2">{err}</div>}
      <table className="w-full text-sm">
        <thead className="bg-gray-100"><tr>
          <th className="px-2 py-1 text-left">쿠팡ID</th>
          <th className="px-2 py-1 text-left">vendorId</th>
          <th className="px-2 py-1 text-left">access-key</th>
          <th className="px-2 py-1 text-right">옵션수</th>
          <th className="px-2 py-1 text-center">관리</th>
        </tr></thead>
        <tbody>
          {accounts.map(a => (
            <tr key={a.id} className="border-t">
              <td className="px-2 py-1 font-semibold">{a.cupang_id}</td>
              <td className="px-2 py-1 font-mono">{a.vendor_id}</td>
              <td className="px-2 py-1 font-mono text-gray-400">{a.access_key}</td>
              <td className="px-2 py-1 text-right">{a.product_count}</td>
              <td className="px-2 py-1 text-center">
                <button onClick={() => onDel(a.id, a.cupang_id)} className="text-red-500 hover:underline text-xs">삭제</button>
              </td>
            </tr>
          ))}
          {accounts.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-gray-400">등록된 계정 없음</td></tr>}
        </tbody>
      </table>

      {/* 쿠팡 판매자(WING) 로그인 — 로켓그로스 정산 크롤링용 */}
      <div className="mt-5 pt-4 border-t">
        <h3 className="font-bold mb-1 text-sm">🔐 쿠팡 판매자(WING) 로그인</h3>
        <p className="text-xs text-gray-500 mb-3">로켓그로스 정산 크롤링에 사용. 비밀번호는 암호화 저장되며 다시 표시되지 않습니다.</p>
        {accounts.map(a => <WingLoginRow key={a.id} account={a} onChange={onChange} />)}
        {accounts.length === 0 && <div className="text-xs text-gray-400">먼저 위에서 쿠팡 계정을 등록하세요.</div>}
      </div>
    </div>
  );
}

function WingLoginRow({ account, onChange }: { account: CoupangApiAccount; onChange: () => void }) {
  const [loginId, setLoginId] = useState(account.wing_login_id || account.cupang_id);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const [authedAt, setAuthedAt] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const save = async () => {
    setErr(''); setBusy(true); setSaved(false);
    try {
      const form: { wing_login_id: string; wing_password?: string } = { wing_login_id: loginId.trim() };
      if (pw.trim()) form.wing_password = pw.trim();
      await updateAccount(account.id, form);
      setPw(''); setSaved(true); setTimeout(() => setSaved(false), 2000);
      onChange();
    } catch (e: any) {
      setErr(e?.response?.data?.error || String(e));
    } finally { setBusy(false); }
  };

  // 초기 인증완료 여부 조회
  useEffect(() => {
    wingAuthStatus(account.id).then(s => setAuthedAt(s.status === 'done' ? (s.authed_at || '') : null)).catch(() => {});
  }, [account.id]);

  return (
    <div className="mb-3 pb-3 border-b border-gray-200 last:border-0">
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">쿠팡ID</label>
          <span className="inline-block px-2 py-1 text-sm font-semibold bg-gray-100 rounded w-24">{account.cupang_id}</span>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">WING 로그인 ID</label>
          <input value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="판매자 로그인 ID" className="border rounded px-2 py-1 text-sm w-40" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">
            WING 비밀번호 {account.has_wing_password && <span className="text-green-600 font-semibold">● 등록됨</span>}
          </label>
          <input value={pw} onChange={e => setPw(e.target.value)} type="password" placeholder={account.has_wing_password ? '변경 시에만 입력' : '비밀번호'} className="border rounded px-2 py-1 text-sm w-44" />
        </div>
        <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded bg-gray-600 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? '저장 중...' : '비번 저장'}
        </button>
        {authedAt !== null ? (
          <button onClick={() => setModalOpen(true)} disabled={!account.has_wing_password}
            className="px-3 py-1.5 rounded bg-green-600 text-white text-sm font-semibold disabled:opacity-50"
            title={authedAt ? `인증 시각: ${authedAt} (클릭 시 재인증)` : ''}>
            ✅ 인증완료{authedAt ? ` (${authedAt})` : ''}
          </button>
        ) : (
          <button onClick={() => setModalOpen(true)} disabled={!account.has_wing_password}
            className="px-3 py-1.5 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-50">
            🔐 로그인 인증
          </button>
        )}
        {saved && <span className="text-xs text-green-600 font-semibold">✓ 저장됨</span>}
      </div>
      {!account.has_wing_password && <div className="mt-1 text-[11px] text-gray-400">먼저 비밀번호를 저장하면 로그인 인증을 할 수 있습니다.</div>}
      {err && <div className="mt-1 text-xs text-red-500">{err}</div>}

      {modalOpen && (
        <WingAuthModal
          account={account}
          onClose={() => setModalOpen(false)}
          onDone={(at) => { setAuthedAt(at || ''); onChange(); }}
          onFail={() => setAuthedAt(null)}
        />
      )}
    </div>
  );
}

// 쿠팡 WING 로그인 인증 모달 (2FA 문자 입력 + 엔터)
function WingAuthModal({ account, onClose, onDone, onFail }: {
  account: CoupangApiAccount; onClose: () => void; onDone: (at?: string) => void; onFail: () => void;
}) {
  const [auth, setAuth] = useState<WingAuthStatus>({ status: 'starting', log: [], error: '' });
  const [otp, setOtp] = useState('');
  const [retry, setRetry] = useState(0);

  // 모달 열리면(또는 다시시도) 인증 시작 + 폴링
  useEffect(() => {
    let alive = true;
    setAuth({ status: 'starting', log: [], error: '' });
    wingAuthStart(account.id).catch(() => {});
    const t = window.setInterval(async () => {
      try {
        const s = await wingAuthStatus(account.id);
        if (!alive) return;
        setAuth(s);
        if (s.status === 'done') { window.clearInterval(t); onDone(s.authed_at); }
        else if (s.status === 'error') { window.clearInterval(t); onFail(); }
      } catch { /* */ }
    }, 1500);
    return () => { alive = false; window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, retry]);

  const submitOtp = async () => {
    if (!otp.trim()) return;
    try {
      await wingAuthOtp(account.id, otp.trim());
      setOtp('');
      setAuth(a => ({ ...a, status: 'submitting' }));
    } catch { /* */ }
  };

  const st = auth.status;
  const lastLog = auth.log && auth.log.length ? auth.log[auth.log.length - 1] : '';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[460px] max-w-[92vw] p-5" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-base">🔐 쿠팡 로그인 인증 — {account.cupang_id}</h3>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>

        {/* 진행 상태 */}
        <div className="mb-3 text-sm">
          {st === 'starting' && <div className="text-blue-600 animate-pulse">로그인 시도 중...</div>}
          {st === 'submitting' && <div className="text-blue-600 animate-pulse">인증번호 확인 중...</div>}
          {st === 'need_otp' && <div className="text-amber-700 font-semibold">📩 문자로 받은 인증번호를 입력하세요.</div>}
          {st === 'done' && <div className="text-green-600 font-bold text-lg">✅ 인증 성공!</div>}
          {st === 'error' && <div className="text-red-600 font-semibold">⚠ 인증 실패: {auth.error}</div>}
          {lastLog && st !== 'done' && <div className="mt-1 text-[11px] text-gray-500 font-mono">{lastLog}</div>}
        </div>

        {/* 2FA 입력 */}
        {st === 'need_otp' && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded p-2 mb-3">
            <input value={otp} onChange={e => setOtp(e.target.value)} inputMode="numeric"
              placeholder="문자 인증번호" className="border rounded px-2 py-1.5 text-sm flex-1"
              onKeyDown={e => { if (e.key === 'Enter') submitOtp(); }} autoFocus />
            <button onClick={submitOtp} className="px-3 py-1.5 rounded bg-amber-500 text-white text-sm font-semibold whitespace-nowrap">제출 (Enter)</button>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {(st === 'done' || st === 'error') && (
            <button onClick={onClose} className="px-4 py-1.5 rounded bg-[#0074e9] text-white text-sm font-semibold">닫기</button>
          )}
          {st === 'error' && (
            <button onClick={() => setRetry(r => r + 1)}
              className="px-4 py-1.5 rounded bg-gray-600 text-white text-sm font-semibold">다시 시도</button>
          )}
        </div>
      </div>
    </div>
  );
}
