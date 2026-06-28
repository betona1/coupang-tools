import { useState, useEffect, useCallback, Fragment, type ReactNode } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line as RLine, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { getSettlements, syncSettlements, getRevenue, getReconcile, getRocketSettlements, syncRocketSettlements, getProductSettlement, getOptionSettlement, getUnifiedSettlement, getSettlementVerify, saveProductCostMap, uploadCoupangAd, startCoupangAdCrawl, startVidMapSync, getAdEfficiency, type SettlementRow, type RevenueRow, type ReconcileRow, type RocketSettlementRow, type ProductSettlementRow, type OptionSettlementRow, type UnifiedSettlementRow, type VerifyCheck, type AdEfficiencyResponse } from '../api/coupangRocketApi';
import { CoupangAccountSettings } from '../components/coupang/wingAuth';

const won = (n: number) => '₩' + (n || 0).toLocaleString();

// 최근 12개월 목록
function recentMonths(n = 12): string[] {
  const out: string[] = [];
  const d = new Date();
  let y = d.getFullYear(), m = d.getMonth() + 1;
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}

const STATUS_KR: Record<string, string> = { DONE: '지급완료', SUBJECT: '지급예정', CONFIRMED: '확정' };

export default function CoupangSettlementPage() {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [totals, setTotals] = useState({ count: 0, total_sale: 0, service_fee: 0, final_amount: 0 });
  const [ym, setYm] = useState('');         // '' = 전체
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getSettlements(undefined, ym || undefined);
      setRows(d.rows);
      setTotals(d.totals);
    } finally { setLoading(false); }
  }, [ym]);

  useEffect(() => { load(); }, [load]);

  const runSync = async (month?: string) => {
    setSyncing(true); setShowLog(true); setLogs(['정산 동기화 시작 (쿠팡 Open API)...']);
    try {
      const resp = await syncSettlements(undefined, month);
      const reader = resp.body!.getReader();
      const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split('\n'); buf = ls.pop() || '';
        for (const line of ls) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.t === 'log') setLogs(p => [...p, ev.m]);
            else if (ev.t === 'done') setLogs(p => [...p, `✅ 완료 — ${ev.saved}건 저장`]);
          } catch { /* */ }
        }
      }
      await load();
    } catch (e) { setLogs(p => [...p, `오류: ${e}`]); }
    finally { setSyncing(false); }
  };

  const statusBadge = (s: string) => {
    const done = s === 'DONE';
    return <span className={`px-1.5 py-[1px] text-[10px] rounded font-bold ${done ? 'bg-[#16a34a] text-white' : 'bg-amber-400 text-white'}`}>{STATUS_KR[s] || s}</span>;
  };

  const [view, setView] = useState<'settle' | 'revenue' | 'reconcile' | 'rocket' | 'product' | 'option' | 'unified' | 'adeff'>('unified');
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  return (
    <div className="p-4 max-w-[1800px] mx-auto">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h1 className="text-lg font-bold flex items-center gap-2 mr-2">
          <span className="text-[#0074e9]">●</span> 쿠팡 정산
        </h1>
        {/* 1단계: 일반정산 ↔ 로켓그로스 */}
        <div className="inline-flex rounded-lg overflow-hidden border-2 border-[#0074e9] text-sm">
          <button onClick={() => setView('settle')}
            className={`px-4 py-1.5 font-bold ${view !== 'rocket' ? 'bg-[#0074e9] text-white' : 'bg-white text-[#0074e9] hover:bg-blue-50'}`}>
            🏪 일반정산 <span className="text-[10px] font-normal opacity-80">판매자배송</span>
          </button>
          <button onClick={() => setView('rocket')}
            className={`px-4 py-1.5 font-bold ${view === 'rocket' ? 'bg-[#16a34a] text-white' : 'bg-white text-[#16a34a] hover:bg-green-50'}`}>
            🚀 로켓그로스
          </button>
        </div>
        <button onClick={() => setShowSettings(s => !s)}
          className={`px-3 py-1.5 rounded text-sm font-semibold border ${showSettings ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
          ⚙ 계정 설정
        </button>
        <button onClick={() => setShowGuide(true)}
          className="px-3 py-1.5 rounded text-sm font-bold border-2 border-[#0074e9] text-[#0074e9] bg-white hover:bg-blue-50 animate-none">
          📖 정산 가이드
        </button>
      </div>

      {showGuide && <SettlementGuideModal onClose={() => setShowGuide(false)} onGoTab={(t) => { setView(t); setShowGuide(false); }} />}

      {/* 2단계: 일반정산 서브탭 */}
      {view !== 'rocket' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="inline-flex rounded-md overflow-hidden border text-sm">
            {([['unified', '통합정산 🎯'], ['product', '상품별 정산 ⭐'], ['adeff', '광고효율 📊'], ['option', '옵션별 대조 🔬'], ['settle', '주차별 정산'], ['revenue', '주문별 매출'], ['reconcile', '매출대조']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)}
                className={`px-3 py-1 font-semibold ${view === k ? 'bg-[#0074e9] text-white' : 'bg-white text-gray-500 hover:bg-blue-50'}`}>{label}</button>
            ))}
          </div>
          {view === 'unified'
            ? <span className="text-[11px] text-gray-400">전 계정 · 확정정산(로켓+마켓플레이스 실수령) vs 대장(참고)</span>
            : view === 'product'
            ? <span className="text-[11px] text-gray-400">order 대장 · <b>전 사업자</b> · 상품별 정산·원가·이익</span>
            : view === 'adeff'
            ? <span className="text-[11px] text-gray-400">쿠팡 광고센터 수집데이터 · 계정·상품·일별 광고효율(ROAS/ACOS/CPC)</span>
            : view === 'option'
            ? <span className="text-[11px] text-gray-400">쿠팡 실제정산(API) ↔ 내 대장 · <b>노출상품ID</b> 기준 · <b>exansys</b>만</span>
            : <span className="text-[11px] text-gray-400">판매자배송 · Open API · <b>exansys</b>만</span>}
        </div>
      )}

      {showSettings && <CoupangAccountSettings />}

      {view === 'unified' && <UnifiedSettlementView />}
      {view === 'adeff' && <AdEfficiencyView />}
      {view === 'product' && <ProductSettlementView />}
      {view === 'option' && <OptionSettlementView />}
      {view === 'revenue' && <RevenueView />}
      {view === 'reconcile' && <ReconcileView />}
      {view === 'rocket' && <RocketSettlementView />}

      {view === 'settle' && (
      <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={ym} onChange={e => setYm(e.target.value)} className="border rounded px-2 py-1 text-sm">
          <option value="">전체 월</option>
          {recentMonths(12).map(m => <option key={m} value={m}>{m} 매출인식</option>)}
        </select>
        <button onClick={() => runSync(ym || undefined)} disabled={syncing}
          className="px-3 py-1 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-50">
          {syncing ? '동기화 중...' : '🔄 정산 동기화'}
        </button>
        {loading && <span className="text-xs text-gray-400 animate-pulse">불러오는 중...</span>}
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Card label="정산 건수" value={`${totals.count}건`} />
        <Card label="총 매출" value={won(totals.total_sale)} color="#0074e9" />
        <Card label="총 수수료" value={won(totals.service_fee)} color="#ef4444" />
        <Card label="최종 지급액 합계" value={won(totals.final_amount)} color="#16a34a" />
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-2 py-2 text-left">정산일(지급일)</th>
              <th className="px-2 py-2 text-center">유형</th>
              <th className="px-2 py-2 text-left">매출인식</th>
              <th className="px-2 py-2 text-left">인식기간</th>
              <th className="px-2 py-2 text-right">총매출</th>
              <th className="px-2 py-2 text-right">수수료</th>
              <th className="px-2 py-2 text-right">정산대상</th>
              <th className="px-2 py-2 text-right">공제</th>
              <th className="px-2 py-2 text-right">차주보류</th>
              <th className="px-2 py-2 text-right">최종지급액</th>
              <th className="px-2 py-2 text-center">상태</th>
              <th className="px-2 py-2 text-left">입금계좌</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t hover:bg-gray-50">
                <td className="px-2 py-1.5 whitespace-nowrap font-medium">{r.settlement_date}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`text-[10px] px-1.5 py-[1px] rounded ${r.settlement_type === 'RESERVE' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {r.settlement_type === 'RESERVE' ? '지급보류' : '주정산'}
                  </span>
                </td>
                <td className="px-2 py-1.5">{r.revenue_ym}</td>
                <td className="px-2 py-1.5 text-gray-500 text-xs whitespace-nowrap">{r.recognition_from}~{(r.recognition_to || '').slice(5)}</td>
                <td className="px-2 py-1.5 text-right">{r.total_sale.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-red-500">{r.service_fee.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-500">{r.settlement_target.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-400">{r.deduction_amount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-400">{r.last_amount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right font-bold text-[#16a34a]">{r.final_amount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center">{statusBadge(r.status)}</td>
                <td className="px-2 py-1.5 text-gray-500 text-xs whitespace-nowrap">{r.bank_name} {r.bank_account}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={12} className="px-2 py-8 text-center text-gray-400">정산 데이터가 없습니다. "🔄 정산 동기화"를 누르세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}

      {showLog && (
        <div className="fixed bottom-4 right-4 w-[440px] max-h-[50vh] bg-[#1a1a2e] text-gray-200 rounded-lg shadow-xl flex flex-col z-40">
          <div className="flex justify-between items-center px-3 py-2 border-b border-gray-700">
            <span className="text-sm font-semibold">정산 동기화 로그</span>
            <button onClick={() => setShowLog(false)} className="text-gray-400">×</button>
          </div>
          <div className="overflow-auto p-2 text-xs font-mono space-y-0.5">
            {logs.map((l, i) => <div key={i} className={l.includes('❌') ? 'text-red-400' : l.includes('✅') ? 'text-green-400' : ''}>{l}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 주문별 매출내역 (revenue-history, 실시간 API) ──
function RevenueView() {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 7 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [totals, setTotals] = useState({ count: 0, quantity: 0, sale_amount: 0, service_fee: 0, settlement_amount: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const run = async () => {
    setLoading(true); setErr('');
    try {
      const d = await getRevenue(from, to);
      if (d.error && !d.rows.length) setErr(d.error);
      setRows(d.rows); setTotals(d.totals);
    } catch (e: any) { setErr(e?.response?.data?.error || String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-sm text-gray-600">매출인식일</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <span>~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <button onClick={run} disabled={loading} className="px-3 py-1 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-50">
          {loading ? '조회 중...' : '조회'}
        </button>
        <span className="text-[11px] text-gray-400">실시간 쿠팡 Open API (vendorId 기반 주문/상품별)</span>
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <Card label="건수" value={`${totals.count}건`} />
        <Card label="수량" value={`${totals.quantity}개`} />
        <Card label="판매액" value={won(totals.sale_amount)} color="#0074e9" />
        <Card label="수수료" value={won(totals.service_fee)} color="#ef4444" />
        <Card label="정산액 합계" value={won(totals.settlement_amount)} color="#16a34a" />
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700"><tr>
            <th className="px-2 py-2 text-left">인식일</th>
            <th className="px-2 py-2 text-center">유형</th>
            <th className="px-2 py-2 text-left">상품명</th>
            <th className="px-2 py-2 text-left">SKU</th>
            <th className="px-2 py-2 text-right">수량</th>
            <th className="px-2 py-2 text-right">판매액</th>
            <th className="px-2 py-2 text-right">수수료</th>
            <th className="px-2 py-2 text-right">정산액</th>
            <th className="px-2 py-2 text-left">정산일</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t hover:bg-gray-50 ${r.sale_type === 'REFUND' ? 'bg-red-50' : ''}`}>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.recognition_date}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`text-[10px] px-1.5 py-[1px] rounded ${r.sale_type === 'REFUND' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>{r.sale_type === 'REFUND' ? '환불' : '판매'}</span>
                </td>
                <td className="px-2 py-1.5 max-w-[420px] truncate" title={r.product_name}>{r.product_name}</td>
                <td className="px-2 py-1.5 text-gray-400 text-xs">{r.sku || '-'}</td>
                <td className="px-2 py-1.5 text-right">{r.quantity}</td>
                <td className="px-2 py-1.5 text-right">{r.sale_amount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-red-500">{r.service_fee.toLocaleString()}<span className="text-[9px] text-gray-400 ml-0.5">{r.service_fee_ratio}%</span></td>
                <td className="px-2 py-1.5 text-right font-bold text-[#16a34a]">{r.settlement_amount.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-gray-500 text-xs whitespace-nowrap">{r.settlement_date}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-2 py-8 text-center text-gray-400">{loading ? '조회 중...' : '기간 선택 후 "조회"를 누르세요.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 정산↔order DB 매출 대조 ──
function ReconcileView() {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 7 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [rows, setRows] = useState<ReconcileRow[]>([]);
  const [totals, setTotals] = useState({ count: 0, matched: 0, mismatch: 0, db_missing: 0, coupang_settle: 0, order_settle: 0, order_returned: 0, diff: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);

  const run = async () => {
    setLoading(true); setErr('');
    try {
      const d = await getReconcile(from, to);
      if (d.error && !d.rows.length) setErr(d.error);
      setRows(d.rows); setTotals(d.totals);
    } catch (e: any) { setErr(e?.response?.data?.error || String(e)); }
    finally { setLoading(false); }
  };

  const statusBadge = (s: string) => {
    const m: Record<string, string> = { '일치': 'bg-green-100 text-green-700', '불일치': 'bg-red-100 text-red-600', 'DB없음': 'bg-amber-100 text-amber-700' };
    return <span className={`text-[10px] px-1.5 py-[1px] rounded font-bold ${m[s] || 'bg-gray-100 text-gray-500'}`}>{s}</span>;
  };

  const shown = onlyDiff ? rows.filter(r => r.status !== '일치') : rows;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-sm text-gray-600">매출인식일</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <span>~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <button onClick={run} disabled={loading} className="px-3 py-1 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-50">
          {loading ? '대조 중...' : '대조 실행'}
        </button>
        <label className="text-xs text-gray-600 flex items-center gap-1 ml-2">
          <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> 불일치만 보기
        </label>
        <span className="text-[11px] text-gray-400">쿠팡 정산(주문별 매출) ↔ order DB(06.쿠팡) 대조</span>
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
        <Card label="전체 주문" value={`${totals.count}건`} />
        <Card label="일치" value={`${totals.matched}건`} color="#16a34a" />
        <Card label="불일치" value={`${totals.mismatch}건`} color="#ef4444" />
        <Card label="DB없음" value={`${totals.db_missing}건`} color="#d97706" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Card label="쿠팡 정산액 합계" value={won(totals.coupang_settle)} color="#0074e9" />
        <Card label="DB 유효정산 (반품제외)" value={won(totals.order_settle)} color="#7c3aed" />
        <Card label="반품/취소 제외액" value={won(totals.order_returned || 0)} color="#d97706" />
        <Card label="차액 (쿠팡−DB)" value={won(totals.diff)} color={totals.diff === 0 ? '#16a34a' : '#ef4444'} />
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700"><tr>
            <th className="px-2 py-2 text-left">주문번호</th>
            <th className="px-2 py-2 text-left">인식일</th>
            <th className="px-2 py-2 text-left">상품명</th>
            <th className="px-2 py-2 text-right">수량</th>
            <th className="px-2 py-2 text-right">쿠팡 판매액</th>
            <th className="px-2 py-2 text-right">쿠팡 정산액</th>
            <th className="px-2 py-2 text-right">DB 정산액</th>
            <th className="px-2 py-2 text-right">반품제외</th>
            <th className="px-2 py-2 text-right">차액</th>
            <th className="px-2 py-2 text-center">DB 상태</th>
            <th className="px-2 py-2 text-center">대조</th>
          </tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className={`border-t hover:bg-gray-50 ${r.status === '불일치' ? 'bg-red-50' : r.status === 'DB없음' ? 'bg-amber-50' : ''}`}>
                <td className="px-2 py-1.5 whitespace-nowrap font-mono text-xs">{r.order_id}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-xs">{r.recognition_date}</td>
                <td className="px-2 py-1.5 max-w-[360px] truncate" title={r.product}>{r.product}</td>
                <td className="px-2 py-1.5 text-right">{r.qty}</td>
                <td className="px-2 py-1.5 text-right">{r.coupang_sale.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-[#0074e9]">{r.coupang_settle.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-[#7c3aed]">{r.order_settle == null ? '-' : r.order_settle.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-amber-600 text-xs">{r.order_returned ? `-${r.order_returned.toLocaleString()}` : ''}</td>
                <td className={`px-2 py-1.5 text-right font-bold ${r.diff && r.diff !== 0 ? 'text-red-500' : 'text-gray-400'}`}>{r.diff == null ? '-' : r.diff.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center text-gray-500 text-xs">{r.order_status || '-'}</td>
                <td className="px-2 py-1.5 text-center">{statusBadge(r.status)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={11} className="px-2 py-8 text-center text-gray-400">{loading ? '대조 중...' : '기간 선택 후 "대조 실행"을 누르세요.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 로켓그로스 정산현황 (WING 크롤링) ──
function RocketSettlementView() {
  const [rows, setRows] = useState<RocketSettlementRow[]>([]);
  const [totals, setTotals] = useState({ count: 0, final_amount: 0 });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [account, setAccount] = useState<string>('');   // '' = 전체
  const [progress, setProgress] = useState<{ total: number; done: number; saved: number; current: string }>({ total: 0, done: 0, saved: 0, current: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getRocketSettlements();  // 전체 계정
      setRows(d.rows); setTotals(d.totals);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 사업자별 집계 (있는 계정만)
  const perAccount: { id: string; name: string; count: number; total: number }[] = [];
  const _map: Record<string, { name: string; count: number; total: number }> = {};
  for (const r of rows) {
    const id = r.cupang_id || '-';
    if (!_map[id]) _map[id] = { name: r.account_name || id, count: 0, total: 0 };
    _map[id].count += 1; _map[id].total += r.final_amount || 0;
  }
  for (const id of Object.keys(_map)) perAccount.push({ id, ..._map[id] });
  perAccount.sort((a, b) => b.total - a.total);

  const shown = account ? rows.filter(r => r.cupang_id === account) : rows;

  const runSync = async () => {
    setSyncing(true); setShowLog(true); setLogs(['로켓그로스 정산현황 크롤링 시작 (전체 활성 계정, 쿠키 로그인)...']);
    setProgress({ total: 0, done: 0, saved: 0, current: '' });
    try {
      const resp = await syncRocketSettlements(undefined, 36);  // 전체 활성 계정
      const reader = resp.body!.getReader();
      const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split('\n'); buf = ls.pop() || '';
        for (const line of ls) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.t === 'log') {
              const m: string = ev.m;
              setLogs(p => [...p, m]);
              // 진행률 파싱
              const mt = m.match(/(\d+)개 계정/);
              if (mt) setProgress(p => ({ ...p, total: parseInt(mt[1], 10) }));
              const cur = m.match(/━━ \[([^\]]+)\] 시작/);
              if (cur) setProgress(p => ({ ...p, current: cur[1] }));
              const fin = m.match(/^[✅❌] \[([^\]]+)\]/);
              if (fin) setProgress(p => ({ ...p, done: p.done + 1 }));
              const sv = m.match(/✅ \[[^\]]+\] 저장 (\d+)건/);
              if (sv) setProgress(p => ({ ...p, saved: p.saved + parseInt(sv[1], 10) }));
            } else if (ev.t === 'done') {
              setLogs(p => [...p, `🎉 전체 완료 — 총 ${ev.saved}건 저장`]);
              setProgress(p => ({ ...p, current: '' }));
            }
          } catch { /* */ }
        }
      }
      await load();
    } catch (e) { setLogs(p => [...p, `오류: ${e}`]); }
    finally { setSyncing(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={runSync} disabled={syncing}
          className="px-3 py-1 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-50">
          {syncing ? '크롤링 중...' : '🔄 전체 정산현황 크롤링'}
        </button>
        <span className="text-gray-300">|</span>
        <span className="text-sm text-gray-600">사업자</span>
        <select value={account} onChange={e => { setAccount(e.target.value); setExpanded(null); }} className="border rounded px-2 py-1 text-sm font-semibold">
          <option value="">전체 ({perAccount.length}개 사업자)</option>
          {perAccount.map(p => <option key={p.id} value={p.id}>{p.name} ({p.count}건)</option>)}
        </select>
        {account && <button onClick={() => setAccount('')} className="text-xs text-blue-600 hover:underline">전체보기</button>}
        {loading && <span className="text-xs text-gray-400 animate-pulse">불러오는 중...</span>}
      </div>

      {/* 진행률 바 + 실행상태 + 로그 (11번가 스타일) */}
      {(syncing || showLog) && (
        <div className="border rounded-lg mb-4 overflow-hidden">
          <div className="bg-[#f0f9ff] px-4 py-2 border-b">
            <div className="flex items-center gap-2 text-xs mb-1">
              {progress.total > 0 ? (
                <>
                  <span className="text-blue-600 font-bold">{progress.done} / {progress.total} 계정 완료</span>
                  <span className="text-gray-400">({Math.round(progress.done / progress.total * 100)}%)</span>
                  <span className="text-emerald-600 font-semibold">· 저장 {progress.saved}건</span>
                  {syncing && progress.current && <span className="text-gray-500 ml-auto animate-pulse">▶ {progress.current} 처리 중...</span>}
                  {!syncing && <span className="text-green-600 font-bold ml-auto">✓ 완료</span>}
                </>
              ) : (
                <span className="text-blue-600 font-semibold animate-pulse">{syncing ? '크롤링 준비 중...' : '대기'}</span>
              )}
            </div>
            <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300"
                style={{
                  width: progress.total > 0 ? `${progress.done / progress.total * 100}%` : (syncing ? '15%' : '0%'),
                  background: 'linear-gradient(90deg,#3b82f6,#2563eb)',
                }} />
            </div>
          </div>
          {/* 실행 로그 */}
          <div className="bg-[#1a1a2e] text-gray-200 px-3 py-2 max-h-44 overflow-auto text-[11px] font-mono space-y-0.5">
            {logs.slice(-120).map((l, i) => (
              <div key={i} className={l.includes('❌') ? 'text-red-400' : l.includes('✅') || l.includes('🎉') ? 'text-green-400' : l.includes('━━') ? 'text-blue-300' : 'text-gray-300'}>{l}</div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
        <Card label={account ? '정산 건수(사업자)' : '정산 건수(전체)'} value={`${shown.length}건`} />
        <Card label="최종지급액 합계" value={won(shown.reduce((s, r) => s + (r.final_amount || 0), 0))} color="#16a34a" />
        <Card label="최근 동기화" value={rows[0]?.synced_at || '-'} />
      </div>

      {/* 사업자별 요약 (클릭 시 해당 사업자로 필터/정렬) */}
      {!account && perAccount.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {perAccount.map(p => (
            <button key={p.id} onClick={() => { setAccount(p.id); setExpanded(null); }}
              className="border rounded-lg px-3 py-1.5 text-left hover:bg-blue-50 hover:border-blue-300">
              <div className="text-xs font-semibold text-[#0074e9]">{p.name}</div>
              <div className="text-[11px] text-gray-500">{p.count}건 · <span className="text-[#16a34a] font-bold">{won(p.total)}</span></div>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700"><tr>
            <th className="px-2 py-2 text-left">쿠팡ID</th>
            <th className="px-2 py-2 text-left">정산일(지급일)</th>
            <th className="px-2 py-2 text-center">정산유형</th>
            <th className="px-2 py-2 text-right">지급비율</th>
            <th className="px-2 py-2 text-left">매출인식 기간</th>
            <th className="px-2 py-2 text-right">매출(A)</th>
            <th className="px-2 py-2 text-right">수수료(B)</th>
            <th className="px-2 py-2 text-right">풀필먼트(J)</th>
            <th className="px-2 py-2 text-right">최종지급액</th>
            <th className="px-2 py-2 text-center">상세</th>
          </tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <Fragment key={i}>
                <tr className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <button onClick={() => { setAccount(r.cupang_id || ''); setExpanded(null); }}
                      className="font-semibold text-[#0074e9] hover:underline" title="이 사업자만 보기">
                      {r.account_name || r.cupang_id}
                    </button>
                    {r.account_name && <span className="text-[10px] text-gray-400 ml-1">{r.cupang_id}</span>}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-medium">{r.settlement_date}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className="text-[10px] px-1.5 py-[1px] rounded bg-blue-100 text-blue-700">{r.settlement_type}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-500">{r.pay_ratio != null ? `${r.pay_ratio}%` : '-'}</td>
                  <td className="px-2 py-1.5 text-gray-600 text-xs whitespace-nowrap">{r.recognition_from}~{(r.recognition_to || '').slice(5)}</td>
                  <td className="px-2 py-1.5 text-right">{(r.revenue_a || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-red-500">{(r.commission_b || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-orange-500">{(r.fulfillment_j || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-[#16a34a]">{r.final_amount.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-center">
                    {r.has_detail
                      ? <button onClick={() => setExpanded(expanded === i ? null : i)} className="text-xs text-blue-600 hover:underline">{expanded === i ? '접기' : '항목▾'}</button>
                      : <span className="text-[10px] text-gray-400">미수집</span>}
                  </td>
                </tr>
                {expanded === i && r.has_detail && (
                  <tr className="bg-slate-50"><td colSpan={10} className="px-4 py-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs max-w-[900px]">
                      <Line label="판매액(a)" v={r.gross_sale} />
                      <Line label="취소액" v={r.cancel_amount} minus />
                      <Line label="매출금액(A)" v={r.revenue_a} bold />
                      <Line label="판매수수료(B)" v={r.commission_b} minus />
                      <Line label="상계금액(C, 쿠폰)" v={r.coupon_c} minus />
                      <Line label="판매기준매출(D=A-B-C)" v={r.base_revenue_d} bold />
                      <Line label={`지급액(H, ${r.pay_ratio || 70}%)`} v={r.payment_h} bold />
                      <Line label="추가상계(I)" v={0} />
                      <div className="col-span-full mt-1 mb-0.5 font-semibold text-orange-600 border-t pt-1">쿠팡 풀필먼트 비용(J) = {(r.fulfillment_j || 0).toLocaleString()}</div>
                      <Line label="입출고비" v={r.ff_inout} minus />
                      <Line label="배송비" v={r.ff_shipping} minus />
                      <Line label="보관비" v={r.ff_storage} minus />
                      <Line label="반품회수비" v={r.ff_return} minus />
                      <Line label="반품재입고비" v={r.ff_restock} minus />
                      <Line label="반출배송비" v={r.ff_outbound} minus />
                      <Line label="재고손실보상(K)" v={r.inventory_k} />
                      <div className="col-span-full mt-1 border-t pt-1 font-bold text-[#16a34a]">최종지급액(H−I−J+K) = {r.final_amount.toLocaleString()}원</div>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={10} className="px-2 py-8 text-center text-gray-400">{loading ? '불러오는 중...' : '데이터가 없습니다. "🔄 전체 정산현황 크롤링"을 누르세요.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

// ── 상품별 정산 (order DB) ──
function ProductSettlementView() {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [seller, setSeller] = useState('');
  const [rows, setRows] = useState<ProductSettlementRow[]>([]);
  const [totals, setTotals] = useState({ qty: 0, settle: 0, pay: 0, supply: 0, shipping: 0, profit: 0, margin: 0, cancel_cnt: 0, cancel_amt: 0 });
  const [sellers, setSellers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'settle' | 'profit' | 'qty' | 'margin'>('settle');

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const rowKey = (r: ProductSettlementRow) => r.exposure_id || r.product_seller_code || r.product_name;

  // 광고리포트 업로드
  const [showAd, setShowAd] = useState(false);
  const [adCupang, setAdCupang] = useState('exansys');
  const [adMsg, setAdMsg] = useState('');
  const [adBusy, setAdBusy] = useState(false);
  const onAdFile = async (file: File | null) => {
    if (!file) return;
    setAdBusy(true); setAdMsg('업로드 중...');
    try {
      const r = await uploadCoupangAd(file, adCupang);
      if (r.error) setAdMsg(`❌ ${r.error}`);
      else setAdMsg(`✅ ${r.inserted}건 (${(r.dates || []).length}일) · 광고비 ₩${(r.total_ad_cost || 0).toLocaleString()} 반영`);
      await load();
    } catch (e: any) {
      setAdMsg(`❌ ${e?.response?.data?.error || e?.message || e}`);
    } finally { setAdBusy(false); }
  };
  // 광고센터 자동수집 (NDJSON 스트리밍)
  const autoCrawlAd = async () => {
    setAdBusy(true); setAdMsg('광고센터 로그인 중...');
    try {
      const resp = await startCoupangAdCrawl(adCupang, from, to);
      const reader = resp.body!.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const ln of lines) {
          if (!ln.trim()) continue;
          try {
            const ev = JSON.parse(ln);
            if (ev.t === 'log') setAdMsg(ev.m);
            else if (ev.t === 'done') setAdMsg(ev.error ? `❌ ${ev.error}` : `✅ 자동수집 완료 — ${ev.inserted}건 / 광고비 ₩${(ev.total_ad_cost || 0).toLocaleString()} / 노출ID환산 ${ev.resolved || 0}`);
          } catch { /* */ }
        }
      }
      await load();
    } catch (e: any) {
      setAdMsg(`❌ ${e?.message || e}`);
    } finally { setAdBusy(false); }
  };
  // 옵션ID→노출상품ID 카탈로그 동기화 (NDJSON 스트리밍)
  const syncVidMap = async () => {
    setAdBusy(true); setAdMsg('상품 카탈로그 동기화 중...');
    try {
      const resp = await startVidMapSync(adCupang);
      const reader = resp.body!.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const ln of lines) {
          if (!ln.trim()) continue;
          try {
            const ev = JSON.parse(ln);
            if (ev.t === 'log') setAdMsg(ev.m);
            else if (ev.t === 'done') setAdMsg(`✅ 카탈로그 동기화 — 상품 ${ev.products} / 옵션ID ${ev.mapped}개 매핑`);
          } catch { /* */ }
        }
      }
      await load();
    } catch (e: any) {
      setAdMsg(`❌ ${e?.message || e}`);
    } finally { setAdBusy(false); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getProductSettlement(seller || undefined, from, to);
      setRows(d.rows); setTotals(d.totals); setSellers(d.sellers);
    } finally { setLoading(false); }
  }, [seller, from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSel(new Set()); }, [seller, from, to]);

  const sorted = [...rows].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const allSel = sorted.length > 0 && sorted.every(r => sel.has(rowKey(r)));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(sorted.map(rowKey)));
  const toggleOne = (k: string) => setSel(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // 선택 항목 일괄 오너클랜배송 지정/복원 (배송비 0 ↔ 부담)
  const applyShip = async (excluded: boolean) => {
    const targets = sorted.filter(r => sel.has(rowKey(r)));
    if (!targets.length) return;
    setBusy(true);
    try {
      for (const r of targets) {
        await saveProductCostMap({
          exposure_id: r.exposure_id || '', product_seller_code: r.product_seller_code || '',
          product_name: r.product_name, unit_cost: r.unit_cost || 0, bundle_size: r.bundle_size || 1,
          ship_excluded: excluded,
        });
      }
      setSel(new Set());
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm text-gray-600">기간</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <span>~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <span className="text-sm text-gray-600 ml-2">사업자</span>
        <select value={seller} onChange={e => setSeller(e.target.value)} className="border rounded px-2 py-1 text-sm font-semibold">
          <option value="">전체 ({sellers.length})</option>
          {sellers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {loading && <span className="text-xs text-gray-400 animate-pulse">집계 중...</span>}
        <button
          onClick={() => {
            const qs = new URLSearchParams({ from, to });
            if (seller) qs.set('seller_alias', seller);
            window.open(`/api/cpc/coupang-rocket/product-settlement/excel/?${qs.toString()}`, '_blank');
          }}
          disabled={rows.length === 0}
          className="px-3 py-1 rounded bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40"
          title="현재 기간·사업자 기준 상품별 정산 엑셀 다운로드"
        >
          📥 엑셀 다운로드
        </button>
        <button onClick={() => setShowAd(s => !s)}
          className={`px-3 py-1 rounded text-sm font-semibold border ${showAd ? 'bg-violet-600 text-white' : 'bg-white text-violet-600 border-violet-400 hover:bg-violet-50'}`}
          title="WING 광고관리 리포트 엑셀 업로드 → 상품별 광고비/ROAS">📊 광고리포트 업로드</button>
        <span className="text-[11px] text-gray-400 ml-auto">원가 클릭→매핑 · "오너클랜?"→배송비0 · 광고비=노출상품ID 매칭 · 이익=정산−원가−배송 · 광고후이익=−광고비</span>
      </div>

      {/* 광고리포트 업로드 패널 */}
      {showAd && (
        <div className="mb-3 p-3 rounded border bg-violet-50 border-violet-200 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-violet-700">📊 WING 광고리포트 업로드</span>
          <span className="text-xs text-gray-500">쿠팡ID</span>
          <input value={adCupang} onChange={e => setAdCupang(e.target.value)} className="border rounded px-2 py-1 text-sm w-28" placeholder="exansys" />
          <button onClick={autoCrawlAd} disabled={adBusy}
            className="px-3 py-1 rounded bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
            title="advertising.coupang.com 자동 로그인→보고서 생성→다운로드→반영 (기간=위 조회기간, 약 1~2분)">
            {adBusy ? '수집 중...' : '🤖 자동수집(광고센터)'}</button>
          <button onClick={syncVidMap} disabled={adBusy}
            className="px-3 py-1 rounded border border-violet-400 text-violet-700 text-sm font-semibold disabled:opacity-50"
            title="전 상품 순회로 옵션ID→노출상품ID 카탈로그 구축(광고비 노출ID 매칭률↑). 가끔 1회">
            🔗 노출ID 매핑</button>
          <span className="text-gray-300">|</span>
          <label className="px-3 py-1 rounded bg-violet-600 text-white text-sm font-semibold cursor-pointer">
            {adBusy ? '...' : '파일 선택(xlsx)'}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={adBusy}
              onChange={e => { onAdFile(e.target.files?.[0] || null); e.currentTarget.value = ''; }} />
          </label>
          {adMsg && <span className="text-xs text-gray-600">{adMsg}</span>}
          <span className="text-[11px] text-gray-400 ml-auto">자동수집=광고센터 직접크롤 · 또는 WING 광고리포트 xlsx 업로드 · 옵션ID→노출ID 환산 매칭</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Card label="상품 수" value={`${rows.length}종`} />
        <Card label="판매수량" value={`${totals.qty.toLocaleString()}개`} />
        <Card label="정산액" value={won(totals.settle)} color="#0074e9" />
        <Card label="원가" value={won(totals.supply)} color="#ef4444" />
        <Card label="배송비" value={won(totals.shipping)} color="#f59e0b" />
        <Card label={`이익 (${totals.margin}%)`} value={won(totals.profit)} color="#16a34a" />
        <Card label={`광고비 ${totals.ad_cost ? `(ROAS ${totals.roas}%)` : ''}`} value={won(totals.ad_cost || 0)} color="#7c3aed" />
        <Card label="광고후이익" value={won(totals.profit_ad || 0)} color={(totals.profit_ad || 0) < 0 ? '#ef4444' : '#0891b2'} />
      </div>

      {/* 선택 일괄 적용 바 */}
      <div className="flex items-center gap-2 mb-2 p-2 rounded border bg-teal-50 border-teal-200">
        <span className={`text-sm font-semibold ${sel.size ? 'text-teal-700' : 'text-gray-400'}`}>
          {sel.size ? `${sel.size}개 선택됨` : '오너클랜배송 지정할 상품을 체크하세요'}
        </span>
        <button onClick={() => applyShip(true)} disabled={busy || !sel.size}
          className="px-3 py-1 rounded bg-teal-600 text-white text-sm font-semibold disabled:opacity-40">🚚 오너클랜배송 지정 (배송비 0)</button>
        <button onClick={() => applyShip(false)} disabled={busy || !sel.size}
          className="px-3 py-1 rounded border text-sm text-gray-600 disabled:opacity-40">배송비 복원</button>
        {sel.size > 0 && <button onClick={() => setSel(new Set())} className="text-xs text-gray-400 ml-1">선택해제</button>}
        {busy && <span className="text-xs text-gray-400 animate-pulse">적용 중...</span>}
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700"><tr>
            <th className="px-2 py-2 text-center w-8"><input type="checkbox" checked={allSel} onChange={toggleAll} title="전체 선택" /></th>
            <th className="px-2 py-2 text-left">상품명</th>
            <th className="px-2 py-2 text-left">사업자</th>
            <th className="px-2 py-2 text-right cursor-pointer hover:text-blue-600" onClick={() => setSortKey('qty')}>수량{sortKey === 'qty' ? ' ▼' : ''}</th>
            <th className="px-2 py-2 text-right cursor-pointer hover:text-blue-600" onClick={() => setSortKey('settle')}>정산액{sortKey === 'settle' ? ' ▼' : ''}</th>
            <th className="px-2 py-2 text-right">원가</th>
            <th className="px-2 py-2 text-right text-amber-600" title="real_shipping_fee · 없으면 건당 기본 2620원(부가세포함)">배송비</th>
            <th className="px-2 py-2 text-right cursor-pointer hover:text-blue-600" onClick={() => setSortKey('profit')}>이익{sortKey === 'profit' ? ' ▼' : ''}</th>
            <th className="px-2 py-2 text-right cursor-pointer hover:text-blue-600" onClick={() => setSortKey('margin')}>이익률{sortKey === 'margin' ? ' ▼' : ''}</th>
            <th className="px-2 py-2 text-right text-violet-600" title="광고비 (노출상품ID 매칭)">광고비</th>
            <th className="px-2 py-2 text-right text-violet-600" title="ROAS=광고매출/광고비 · ACOS=광고비/매출">ROAS</th>
            <th className="px-2 py-2 text-right text-cyan-700" title="광고후이익 = 이익 − 광고비">광고후이익</th>
            <th className="px-2 py-2 text-right">취소</th>
          </tr></thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i} className={`border-t hover:bg-gray-50 group ${sel.has(rowKey(r)) ? 'bg-teal-50/60' : r.profit < 0 ? 'bg-red-50' : ''}`}>
                <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={sel.has(rowKey(r))} onChange={() => toggleOne(rowKey(r))} /></td>
                <td className="px-2 py-1.5 max-w-[360px] truncate" title={`${r.product_name} (${r.product_seller_code})`}>
                  {r.exposure_id
                    ? <a href={`https://www.coupang.com/vp/products/${r.exposure_id}`} target="_blank" rel="noreferrer"
                        className="hover:text-blue-600 hover:underline" title={`쿠팡 상품페이지 열기 (노출 ${r.exposure_id})`}>{r.product_name} <span className="text-[10px] text-blue-400">🔗</span></a>
                    : r.product_name}
                </td>
                <td className="px-2 py-1.5 text-xs text-gray-500 whitespace-nowrap">{r.seller_alias}</td>
                <td className="px-2 py-1.5 text-right">{r.qty.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-[#0074e9]">{r.settle.toLocaleString()}</td>
                <CostCell row={r} onSaved={load} />
                <ShipCell row={r} />
                <td className={`px-2 py-1.5 text-right font-bold ${r.profit < 0 ? 'text-red-600' : 'text-[#16a34a]'}`}>{r.profit.toLocaleString()}</td>
                <td className={`px-2 py-1.5 text-right text-xs ${r.profit < 0 ? 'text-red-600 font-bold' : 'text-gray-600'}`}>{r.margin}%</td>
                <td className="px-2 py-1.5 text-right text-violet-600 tabular-nums">{r.ad_cost ? r.ad_cost.toLocaleString() : ''}</td>
                <td className="px-2 py-1.5 text-right text-[11px] tabular-nums" title={r.ad_cost ? `ACOS ${r.acos}% · 광고매출 ${(r.ad_sales || 0).toLocaleString()}` : ''}>
                  {r.ad_cost ? <span className={(r.roas || 0) >= 100 ? 'text-violet-700 font-semibold' : 'text-red-500 font-semibold'}>{r.roas}%</span> : ''}
                </td>
                <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${(r.profit_ad ?? r.profit) < 0 ? 'text-red-600' : 'text-cyan-700'}`}>{(r.profit_ad ?? r.profit).toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-[11px] text-amber-600">{r.cancel_cnt ? `${r.cancel_cnt}건` : ''}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={13} className="px-2 py-8 text-center text-gray-400">{loading ? '집계 중...' : '데이터 없음'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 통합 정산 (전 계정 로켓그로스 + 마켓플레이스) ──
function UnifiedSettlementView() {
  const [rows, setRows] = useState<UnifiedSettlementRow[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [from, setFrom] = useState('2026-01-01');
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState<VerifyCheck[]>([]);
  const [vsum, setVsum] = useState<{ pass: number; warn: number; fail: number }>({ pass: 0, warn: 0, fail: 0 });
  const [showVerify, setShowVerify] = useState(true);

  useEffect(() => {
    setLoading(true);
    getUnifiedSettlement(from).then(d => { setRows(d.rows); setTotals(d.totals); }).finally(() => setLoading(false));
    getSettlementVerify(from).then(d => { setChecks(d.checks); setVsum(d.summary); }).catch(() => {});
  }, [from]);

  const ICON = { pass: '✅', warn: '⚠️', fail: '❌' } as const;
  const CLR = { pass: 'text-green-600', warn: 'text-amber-600', fail: 'text-red-600' } as const;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm text-gray-600">기준일(이후)</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        {loading && <span className="text-xs text-gray-400 animate-pulse">집계 중...</span>}
        <button onClick={() => window.open(`/api/cpc/coupang-rocket/unified-settlement/excel/?from=${from}`, '_blank')}
          className="px-3 py-1 rounded bg-emerald-600 text-white text-sm font-semibold ml-auto">📥 엑셀</button>
      </div>

      {/* 검증 결과 패널 */}
      <div className="mb-4 border rounded-lg overflow-hidden">
        <button onClick={() => setShowVerify(s => !s)}
          className="w-full flex items-center gap-3 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-sm font-semibold">
          <span>🔍 정산 검증결과</span>
          <span className="text-green-600">✅ {vsum.pass}</span>
          <span className="text-amber-600">⚠️ {vsum.warn}</span>
          {vsum.fail > 0 && <span className="text-red-600">❌ {vsum.fail}</span>}
          <span className="ml-auto text-gray-400 text-xs">{showVerify ? '접기 ▲' : '펼치기 ▼'}</span>
        </button>
        {showVerify && (
          <div className="divide-y">
            {checks.map((c, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                <span className="shrink-0">{ICON[c.status]}</span>
                <div>
                  <div className={`font-medium ${CLR[c.status]}`}>{c.name}</div>
                  <div className="text-[12px] text-gray-500">{c.detail}</div>
                </div>
              </div>
            ))}
            {checks.length === 0 && <div className="px-3 py-3 text-gray-400 text-sm">검증 로딩 중...</div>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Card label="확정 정산 합계 (실수령)" value={won(totals.confirmed || 0)} color="#16a34a" />
        <Card label="마켓플레이스(API)" value={won(totals.mp_api || 0)} color="#0074e9" />
        <Card label="로켓그로스(WING)" value={won(totals.rocket || 0)} color="#e44232" />
        <Card label="대장 매출(참고)" value={won(totals.ledger || 0)} color="#9ca3af" />
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700"><tr>
            <th className="px-2 py-2 text-left">계정</th>
            <th className="px-2 py-2 text-right text-[#0074e9]">마켓플레이스<br /><span className="text-[10px] font-normal">(실정산)</span></th>
            <th className="px-2 py-2 text-right text-[#e44232]">로켓그로스<br /><span className="text-[10px] font-normal">(실정산)</span></th>
            <th className="px-2 py-2 text-right text-[#16a34a]">확정정산 합계</th>
            <th className="px-2 py-2 text-right text-gray-400">대장매출(참고)</th>
            <th className="px-2 py-2 text-center">검증</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t hover:bg-gray-50 ${r.confirmed > 0 ? 'bg-green-50/40' : ''}`}>
                <td className="px-2 py-1.5">
                  <span className="font-semibold">{r.account_name || r.alias || r.cupang_id}</span>
                  <span className="block text-[10px] text-gray-400">{r.cupang_id} {r.has_api_key && '🔑'}</span>
                </td>
                <td className="px-2 py-1.5 text-right font-semibold text-[#0074e9]">
                  {r.mp_api_final ? r.mp_api_final.toLocaleString() : (r.has_api_key ? '0' : <span className="text-gray-300 text-xs">키없음</span>)}
                </td>
                <td className="px-2 py-1.5 text-right font-semibold text-[#e44232]">{r.rocket_final ? r.rocket_final.toLocaleString() : <span className="text-gray-300">-</span>}</td>
                <td className="px-2 py-1.5 text-right font-bold text-[#16a34a]">{r.confirmed ? r.confirmed.toLocaleString() : <span className="text-gray-300">-</span>}</td>
                <td className="px-2 py-1.5 text-right text-gray-400">{r.ledger.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center">
                  {r.verified
                    ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-600 font-semibold">확정</span>
                    : <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600" title="Open API 키 발급 시 실정산 확인 가능">추정</span>}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 font-bold bg-gray-50">
              <td className="px-2 py-2">합계</td>
              <td className="px-2 py-2 text-right text-[#0074e9]">{(totals.mp_api || 0).toLocaleString()}</td>
              <td className="px-2 py-2 text-right text-[#e44232]">{(totals.rocket || 0).toLocaleString()}</td>
              <td className="px-2 py-2 text-right text-[#16a34a]">{(totals.confirmed || 0).toLocaleString()}</td>
              <td className="px-2 py-2 text-right text-gray-400">{(totals.ledger || 0).toLocaleString()}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        ※ <b>확정정산</b> = 실제 받은/받을 돈 (마켓플레이스 API + 로켓그로스 WING). <b>대장</b> = 내 장부 총매출(참고, 정산 아님).
        API키 없는 계정은 '추정' — 키 발급 시 실정산 확정됩니다.
      </p>
    </div>
  );
}

// ── 옵션/SKU별 정산 대조 (쿠팡 실제정산 API ↔ 내 대장) ──
function OptionSettlementView() {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(iso(yesterday));
  const [cupangId, setCupangId] = useState('exansys');
  const [accounts, setAccounts] = useState<string[]>(['exansys']);
  const [rows, setRows] = useState<OptionSettlementRow[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'both' | 'api_only' | 'odb_only'>('all');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d = await getOptionSettlement(cupangId, from, to);
      if (d.error) { setErr(d.error); setRows([]); setTotals({}); }
      else { setRows(d.rows); setTotals(d.totals); }
      if (d.accounts?.length) setAccounts(d.accounts);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [cupangId, from, to]);
  useEffect(() => { load(); }, [load]);

  const [sortKey, setSortKey] = useState<'api_settle' | 'odb_settle' | 'diff' | 'api_qty' | 'sku' | 'product_name'>('api_settle');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'sku' || k === 'product_name' ? 'asc' : 'desc'); }
  };

  const filtered = filter === 'all' ? rows : rows.filter(r => r.match === filter);
  const shown = [...filtered].sort((a, b) => {
    const va = (a as any)[sortKey] ?? (typeof (a as any)[sortKey] === 'string' ? '' : 0);
    const vb = (b as any)[sortKey] ?? 0;
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb : String(va).localeCompare(String(vb), 'ko');
    return sortDir === 'asc' ? cmp : -cmp;
  });
  const MK: Record<string, { t: string; c: string; bg: string }> = {
    both: { t: '일치', c: 'text-emerald-700', bg: 'bg-emerald-100' },
    api_only: { t: '쿠팡만', c: 'text-blue-700', bg: 'bg-blue-100' },
    odb_only: { t: '대장만', c: 'text-amber-700', bg: 'bg-amber-100' },
  };

  const apiSettle = totals.api_settle || 0;
  const odbSettle = totals.odb_settle || 0;
  const diffTotal = totals.diff || 0;
  // 금액 일치율 (쿠팡 정산 대비 차이 비중)
  const matchRate = apiSettle > 0 ? Math.max(0, Math.min(100, Math.round((1 - Math.abs(diffTotal) / apiSettle) * 100))) : 0;
  const rateColor = matchRate >= 95 ? '#16a34a' : matchRate >= 80 ? '#f59e0b' : '#ef4444';
  const maxAbsDiff = Math.max(1, ...shown.map(r => Math.abs(r.diff || 0)));

  const SortTh = ({ k, label, align = 'right', color }: { k: typeof sortKey; label: string; align?: 'left' | 'right' | 'center'; color?: string }) => (
    <th onClick={() => toggleSort(k)}
      className={`px-2 py-2 text-${align} cursor-pointer select-none hover:bg-gray-200 whitespace-nowrap`} style={{ color }}>
      {label}<span className="ml-0.5 text-[10px] text-gray-400">{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  );

  return (
    <div>
      {/* 컨트롤 바 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm text-gray-600">계정</span>
        <select value={cupangId} onChange={e => setCupangId(e.target.value)} className="border rounded px-2 py-1 text-sm font-semibold">
          {accounts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-sm text-gray-600 ml-1">기간</span>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <span>~</span>
        <input type="date" value={to} max={iso(yesterday)} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <button onClick={load} className="px-3 py-1 rounded bg-[#0074e9] text-white text-sm font-semibold disabled:opacity-40" disabled={loading}>
          {loading ? '조회 중…' : '🔍 조회'}
        </button>
        <button
          onClick={() => window.open(`/api/cpc/coupang-rocket/option-settlement/excel/?cupang_id=${cupangId}&from=${from}&to=${to}`, '_blank')}
          disabled={rows.length === 0}
          className="px-3 py-1 rounded bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40 shadow-sm hover:bg-emerald-700">📥 엑셀 다운로드</button>
        <span className="text-[11px] text-gray-400 ml-auto">쿠팡 제약: 기간 1개월 미만 · 종료일 ≤ 어제</span>
      </div>

      {err && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded border border-red-200">⚠ {err}</div>}

      {/* 매출 대조 히어로 배너 */}
      <div className="mb-3 rounded-xl border bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-[11px] font-semibold text-[#0074e9]">🚚 쿠팡 실제정산 (API)</div>
              <div className="text-2xl font-extrabold text-[#0074e9] tabular-nums">{won(apiSettle)}</div>
              <div className="text-[11px] text-gray-400">수량 {totals.api_qty || 0} · 수수료 {won(totals.api_fee || 0)}</div>
            </div>
            <div className="text-2xl text-gray-300 font-bold">⇄</div>
            <div>
              <div className="text-[11px] font-semibold text-amber-600">📒 판매자배송 주문대장</div>
              <div className="text-2xl font-extrabold text-amber-600 tabular-nums">{won(odbSettle)}</div>
              <div className="text-[11px] text-gray-400">구매 {totals.odb_qty || 0}개 · 구매금액 {won(totals.odb_pay || 0)}</div>
            </div>
            <div className="border-l pl-4">
              <div className="text-[11px] font-semibold text-gray-500">차이 (쿠팡 − 대장)</div>
              <div className={`text-2xl font-extrabold tabular-nums ${diffTotal > 0 ? 'text-red-500' : diffTotal < 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                {diffTotal > 0 ? '+' : ''}{won(diffTotal)}
              </div>
              <div className="text-[11px] text-gray-400">{diffTotal > 0 ? '쿠팡이 더 많음' : diffTotal < 0 ? '대장이 더 많음' : '완전 일치'}</div>
            </div>
          </div>
          {/* 일치율 게이지 */}
          <div className="min-w-[200px] flex-1 max-w-[320px]">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs font-semibold text-gray-600">정산 금액 일치율</span>
              <span className="text-xl font-extrabold tabular-nums" style={{ color: rateColor }}>{matchRate}%</span>
            </div>
            <div className="h-3 rounded-full bg-gray-200 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${matchRate}%`, background: rateColor }} />
            </div>
            <div className="text-[11px] text-gray-400 mt-1">
              일치 {totals.both || 0} · 쿠팡만 {totals.api_only || 0} · 대장만 {totals.odb_only || 0}
            </div>
          </div>
        </div>
      </div>

      {/* 필터 pills */}
      <div className="flex items-center gap-1.5 mb-2 text-xs flex-wrap">
        {([['all', `전체 ${rows.length}`, 'bg-gray-800'], ['both', `✅ 일치 ${totals.both || 0}`, 'bg-emerald-600'], ['api_only', `🔵 쿠팡만 ${totals.api_only || 0}`, 'bg-blue-600'], ['odb_only', `🟠 대장만 ${totals.odb_only || 0}`, 'bg-amber-500']] as const).map(([k, label, active]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-2.5 py-1 rounded-full border font-semibold transition-colors ${filter === k ? `${active} text-white border-transparent` : 'bg-white text-gray-500 hover:bg-gray-50'}`}>{label}</button>
        ))}
        <span className="text-[11px] text-gray-400 ml-2">노출상품ID 기준 묶음(옵션ID는 반품/로켓/윙마다 생성됨) · 헤더 클릭 정렬</span>
      </div>

      {/* 대조 테이블 */}
      <div className="overflow-x-auto border rounded-lg shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700 sticky top-0"><tr>
            <SortTh k="sku" label="S코드(SKU)" align="left" />
            <SortTh k="product_name" label="상품명" align="left" />
            <th className="px-2 py-2 text-center">옵션ID</th>
            <th className="px-2 py-2 text-center">구분</th>
            <SortTh k="api_qty" label="쿠팡수량" color="#0074e9" />
            <SortTh k="api_settle" label="쿠팡정산" color="#0074e9" />
            <th className="px-2 py-2 text-right text-amber-600" title="판매자배송 주문DB 구매수량">구매수량</th>
            <th className="px-2 py-2 text-right text-amber-600" title="판매자배송 결제금액(고객 구매금액)">구매금액</th>
            <SortTh k="odb_settle" label="정산(대장)" color="#d97706" />
            <th className="px-2 py-2 text-center text-amber-600" title="판매자배송 구매시간대(주문시각 0~23시)">구매시간대</th>
            <SortTh k="diff" label="차이" />
          </tr></thead>
          <tbody>
            {shown.map((r, i) => {
              const w = Math.round((Math.abs(r.diff || 0) / maxAbsDiff) * 100);
              return (
              <tr key={i} className={`border-t hover:bg-gray-50 ${r.match === 'odb_only' ? 'bg-amber-50/40' : r.match === 'api_only' ? 'bg-blue-50/40' : ''}`}>
                <td className="px-2 py-1.5 font-mono text-xs">
                  <div>{r.sku}</div>
                  {r.exposure_id && (
                    <a href={`https://www.coupang.com/vp/products/${r.exposure_id}`} target="_blank" rel="noreferrer"
                      className="block text-[10px] text-blue-500 hover:underline" title="쿠팡 상품페이지 열기">노출 {r.exposure_id} 🔗</a>
                  )}
                </td>
                <td className="px-2 py-1.5 max-w-[300px] truncate" title={r.product_name}>
                  {r.exposure_id
                    ? <a href={`https://www.coupang.com/vp/products/${r.exposure_id}`} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">{r.product_name}</a>
                    : r.product_name}
                </td>
                <td className="px-2 py-1.5 text-center text-[11px] text-gray-500 font-mono"
                  title={`옵션ID(반품/로켓/윙마다 생성): ${r.vids.join(', ') || '-'}`}>
                  {r.vids.length ? (r.vids.length === 1 ? r.vids[0] : `${r.vids.length}개`) : '-'}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${MK[r.match].bg} ${MK[r.match].c}`}>{MK[r.match].t}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.api_qty || ''}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-[#0074e9] tabular-nums">{r.api_settle ? r.api_settle.toLocaleString() : '-'}</td>
                <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{r.odb_qty || ''}</td>
                <td className="px-2 py-1.5 text-right text-amber-700 tabular-nums">{r.odb_pay ? r.odb_pay.toLocaleString() : '-'}</td>
                <td className="px-2 py-1.5 text-right text-amber-700 tabular-nums">{r.odb_settle ? r.odb_settle.toLocaleString() : '-'}</td>
                <td className="px-2 py-1.5 text-center">
                  <HourSpark hours={r.hours} peak={r.peak_hour} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {r.diff ? (
                      <span className="h-1.5 rounded-full" style={{ width: `${Math.max(6, w * 0.5)}px`, background: r.diff > 0 ? '#ef4444' : '#3b82f6', opacity: 0.5 }} />
                    ) : null}
                    <span className={`font-bold tabular-nums ${r.diff > 0 ? 'text-red-600' : r.diff < 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                      {r.diff ? (r.diff > 0 ? '+' : '') + r.diff.toLocaleString() : '0'}
                    </span>
                  </div>
                </td>
              </tr>
            );})}
            {shown.length === 0 && <tr><td colSpan={11} className="px-2 py-8 text-center text-gray-400">{loading ? '조회 중...' : err ? '—' : '데이터 없음'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Line({ label, v, minus, bold }: { label: string; v?: number; minus?: boolean; bold?: boolean }) {
  const val = v || 0;
  return (
    <div className="flex justify-between gap-2 border-b border-gray-100 py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className={`${bold ? 'font-bold' : ''} ${minus && val ? 'text-red-500' : 'text-gray-800'}`}>
        {minus && val ? '-' : ''}{val.toLocaleString()}
      </span>
    </div>
  );
}

// ── 광고비효율 대시보드 ──
function AdEfficiencyView() {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(iso(new Date(Date.now() - 864e5)));
  const [cupang, setCupang] = useState('');
  const [data, setData] = useState<AdEfficiencyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'ad_cost' | 'ad_sales' | 'roas' | 'clicks'>('ad_cost');

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getAdEfficiency(from, to, cupang || undefined)); }
    finally { setLoading(false); }
  }, [from, to, cupang]);
  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const products = [...(data?.products || [])].sort((a, b) => (sortKey === 'roas' ? b.roas - a.roas : (b[sortKey] as number) - (a[sortKey] as number)));
  const roasColor = (r: number) => r >= 300 ? 'text-emerald-700' : r >= 100 ? 'text-violet-700' : 'text-red-600';

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm text-gray-600">기간</span>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <span>~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <span className="text-sm text-gray-600 ml-1">계정</span>
        <select value={cupang} onChange={e => setCupang(e.target.value)} className="border rounded px-2 py-1 text-sm font-semibold">
          <option value="">전체</option>
          {['exansys', 'joacham', 'bitcom1', 'bitic05'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {loading && <span className="text-xs text-gray-400 animate-pulse">집계 중...</span>}
        <span className="text-[11px] text-gray-400 ml-auto">매일 14시 자동수집(정상계정) · ROAS=광고매출/광고비 · ACOS=광고비/매출</span>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
        <Card label="광고비" value={won(t?.ad_cost || 0)} color="#7c3aed" />
        <Card label="광고매출(전환)" value={won(t?.ad_sales || 0)} color="#0074e9" />
        <Card label="ROAS" value={`${t?.roas || 0}%`} color={(t?.roas || 0) >= 100 ? '#16a34a' : '#ef4444'} />
        <Card label="ACOS" value={`${t?.acos || 0}%`} color="#f59e0b" />
        <Card label="클릭(CTR)" value={`${(t?.clicks || 0).toLocaleString()} (${t?.ctr || 0}%)`} />
        <Card label="CPC(클릭당)" value={won(t?.cpc || 0)} />
        <Card label="저효율 광고비(ROAS<100%)" value={won(t?.low_roas_cost || 0)} color="#ef4444" />
      </div>

      {/* 일별 추이 */}
      <div className="bg-white border rounded-lg p-3 mb-4">
        <div className="text-sm font-bold mb-1">일별 광고비 vs 광고매출</div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data?.daily || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor((data?.daily.length || 0) / 12))} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 10000 ? `${Math.round(v / 10000)}만` : `${v}`} />
            <Tooltip formatter={(v: number, n: string) => [won(v), n === 'ad_cost' ? '광고비' : '광고매출']} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === 'ad_cost' ? '광고비' : '광고매출'} />
            <Bar dataKey="ad_cost" fill="#c4b5fd" radius={[2, 2, 0, 0]} barSize={14} />
            <RLine type="monotone" dataKey="ad_sales" stroke="#0074e9" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 계정별 */}
      {(data?.accounts.length || 0) > 1 && (
        <div className="mb-4">
          <div className="text-sm font-bold mb-1">계정별</div>
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-gray-700"><tr>
                <th className="px-2 py-1.5 text-left">계정</th>
                <th className="px-2 py-1.5 text-right text-violet-600">광고비</th>
                <th className="px-2 py-1.5 text-right text-[#0074e9]">광고매출</th>
                <th className="px-2 py-1.5 text-right">ROAS</th>
                <th className="px-2 py-1.5 text-right">ACOS</th>
                <th className="px-2 py-1.5 text-right">클릭</th>
                <th className="px-2 py-1.5 text-right">CPC</th>
              </tr></thead>
              <tbody>
                {data!.accounts.map(a => (
                  <tr key={a.cupang_id} className="border-t">
                    <td className="px-2 py-1.5 font-semibold">{a.cupang_id}</td>
                    <td className="px-2 py-1.5 text-right text-violet-600 tabular-nums">{a.ad_cost.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right text-[#0074e9] tabular-nums">{a.ad_sales.toLocaleString()}</td>
                    <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${roasColor(a.roas)}`}>{a.roas}%</td>
                    <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{a.acos}%</td>
                    <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{a.clicks.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{won(a.cpc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 상품별 */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold">상품별 광고효율 ({data?.totals.product_count || 0})</span>
        <span className="text-[11px] text-gray-400">정렬:</span>
        {([['ad_cost', '광고비'], ['ad_sales', '광고매출'], ['roas', 'ROAS'], ['clicks', '클릭']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSortKey(k)}
            className={`text-[11px] px-2 py-0.5 rounded border ${sortKey === k ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}>{l}</button>
        ))}
      </div>
      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700"><tr>
            <th className="px-2 py-2 text-left">상품</th>
            <th className="px-2 py-2 text-right text-violet-600">광고비</th>
            <th className="px-2 py-2 text-right text-[#0074e9]">광고매출</th>
            <th className="px-2 py-2 text-right">ROAS</th>
            <th className="px-2 py-2 text-right">ACOS</th>
            <th className="px-2 py-2 text-right">노출</th>
            <th className="px-2 py-2 text-right">클릭</th>
            <th className="px-2 py-2 text-right">CTR</th>
            <th className="px-2 py-2 text-right">CPC</th>
            <th className="px-2 py-2 text-right">전환</th>
          </tr></thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={i} className={`border-t hover:bg-gray-50 ${p.roas < 100 ? 'bg-red-50/50' : ''}`}>
                <td className="px-2 py-1.5 max-w-[280px] truncate" title={`${p.name} (노출 ${p.exposure_id || '-'})`}>{p.name || '(미상)'}</td>
                <td className="px-2 py-1.5 text-right text-violet-600 font-semibold tabular-nums">{p.ad_cost.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-[#0074e9] tabular-nums">{p.ad_sales.toLocaleString()}</td>
                <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${roasColor(p.roas)}`}>{p.roas}%</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{p.acos}%</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{p.impressions.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{p.clicks.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{p.ctr}%</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{won(p.cpc)}</td>
                <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{p.ad_orders || ''}</td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan={10} className="px-2 py-8 text-center text-gray-400">{loading ? '집계 중...' : '광고 데이터 없음 (해당 기간/계정)'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white border rounded-lg p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

// 편집 가능한 원가 셀 (개당원가 × 봉다리수량 매핑 저장)
function CostCell({ row, onSaved }: { row: ProductSettlementRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [unit, setUnit] = useState('');
  const [bundle, setBundle] = useState('1');
  const [busy, setBusy] = useState(false);
  const BADGE: Record<string, [string, string]> = {
    map: ['매핑', 'bg-emerald-100 text-emerald-700'],
    order: ['공급가', 'bg-gray-100 text-gray-500'],
    saip: ['사입', 'bg-teal-100 text-teal-700'],
    importbase: ['1688', 'bg-purple-100 text-purple-600'],
    none: ['원가없음', 'bg-red-100 text-red-500'],
  };
  const badge = BADGE[row.cost_source || 'order'];

  const open = () => {
    setUnit(String(row.unit_cost || row.import_suggest_cost || ''));
    setBundle(String(row.bundle_size || 1));
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      await saveProductCostMap({
        exposure_id: row.exposure_id || '', product_seller_code: row.product_seller_code || '',
        product_name: row.product_name, unit_cost: parseInt(unit || '0', 10),
        bundle_size: Math.max(1, parseInt(bundle || '1', 10)), importbase_name: row.import_suggest_name || '',
      });
      setEditing(false); onSaved();
    } finally { setBusy(false); }
  };

  if (editing) {
    return (
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="개당" className="border rounded w-16 px-1 py-0.5 text-right text-xs" autoFocus />
          <span className="text-[10px] text-gray-400">×</span>
          <input value={bundle} onChange={e => setBundle(e.target.value)} title="봉다리(1판매당 개수)" className="border rounded w-9 px-1 py-0.5 text-right text-xs" />
          {row.import_suggest_cost ? (
            <button onClick={() => setUnit(String(row.import_suggest_cost))}
              title={`${row.import_suggest_src || '제안'}: ${row.import_suggest_name} (개당 ${row.import_suggest_cost})`}
              className={`text-[10px] px-1 rounded ${row.import_suggest_src === '사입' ? 'bg-teal-100 text-teal-700' : 'bg-purple-100 text-purple-600'}`}>
              {row.import_suggest_src === '사입' ? '사입' : '1688'}
            </button>
          ) : null}
          <button onClick={save} disabled={busy} className="text-[10px] px-1.5 py-0.5 bg-emerald-600 text-white rounded">{busy ? '…' : '저장'}</button>
          <button onClick={() => setEditing(false)} className="text-[10px] text-gray-400">×</button>
        </div>
      </td>
    );
  }
  return (
    <td className="px-2 py-1.5 text-right text-red-500 whitespace-nowrap group cursor-pointer" onClick={open} title="클릭하여 원가/봉다리 입력">
      {row.supply.toLocaleString()}
      <span className={`ml-1 text-[9px] px-1 rounded ${badge[1]}`} title={row.import_name || ''}>{badge[0]}</span>
      {row.unit_cost ? <span className="ml-1 text-[9px] text-gray-400">{row.unit_cost.toLocaleString()}×{row.bundle_size}</span> : null}
      <span className="ml-1 text-[10px] text-blue-500 opacity-0 group-hover:opacity-100">✏</span>
    </td>
  );
}

// 배송비 셀 — 표시 전용(오너클랜배송이면 배송비 0 + 뱃지). 지정은 체크박스+일괄버튼으로.
function ShipCell({ row }: { row: ProductSettlementRow }) {
  if (row.ship_excluded) {
    return (
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-semibold" title="오너클랜배송제품 — 배송비 미부담">🚚 오너클랜·0</span>
      </td>
    );
  }
  return <td className="px-2 py-1.5 text-right text-amber-600 tabular-nums">{(row.shipping || 0).toLocaleString()}</td>;
}

// 구매시간대 미니 막대 (판매자배송 주문시각 0~23시 분포, 피크 빨강)
function HourSpark({ hours, peak }: { hours?: { hour: number; qty: number }[]; peak?: number | null }) {
  if (!hours || hours.length === 0) return <span className="text-gray-300 text-xs">-</span>;
  const map: Record<number, number> = {};
  let max = 0;
  for (const h of hours) { map[h.hour] = h.qty; if (h.qty > max) max = h.qty; }
  const title = '구매시간대 — ' + hours.map(h => `${h.hour}시 ${h.qty}개`).join(' · ');
  return (
    <div className="inline-flex flex-col items-center" title={title}>
      <div className="inline-flex items-end gap-[1px] h-5">
        {Array.from({ length: 24 }, (_, h) => {
          const q = map[h] || 0;
          const ht = q ? Math.max(2, Math.round((q / max) * 18)) : 1;
          const isPeak = h === peak && q > 0;
          return <span key={h} style={{ height: `${ht}px`, width: '2px', background: q ? (isPeak ? '#e44232' : '#f9a8a0') : '#eee' }} />;
        })}
      </div>
      {peak != null && <span className="text-[10px] text-[#e44232] font-semibold leading-none mt-0.5">피크 {peak}시</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 📖 쿠팡 정산 완전정복 가이드 (앱 내 메뉴얼)
// ─────────────────────────────────────────────────────────────
type TabKey = 'settle' | 'revenue' | 'reconcile' | 'rocket' | 'product' | 'option' | 'unified';

function SettlementGuideModal({ onClose, onGoTab }: { onClose: () => void; onGoTab: (t: TabKey) => void }) {
  const Section = ({ no, title, sub, children }: { no: string; title: string; sub?: string; children: ReactNode }) => (
    <section className="mb-6">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#0074e9] text-white text-xs font-bold shrink-0">{no}</span>
        <h3 className="text-base font-extrabold text-gray-800">{title}</h3>
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </div>
      <div className="pl-8">{children}</div>
    </section>
  );

  const tabs: { key: TabKey; emoji: string; name: string; what: string; when: string; color: string }[] = [
    { key: 'unified', emoji: '🎯', name: '통합정산', color: '#0074e9',
      what: '전 계정의 확정정산(마켓플레이스 실정산 + 로켓그로스 실정산) 합계를 한눈에. API키/크롤링 있으면 "확정", 없으면 "추정".',
      when: '“이번 달 쿠팡에서 실제 받을 돈 총액”이 궁금할 때 — 가장 먼저 보는 화면.' },
    { key: 'product', emoji: '⭐', name: '상품별 정산', color: '#16a34a',
      what: '내 주문대장(order DB)에서 상품별 판매수량·정산액·원가·이익·마진을 집계. 원가 0이면 importbase 자동매칭.',
      when: '어떤 상품이 돈이 되는지(이익/마진) 보고 싶을 때.' },
    { key: 'option', emoji: '🔬', name: '옵션별 대조', color: '#7c3aed',
      what: '쿠팡 실제정산(API) ↔ 내 주문대장을 SKU(S코드) 기준으로 1:1 대조. 일치/쿠팡만/대장만으로 분류 + 차이금액.',
      when: '“쿠팡 정산금액과 내 장부가 맞는지” 상품 단위로 검증할 때. (현재 exansys 지원)' },
    { key: 'settle', emoji: '📅', name: '주차별 정산', color: '#0891b2',
      what: '쿠팡 Open API가 준 주정산(WEEKLY)·유보(RESERVE) 내역. 매출인식 월 단위로 조회, 지급일/지급예정 상태 포함.',
      when: '“언제 얼마가 입금되는지(지급일·예정)” 회차별로 확인할 때.' },
    { key: 'revenue', emoji: '🧾', name: '주문별 매출', color: '#ea580c',
      what: '쿠팡 Open API의 주문/상품 단위 원본 매출내역(수량·판매액·수수료·정산액·판매/환불 구분).',
      when: '특정 주문/상품의 쿠팡 원본 정산 숫자를 그대로 보고 싶을 때.' },
    { key: 'reconcile', emoji: '⚖️', name: '매출대조', color: '#d97706',
      what: '쿠팡 주문별 매출 ↔ 내 대장을 주문번호(orderId = bid_number)로 대조. 1원 이내 일치/불일치/DB없음 판정.',
      when: '주문번호 단위로 누락·금액오차를 잡아낼 때.' },
    { key: 'rocket', emoji: '🚀', name: '로켓그로스', color: '#16a34a',
      what: 'WING에서 크롤링한 로켓그로스 정산 리포트(주별 70% 지급 + 풀필먼트비/재고보상 등 상세 계산).',
      when: '로켓그로스(쿠팡 물류) 정산을 회차별로 확인할 때.' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[920px] max-w-[96vw] max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-gradient-to-r from-[#0074e9] to-[#00b2e3] rounded-t-xl">
          <h2 className="text-white text-lg font-extrabold">📖 쿠팡 정산 완전정복 가이드</h2>
          <button onClick={onClose} className="text-white/90 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {/* A. 정산 2종류 */}
          <Section no="1" title="쿠팡 정산은 2종류입니다" sub="둘은 데이터 출처도 지급방식도 다릅니다">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="border-2 border-[#0074e9] rounded-lg p-3 bg-blue-50/30">
                <div className="font-bold text-[#0074e9] mb-1">🏪 마켓플레이스 (판매자배송)</div>
                <ul className="text-sm text-gray-700 space-y-1 list-disc pl-4">
                  <li>출처: <b>쿠팡 Open API</b> (access/secret key)</li>
                  <li>지급: <b>주정산(WEEKLY)</b> + 일부 <b>유보(RESERVE)</b></li>
                  <li>유보분은 다음 달 추가 지급 (월정산 아님)</li>
                  <li>매출인식 = 주 단위(월~일)</li>
                </ul>
              </div>
              <div className="border-2 border-[#16a34a] rounded-lg p-3 bg-green-50/30">
                <div className="font-bold text-[#16a34a] mb-1">🚀 로켓그로스 (쿠팡 물류)</div>
                <ul className="text-sm text-gray-700 space-y-1 list-disc pl-4">
                  <li>출처: <b>WING 크롤링</b> (정산현황 페이지)</li>
                  <li>지급: <b>주별 70%</b> (지급비율 가변)</li>
                  <li>풀필먼트비·재고손실보상 등 차감/가산</li>
                  <li>리포트는 회차 총액만 (상품별 분해 ✕)</li>
                </ul>
              </div>
            </div>
          </Section>

          {/* B. 주정산 구조 */}
          <Section no="2" title="주정산 구조 — “주지급 + 유보”" sub="한 주 매출이 두 번에 나눠 들어옵니다">
            <div className="bg-gray-50 border rounded-lg p-3 text-sm text-gray-700 leading-relaxed">
              한 주(월~일) 매출인식분의 정산대상액이 →
              <span className="mx-1 px-2 py-0.5 rounded bg-[#0074e9] text-white text-xs font-bold">주지급(WEEKLY)</span>
              으로 일부 먼저,
              <span className="mx-1 px-2 py-0.5 rounded bg-amber-500 text-white text-xs font-bold">유보(RESERVE)</span>
              로 나머지가 <b>다음 달</b>에 추가 지급됩니다.
              <div className="mt-2 text-[12px] text-gray-500">
                ⚠️ 그래서 “그 주의 정산금액”과 “그 주에 실제 입금된 금액”은 다릅니다. 상품별 정산을 정확히 보려면 <b>지급일이 아니라 매출인식 주(週)</b> 기준으로 보세요.
              </div>
            </div>
          </Section>

          {/* C. 로켓그로스 계산식 */}
          <Section no="3" title="로켓그로스 정산 계산식" sub="WING 상세보기에서 추출">
            <div className="bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-[12px] leading-6">
              <div><span className="text-sky-300">매출금액(A)</span> = 판매액(a) − 취소액</div>
              <div><span className="text-sky-300">판매기준매출액(D)</span> = A − 판매수수료(B) − 상계/쿠폰(C)</div>
              <div><span className="text-emerald-300">지급액(H)</span> = D × 지급비율(%) <span className="text-gray-400">(보통 70%)</span></div>
              <div className="mt-1 pt-1 border-t border-gray-700">
                <span className="text-amber-300 font-bold">최종지급액</span> = H − I(추가상계) − <span className="text-rose-300">J(풀필먼트비)</span> + <span className="text-emerald-300">K(재고손실보상)</span>
              </div>
              <div className="text-gray-400 mt-1">J = 입출고비 + 배송비 + 보관비 + 반품회수비 + 반품재입고비 + 반출배송비</div>
            </div>
          </Section>

          {/* D. 탭 사용설명 */}
          <Section no="4" title="화면(탭)별 사용법" sub="각 탭은 서로 다른 질문에 답합니다 — 바로 이동 가능">
            <div className="space-y-2">
              {tabs.map(t => (
                <div key={t.key} className="border rounded-lg p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-bold" style={{ color: t.color }}>{t.emoji} {t.name}</span>
                    <button onClick={() => onGoTab(t.key)}
                      className="text-xs px-2 py-0.5 rounded border font-semibold text-gray-600 hover:bg-gray-100 whitespace-nowrap">이 화면 열기 →</button>
                  </div>
                  <div className="text-sm text-gray-700">{t.what}</div>
                  <div className="text-[12px] text-gray-500 mt-0.5">📍 <b>언제 보나:</b> {t.when}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* E. 정산 확인 5단계 */}
          <Section no="5" title="정산 확인 5단계 (추천 순서)">
            <ol className="space-y-2">
              {[
                ['통합정산에서 “이번 달 받을 돈 총액” 확인', '🎯 통합정산'],
                ['주차별 정산에서 지급일·지급예정 회차 확인 (마켓플레이스)', '📅 주차별 정산'],
                ['로켓그로스 탭에서 로켓 정산 회차 확인 (필요시 크롤링 갱신)', '🚀 로켓그로스'],
                ['옵션별 대조로 쿠팡정산 ↔ 내 장부가 SKU별로 맞는지 검증', '🔬 옵션별 대조'],
                ['불일치/차이 큰 건은 매출대조(주문번호)로 원인 추적 + 엑셀 다운로드', '⚖️ 매출대조'],
              ].map(([txt, tag], i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                  <span className="text-sm text-gray-700">{txt} <span className="text-[11px] text-gray-400">({tag})</span></span>
                </li>
              ))}
            </ol>
          </Section>

          {/* F. 대조결과 해석 */}
          <Section no="6" title="대조 결과 해석법">
            <div className="grid md:grid-cols-3 gap-2 text-sm">
              <div className="border rounded-lg p-2 bg-emerald-50"><b className="text-emerald-700">✅ 일치</b><div className="text-gray-600 text-[12px]">쿠팡정산 = 내 장부 (차이 ≤ 1원). 정상.</div></div>
              <div className="border rounded-lg p-2 bg-blue-50"><b className="text-blue-700">🔵 쿠팡만</b><div className="text-gray-600 text-[12px]">쿠팡엔 정산됐는데 내 대장에 없음 → 대장 누락/SKU 미등록 의심.</div></div>
              <div className="border rounded-lg p-2 bg-amber-50"><b className="text-amber-700">🟠 대장만</b><div className="text-gray-600 text-[12px]">내 대장엔 있는데 쿠팡 정산 미노출 → 미정산/기간밖/반품 의심.</div></div>
            </div>
            <div className="text-[12px] text-gray-500 mt-2">차이(쿠팡−대장)가 <b className="text-red-500">+</b>면 쿠팡이 더 많음, <b className="text-blue-600">−</b>면 대장이 더 많음. 반품/취소 건은 대장에서 자동 제외 후 비교합니다.</div>
          </Section>

          {/* G. 제약/주의 */}
          <Section no="7" title="제약 & 주의사항">
            <ul className="text-sm text-gray-700 space-y-1 list-disc pl-4">
              <li><b>옵션별 대조</b>: 쿠팡 API 제약으로 <b>기간 1개월 미만 · 종료일 ≤ 어제</b>만 조회됩니다.</li>
              <li><b>로켓그로스</b>: WING 정산현황은 <b>현재/직전 회차만</b> 노출 → 과거 누적은 한 번에 안 잡힐 수 있습니다.</li>
              <li><b>엑셀 다운로드</b>: 옵션별 대조 화면의 <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-semibold">📥 엑셀 다운로드</span> 로 대조표를 그대로 받습니다.</li>
              <li>금액이 안 보이면 먼저 <b>⚙ 계정 설정</b>에서 API키/WING 로그인 인증을 확인하세요.</li>
            </ul>
          </Section>

          <div className="text-center text-[11px] text-gray-400 border-t pt-3">
            이 가이드는 실제 구현 로직(코드) 기준으로 작성되었습니다 · 상세 문서: docs/COUPANG_SETTLEMENT.md
          </div>
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={() => onGoTab('unified')} className="px-4 py-1.5 rounded bg-[#0074e9] text-white text-sm font-semibold">🎯 통합정산부터 보기</button>
          <button onClick={onClose} className="px-4 py-1.5 rounded border text-sm font-semibold text-gray-600 hover:bg-gray-100">닫기</button>
        </div>
      </div>
    </div>
  );
}
