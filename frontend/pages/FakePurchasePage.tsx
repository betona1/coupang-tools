import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import {
  getSales, markFake, getMarks, batchTransfer, updateMark, lookupCost, lookupShipping, getFakeConfig, setDefaultShipping,
  getManual, createManual, updateManual, batchTransferManual, deleteManual,
  getGagumaeConfig, saveGagumaeConfig, checkGagumae, enterGagumaeRoom, getGagumaeBuyers,
  type SalesResponse, type SaleRow, type FakeMark, type ManualEntry, type CostCandidate,
  type GagumaeConfig, type GagumaeStatus, type GagumaeBuyer,
} from '../api/fakePurchaseApi';

const won = (n: number) => '₩' + (n || 0).toLocaleString();

// 구매자 리스트 → 우리은행 대량이체 양식 (헤더 없음, 은행/계좌/금액/예금주/통장표시)
function exportBuyersExcel(buyers: GagumaeBuyer[], roomDate?: string) {
  if (!buyers?.length) return;
  const aoa = buyers
    .filter(b => (b.buyer_account || '').replace(/\D/g, ''))   // 계좌번호 있는 것만
    .map(b => {
      const name = b.buyer_depositor || b.buyer_name || b.buyer_username || '';
      return [
        b.buyer_bank || '',                        // 은행
        (b.buyer_account || '').replace(/\D/g, ''), // 계좌번호 (숫자만)
        Number(b.price || 0),                       // 금액
        name,                                       // 예금주
        name,                                       // 통장표시(적요)
      ];
    });
  if (!aoa.length) { alert('계좌번호가 있는 구매자가 없습니다.'); return; }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const tag = (roomDate || '').replace(/[^0-9]/g, '') || 'room';
  XLSX.writeFile(wb, `구매자계좌_${tag}.xls`, { bookType: 'biff8' });
}

export default function FakePurchasePage() {
  const [tab, setTab] = useState<'sales' | 'fake'>('sales');
  const [data, setData] = useState<SalesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [onlyFake, setOnlyFake] = useState(false);
  const [marksKey, setMarksKey] = useState(0);
  const [manualKey, setManualKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getSales(days, search || undefined, onlyFake));
    } finally {
      setLoading(false);
    }
  }, [days, search, onlyFake]);

  useEffect(() => { load(); }, [load]);

  const toggleFake = async (r: SaleRow) => {
    const next = !r.is_fake;
    await markFake(r.order_code, next);
    await load();
    setMarksKey(k => k + 1);  // 지정 목록 갱신
  };

  const t = data?.totals;

  return (
    <div className="p-4 max-w-[1800px] mx-auto">
      {/* 헤더 + 탭 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h1 className="text-lg font-bold flex items-center gap-2 mr-2">
          <span className="text-[#7c3aed]">●</span> 가구매
        </h1>
        <div className="inline-flex rounded-md overflow-hidden border text-sm">
          {([['sales', '최근매출'], ['fake', '가구매목록']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-1.5 font-semibold transition-colors ${tab === k ? 'bg-[#7c3aed] text-white' : 'bg-white text-gray-500 hover:bg-purple-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {loading && tab === 'sales' && <span className="text-xs text-gray-400 animate-pulse">불러오는 중...</span>}
      </div>

      <GagumaePanel onPushed={() => { setManualKey(k => k + 1); setTab('fake'); }} />

      {tab === 'sales' && (
      <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
          {[7, 14, 30].map(d => <option key={d} value={d}>최근 {d}일</option>)}
        </select>
        <form onSubmit={e => { e.preventDefault(); setSearch(q.trim()); }} className="flex items-center gap-1">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="수령자명 검색" className="border rounded px-2 py-1 text-sm w-40" />
          <button className="px-3 py-1 rounded bg-[#7c3aed] text-white text-sm font-semibold">검색</button>
          {search && <button type="button" onClick={() => { setQ(''); setSearch(''); }} className="text-xs text-gray-400 hover:underline">초기화</button>}
        </form>
        <label className="flex items-center gap-1 text-sm text-gray-600">
          <input type="checkbox" checked={onlyFake} onChange={e => setOnlyFake(e.target.checked)} className="accent-[#7c3aed]" />
          가구매만 보기
        </label>
      </div>

      {/* 요약 */}
      {t && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          <Sum label="건수" value={`${t.count}건`} />
          <Sum label="실매출 (가구매 제외)" value={won(t.sale)} color="#0074e9" />
          <Sum label="순이익 (가구매 손실 반영)" value={won(t.profit)} color={t.profit < 0 ? '#ef4444' : '#16a34a'} />
          <Sum label="가구매 손실" value={`${t.fake_count}건 / ${won(t.fake_loss)}`} color="#ef4444" />
          <Sum label="돌려줄 금액 (구입가)" value={won(t.fake_refund)} color="#7c3aed" />
        </div>
      )}

      {/* 매출 대장 */}
      <div className="overflow-x-auto border rounded mb-8">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-2 py-2 text-left">주문일</th>
              <th className="px-2 py-2 text-left">사이트</th>
              <th className="px-2 py-2 text-left">수령자</th>
              <th className="px-2 py-2 text-left">상품명</th>
              <th className="px-2 py-2 text-right">수량</th>
              <th className="px-2 py-2 text-right">매출</th>
              <th className="px-2 py-2 text-right">원가</th>
              <th className="px-2 py-2 text-right">이익</th>
              <th className="px-2 py-2 text-center">가구매</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map(r => (
              <tr key={r.order_code} className={`border-t hover:bg-gray-50 ${r.is_fake ? 'bg-purple-50' : ''}`}>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.order_date}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">{r.site_name}</td>
                <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.receiver_name || '-'}</td>
                <td className="px-2 py-1.5 max-w-[420px] truncate" title={r.product_name}>{r.product_name}</td>
                <td className="px-2 py-1.5 text-right">{r.quantity}</td>
                <td className="px-2 py-1.5 text-right">
                  {r.sale.toLocaleString()}
                  {r.is_fake && <span className="block text-[9px] text-[#7c3aed]">구입가(환급)</span>}
                </td>
                <td className={`px-2 py-1.5 text-right ${r.is_fake ? 'text-red-500 font-semibold' : 'text-gray-500'}`}
                    title={r.is_fake ? `영업비 = 수수료 ${r.fee.toLocaleString()} + 배송비 ${r.shipping.toLocaleString()} + 사입원가 ${r.product_cost.toLocaleString()} + 포장비 ${r.packaging.toLocaleString()}` : ''}>
                  {r.cost.toLocaleString()}
                  {r.is_fake && <span className="block text-[9px] text-gray-400">수{r.fee.toLocaleString()}+배{r.shipping.toLocaleString()}+원{r.product_cost.toLocaleString()}+포{r.packaging.toLocaleString()}</span>}
                </td>
                <td className={`px-2 py-1.5 text-right font-bold ${r.profit < 0 ? 'text-red-500' : 'text-green-600'}`}>{r.profit.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => toggleFake(r)}
                    className={`text-xs px-2 py-1 rounded font-semibold ${r.is_fake ? 'bg-[#7c3aed] text-white' : 'border text-gray-500 hover:bg-purple-50'}`}
                  >
                    {r.is_fake ? '✓ 가구매' : '가구매 지정'}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-8 text-center text-gray-400">해당 기간 매출이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}

      {tab === 'fake' && (
      <>
        {/* 통합 가구매 목록 (지정 + 수동) */}
        <MarksList refreshKey={marksKey} manualRefresh={manualKey} />

        {/* 수동 가구매 입력 폼 */}
        <div className="mt-4"><ManualForm onAdded={() => setManualKey(k => k + 1)} /></div>
      </>
      )}
    </div>
  );
}

function Sum({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white border rounded-lg p-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-base font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

// ── 치트키 가구매방 패널 (자동입장·설정·접속상태·입장) ──
function GagumaePanel({ onPushed }: { onPushed?: () => void }) {
  const [cfg, setCfg] = useState<GagumaeConfig | null>(null);
  const [status, setStatus] = useState<GagumaeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState({ base: '', user: '', pw: '', auto_enter: true, start_hour: 16, retry_min: 5, fail_notify_min: 30, telegram: true });
  const [msg, setMsg] = useState('');
  const [buyers, setBuyers] = useState<GagumaeBuyer[] | null>(null);
  const [buyersBusy, setBuyersBusy] = useState(false);
  const [pushed, setPushed] = useState<Set<number>>(new Set());
  const enteredRef = useRef(false);

  const loadBuyers = async (save = false) => {
    setBuyersBusy(true); setMsg(save ? '구매자 계좌 저장 중...' : '가구매방에서 가져오는 중...');
    try {
      const r = await getGagumaeBuyers(status?.open_room?.id, save);
      if (r.error) { setMsg(`❌ ${r.error}`); setBuyers([]); }
      else { setBuyers(r.buyers); setPushed(new Set()); setMsg(save ? `💾 ${r.saved ?? r.count}명 계좌 저장됨` : `📥 가구매자 ${r.count}명 가져옴`); }
    } catch (e: any) { setMsg(`❌ ${String(e?.message || e).slice(0, 80)}`); }
    finally { setBuyersBusy(false); }
  };

  // 가구매자 → 가구매 처리중(수동입력)으로 넘기기
  const today = () => new Date().toISOString().slice(0, 10);
  const pushOne = async (b: GagumaeBuyer, idx: number) => {
    await createManual({
      purchase_date: today(),
      recipient: b.buyer_name || b.buyer_username || '',
      site_name: '치트키가구매',
      product_name: b.product_name,
      is_rocket: b.shipping_type === '로켓',
      amount: Number(b.price || 0),
      quantity: b.quantity || 1,
      deposit_memo: [b.buyer_bank, (b.buyer_account || '').replace(/\D/g, ''), b.buyer_depositor].filter(Boolean).join(' '),
      memo: b.option_text || '',
    });
    setPushed(p => new Set(p).add(idx));
  };
  const pushAll = async () => {
    if (!buyers) return;
    setBuyersBusy(true); setMsg('가구매 처리중으로 넘기는 중...');
    try {
      let n = 0;
      for (let i = 0; i < buyers.length; i++) { if (!pushed.has(i)) { await pushOne(buyers[i], i); n++; } }
      setMsg(`↪ ${n}건 가구매 처리중으로 넘김`);
      onPushed?.();
    } catch (e: any) { setMsg(`❌ ${String(e?.message || e).slice(0, 80)}`); }
    finally { setBuyersBusy(false); }
  };

  const check = useCallback(async () => {
    setChecking(true);
    try { setStatus(await checkGagumae()); } finally { setChecking(false); }
  }, []);

  useEffect(() => {
    getGagumaeConfig().then(c => {
      setCfg(c); setForm({ base: c.base, user: c.user, pw: '', auto_enter: c.auto_enter,
        start_hour: c.start_hour, retry_min: c.retry_min, fail_notify_min: c.fail_notify_min, telegram: c.telegram });
    }).catch(() => {});
    check();
  }, [check]);

  // 자동입장: 설정 켜져있고 열린방 있으면 1회 자동 입장
  useEffect(() => {
    if (cfg?.auto_enter && status?.ok && status.open_room && !enteredRef.current) {
      enteredRef.current = true;
      enterGagumaeRoom(status.open_room.id).then(r => {
        setMsg(r?.ok !== false ? `✅ ${status.open_room!.date} 맞구매방 자동입장` : `입장 응답: ${JSON.stringify(r).slice(0, 60)}`);
      }).catch(() => {});
    }
  }, [cfg, status]);

  const save = async () => {
    await saveGagumaeConfig(form);
    setShowSettings(false); setMsg('설정 저장됨');
    getGagumaeConfig().then(setCfg); check();
  };
  const enter = async () => {
    setMsg('입장 중...');
    const r = await enterGagumaeRoom(status?.open_room?.id);
    setMsg(r?.error ? `❌ ${r.error}` : `✅ 입장 (방 ${r.room_id})`);
  };

  const room = status?.open_room;
  return (
    <div className="mb-4 border rounded-lg p-3 bg-purple-50/40">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-bold text-[#7c3aed]">🎯 치트키 가구매방</span>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer" title="열린 방이 있으면 자동으로 입장(참여)">
          <input type="checkbox" checked={!!cfg?.auto_enter} className="accent-[#7c3aed]"
            onChange={async e => { const c = { ...form, auto_enter: e.target.checked, pw: '' }; await saveGagumaeConfig(c); getGagumaeConfig().then(setCfg); }} />
          <b>자동입장</b>
        </label>
        {/* 접속상태 */}
        {checking ? <span className="text-xs text-gray-400 animate-pulse">접속 확인중...</span>
          : status?.ok
            ? (room
                ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">🟢 열림 · {room.date}</span>
                : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 font-semibold">⚪ 아직 오픈 안함 (수요일 16시)</span>)
            : <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-semibold">🔴 접속실패</span>}
        {status?.ok && <span className="text-[11px] text-gray-400">{status.user} · 방 {status.rooms}개</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={check} className="text-xs px-2 py-1 rounded border">새로고침</button>
          {(room || status?.my_register) && <button onClick={() => loadBuyers(false)} disabled={buyersBusy} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white font-semibold disabled:opacity-50">📥 가져오기</button>}
          {room && <button onClick={enter} className="text-xs px-2 py-1 rounded bg-[#7c3aed] text-white font-semibold">입장</button>}
          {status?.base && (status.latest_room || room) && (
            <a href={`${status.base}/dashboard/crossbuy/room.php?id=${(room || status.latest_room)!.id}`} target="_blank" rel="noreferrer"
              className="text-xs px-2 py-1 rounded border text-blue-600">방 열기 🔗</a>
          )}
          <button onClick={() => setShowSettings(s => !s)} className="text-xs px-2 py-1 rounded border">⚙ 설정</button>
        </div>
      </div>
      {msg && <div className="text-[11px] text-gray-500 mt-1">{msg}</div>}
      {!status?.ok && status?.error && <div className="text-[11px] text-red-500 mt-1">{status.error}</div>}
      {/* 상품등록 알람 (열린방인데 내 상품 0개 → 목 12시 마감) */}
      {status?.need_register && status.open_room && (
        <div className="mt-2 flex items-center gap-2 flex-wrap bg-red-50 border-2 border-red-300 rounded-lg px-3 py-2 animate-pulse">
          <span className="text-red-600 font-bold">🛒 맞구매 상품등록 해야합니다!</span>
          <span className="text-[12px] text-red-500">⏰ 목요일 12시 마감 · {status.open_room.date} 맞구매방</span>
          <button onClick={async () => { await enterGagumaeRoom(status.open_room!.id); window.open(`${status.base}/dashboard/crossbuy/room.php?id=${status.open_room!.id}`, '_blank'); }}
            className="ml-auto text-sm px-3 py-1 rounded bg-red-600 text-white font-bold hover:bg-red-700">상품등록 하러가기 🔗</button>
        </div>
      )}
      {showSettings && (
        <div className="mt-2 pt-2 border-t space-y-2 text-sm">
          <div className="flex items-end gap-2 flex-wrap">
            <label className="flex flex-col">주소<input value={form.base} onChange={e => setForm({ ...form, base: e.target.value })} placeholder="http://호스트:포트" className="border rounded px-2 py-1 w-56" /></label>
            <label className="flex flex-col">아이디<input value={form.user} onChange={e => setForm({ ...form, user: e.target.value })} className="border rounded px-2 py-1 w-32" /></label>
            <label className="flex flex-col">비번<input type="password" value={form.pw} onChange={e => setForm({ ...form, pw: e.target.value })} placeholder={cfg?.has_pw ? '(변경시만)' : ''} className="border rounded px-2 py-1 w-32" /></label>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="flex flex-col">시작시각(시)<input type="number" min={0} max={23} value={form.start_hour} onChange={e => setForm({ ...form, start_hour: +e.target.value })} className="border rounded px-2 py-1 w-20" /></label>
            <label className="flex flex-col">재시도(분)<input type="number" min={1} value={form.retry_min} onChange={e => setForm({ ...form, retry_min: +e.target.value })} className="border rounded px-2 py-1 w-20" /></label>
            <label className="flex flex-col">실패알림(분)<input type="number" min={1} value={form.fail_notify_min} onChange={e => setForm({ ...form, fail_notify_min: +e.target.value })} className="border rounded px-2 py-1 w-24" /></label>
            <label className="flex items-center gap-1 pb-1.5"><input type="checkbox" checked={form.telegram} onChange={e => setForm({ ...form, telegram: e.target.checked })} className="accent-[#7c3aed]" /> 텔레그램 알림</label>
          </div>
          <div className="text-[11px] text-gray-400">매주 수요일 {form.start_hour}시부터 {form.retry_min}분마다 입장 시도 · 성공 시 종료 · 실패 시 {form.fail_notify_min}분마다 알림</div>
          <button onClick={save} className="px-3 py-1.5 rounded bg-[#7c3aed] text-white font-semibold">저장</button>
        </div>
      )}
      {/* 가구매방에서 가져온 정보: 나의 상품정보 + 가구매자 리스트 */}
      {buyers && (
        <div className="mt-2 pt-2 border-t">
          {/* 나의 상품정보 (상품별 구매자 수) */}
          <div className="mb-2">
            <div className="text-sm font-bold mb-1">📦 나의 상품정보</div>
            {Array.from(new Map(buyers.map(b => [b.product_name, b])).values()).map((p, i) => {
              const cnt = buyers.filter(x => x.product_name === p.product_name).length;
              return (
                <div key={i} className="flex items-center gap-2 text-[12px] py-0.5">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${p.shipping_type === '로켓' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                    {p.shipping_type === '로켓' ? '🚀 로켓' : '📦 일반배송'}
                  </span>
                  <span className="truncate max-w-[420px]" title={p.product_name}>{p.product_name}</span>
                  <span className="text-gray-400">· 가구매자 {cnt}명</span>
                </div>
              );
            })}
          </div>
          {/* 가구매자 리스트 */}
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm">가구매자 리스트</span>
            <span className="text-[11px] text-gray-400">{buyers.length}명</span>
            <button onClick={pushAll} disabled={buyersBusy || !buyers.length || pushed.size >= buyers.length}
              className="ml-auto text-xs px-2 py-1 rounded bg-[#7c3aed] text-white font-semibold disabled:opacity-50">↪ 전체 가구매 처리중으로</button>
            <button onClick={() => exportBuyersExcel(buyers, status?.open_room?.date)} disabled={!buyers.length}
              className="text-xs px-2 py-1 rounded bg-green-700 text-white font-semibold disabled:opacity-50">📥 엑셀</button>
            <button onClick={() => loadBuyers(true)} disabled={buyersBusy || !buyers.length}
              className="text-xs px-2 py-1 rounded bg-emerald-600 text-white font-semibold disabled:opacity-50">💾 계좌 저장</button>
            <button onClick={() => setBuyers(null)} className="text-xs px-2 py-1 rounded border">닫기</button>
          </div>
          {!buyers.length ? <div className="text-[12px] text-gray-400 py-2">가구매자가 없습니다.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600">
                    <th className="px-2 py-1 text-left">상품</th>
                    <th className="px-2 py-1 text-left">옵션</th>
                    <th className="px-2 py-1 text-center">배송</th>
                    <th className="px-2 py-1 text-right">수량</th>
                    <th className="px-2 py-1 text-right">금액</th>
                    <th className="px-2 py-1 text-left">구매자</th>
                    <th className="px-2 py-1 text-left">계좌 (은행/번호/예금주)</th>
                    <th className="px-2 py-1 text-center">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {buyers.map((b, i) => (
                    <tr key={i} className="border-b hover:bg-purple-50/40">
                      <td className="px-2 py-1 max-w-[220px] truncate" title={b.product_name}>{b.product_name}</td>
                      <td className="px-2 py-1 text-gray-500">{b.option_text || '-'}</td>
                      <td className="px-2 py-1 text-center">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${b.shipping_type === '로켓' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {b.shipping_type === '로켓' ? '🚀 로켓' : '📦 일반배송'}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right">{b.quantity}</td>
                      <td className="px-2 py-1 text-right">{Number(b.price || 0).toLocaleString()}</td>
                      <td className="px-2 py-1 font-medium">{b.buyer_name || b.buyer_username || '-'}</td>
                      <td className="px-2 py-1">
                        {b.buyer_account
                          ? <span className="font-mono">{b.buyer_bank} {b.buyer_account}{b.buyer_depositor ? ` (${b.buyer_depositor})` : ''}</span>
                          : <span className="text-gray-300">미지정</span>}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {pushed.has(i)
                          ? <span className="text-[11px] text-green-600 font-semibold">✓ 넘김</span>
                          : <button onClick={async () => { await pushOne(b, i); onPushed?.(); }} disabled={buyersBusy}
                              className="text-[11px] px-2 py-0.5 rounded border text-[#7c3aed] hover:bg-purple-50 disabled:opacity-50">처리중 ↪</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 통합 가구매 목록 (지정 + 수동) ──
type UItem =
  | { kind: 'mark'; key: string; transferred: boolean; transferred_at: string | null; mark: FakeMark }
  | { kind: 'manual'; key: string; transferred: boolean; transferred_at: string | null; man: ManualEntry };

function MarksList({ refreshKey, manualRefresh }: { refreshKey: number; manualRefresh: number }) {
  const [marks, setMarks] = useState<FakeMark[]>([]);
  const [manual, setManual] = useState<ManualEntry[]>([]);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipMsg, setShipMsg] = useState('');
  const autoRan = useRef(false);
  const load = () => Promise.all([getMarks(), getManual()])
    .then(([mk, mn]) => { setMarks(mk); setManual(mn); }).catch(() => {});
  useEffect(() => { load(); }, [refreshKey, manualRefresh]);

  // 실배송비 자동조회 (최초 1회) — CJ 송장 데이터 있으면 반영
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    lookupShipping().then((r: any) => { if (r?.updated > 0) load(); }).catch(() => {});
  }, []);

  const refreshShipping = async () => {
    setShipBusy(true); setShipMsg('');
    try {
      const r = await lookupShipping();
      setShipMsg(r?.updated > 0 ? `실배송비 ${r.updated}건 반영됨` : `실배송비 데이터 없음 (기본 ${defShip} 유지)`);
      if (r?.updated > 0) await load();
    } finally { setShipBusy(false); setTimeout(() => setShipMsg(''), 4000); }
  };

  // 기본 배송비 전역 설정
  const [defShip, setDefShip] = useState(2640);
  useEffect(() => { getFakeConfig().then(c => setDefShip(c.default_shipping_cost)).catch(() => {}); }, []);
  const saveDefShip = async (v: number) => {
    setDefShip(v);
    const r = await setDefaultShipping(v, true);
    setShipMsg(`기본 배송비 ${v.toLocaleString()}원 저장${r.updated ? ` (기존 ${r.updated}건 반영)` : ''}`);
    await load();
    setTimeout(() => setShipMsg(''), 4000);
  };

  // ── 통합 아이템 (지정 마크 + 수동입력) ──
  const items: UItem[] = [
    ...marks.map(m => ({ kind: 'mark' as const, key: m.order_code, transferred: m.transferred, transferred_at: m.transferred_at, mark: m })),
    ...manual.map(m => ({ kind: 'manual' as const, key: 'man-' + m.id, transferred: m.transferred, transferred_at: m.transferred_at, man: m })),
  ];

  const [subTab, setSubTab] = useState<string>('processing');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const dKey = (it: UItem) => (it.transferred_at || '').slice(0, 10);
  const processing = items.filter(it => !it.transferred);
  const completed = items.filter(it => it.transferred);
  const dates = Array.from(new Set(completed.map(dKey))).filter(Boolean).sort().reverse();
  const isProc = subTab === 'processing';
  const isAll = subTab === 'all';
  const rows = isAll ? items : isProc ? processing : completed.filter(it => dKey(it) === subTab);
  const visProc = rows.filter(it => !it.transferred);

  const toggleSel = (k: string) => setSel(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allSel = visProc.length > 0 && visProc.every(it => sel.has(it.key));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(visProc.map(it => it.key)));
  const doTransfer = async (keysIn?: string[]) => {
    const keys = (keysIn || [...sel]).filter(k => processing.some(it => it.key === k));
    if (!keys.length) return;
    const codes = items.filter(it => it.kind === 'mark' && keys.includes(it.key)).map(it => it.key);
    const ids = items.filter(it => it.kind === 'manual' && keys.includes(it.key)).map(it => (it as any).man.id as number);
    if (codes.length) await batchTransfer(codes, true);
    if (ids.length) await batchTransferManual(ids, true);
    setSel(new Set());
    await load();
    if (!isAll) setSubTab(new Date().toISOString().slice(0, 10));
  };
  const transferAll = () => doTransfer(processing.map(it => it.key));
  const revert = async (it: UItem) => {
    if (it.kind === 'mark') await batchTransfer([it.key], false);
    else await batchTransferManual([(it as any).man.id], false);
    await load();
  };

  const itemLoss = (it: UItem) => it.kind === 'mark' ? (it.mark.loss || 0) : (it.man.loss || 0);
  const itemRefund = (it: UItem) => it.kind === 'mark' ? (it.mark.purchase_price || 0) : (it.man.amount || 0);
  const tLoss = rows.reduce((s, it) => s + itemLoss(it), 0);
  const tRefund = rows.reduce((s, it) => s + itemRefund(it), 0);

  return (
    <div className="border rounded-lg p-4 bg-purple-50">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h2 className="text-base font-bold">가구매 정산 <span className="text-xs font-normal text-gray-400">(지정+수동 통합 · 영업비 = 수수료 + 실배송비 + 원가 + 포장비100)</span></h2>
        <button onClick={refreshShipping} disabled={shipBusy} className="text-xs px-2 py-1 rounded bg-[#16a34a] text-white font-semibold disabled:opacity-50">
          {shipBusy ? '조회 중...' : '🚚 실배송비 조회'}
        </button>
        <label className="flex items-center gap-1 text-xs text-gray-600 ml-1">
          기본 배송비
          <input type="text" inputMode="numeric" defaultValue={defShip} key={defShip}
            onBlur={e => { const v = parseInt(e.target.value || '0', 10) || 0; if (v !== defShip) saveDefShip(v); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="border rounded w-20 px-1 py-0.5 text-right" />
          원
        </label>
        {shipMsg && <span className="text-xs text-[#16a34a] font-semibold">{shipMsg}</span>}
      </div>

      {/* 처리중 / 완료일 / 전체 서브탭 */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <button onClick={() => setSubTab('processing')}
          className={`px-3 py-1 rounded-md text-sm font-semibold ${isProc ? 'bg-[#7c3aed] text-white' : 'bg-white border text-gray-500 hover:bg-purple-50'}`}>
          🕗 처리중 ({processing.length})
        </button>
        {dates.map(d => (
          <button key={d} onClick={() => setSubTab(d)}
            className={`px-3 py-1 rounded-md text-sm font-semibold ${subTab === d ? 'bg-green-600 text-white' : 'bg-white border text-gray-500 hover:bg-green-50'}`}>
            ✅ {d} ({completed.filter(it => dKey(it) === d).length})
          </button>
        ))}
        <button onClick={() => setSubTab('all')}
          className={`px-3 py-1 rounded-md text-sm font-semibold ${isAll ? 'bg-gray-700 text-white' : 'bg-white border text-gray-500 hover:bg-gray-100'}`}>
          📋 전체 ({items.length})
        </button>
      </div>

      {/* 일괄 이체완료 */}
      {visProc.length > 0 && (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button onClick={() => doTransfer()} disabled={!sel.size}
            className="text-xs px-3 py-1 rounded bg-[#16a34a] text-white font-semibold disabled:opacity-40">
            ↙ 선택 {sel.size}건 이체완료처리 →
          </button>
          <button onClick={transferAll}
            className="text-xs px-3 py-1 rounded bg-[#0074e9] text-white font-semibold">
            기존 처리중 {processing.length}건 전부 완료처리
          </button>
          <span className="text-[11px] text-gray-400">또는 각 행 "이체확인" 즉시 체크</span>
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded border">
        <table className="w-full text-sm">
          <thead className="bg-gray-100"><tr>
            <th className="px-2 py-1.5 text-center w-8">{visProc.length > 0 ? <input type="checkbox" checked={allSel} onChange={toggleAll} className="accent-[#7c3aed]" title="전체선택" /> : ''}</th>
            <th className="px-2 py-1.5 text-left">주문일</th>
            <th className="px-2 py-1.5 text-left">수령자</th>
            <th className="px-2 py-1.5 text-left">상품명</th>
            <th className="px-2 py-1.5 text-right">구입가(환급)</th>
            <th className="px-2 py-1.5 text-right">수수료</th>
            <th className="px-2 py-1.5 text-right">배송비</th>
            <th className="px-2 py-1.5 text-center">사입단가 × 구성 × 수량 = 원가</th>
            <th className="px-2 py-1.5 text-right">포장</th>
            <th className="px-2 py-1.5 text-right">영업비</th>
            <th className="px-2 py-1.5 text-center">이체완료</th>
          </tr></thead>
          <tbody>
            {rows.map(it => it.kind === 'mark' ? (
              <MarkRow key={it.key} m={it.mark} onSaved={load}
                mode={it.transferred ? 'done' : 'processing'}
                selected={sel.has(it.key)} onToggleSelect={() => toggleSel(it.key)}
                onRevert={() => revert(it)} />
            ) : (
              <ManualRow key={it.key} m={it.man} onSaved={load}
                mode={it.transferred ? 'done' : 'processing'}
                selected={sel.has(it.key)} onToggleSelect={() => toggleSel(it.key)}
                onRevert={() => revert(it)} />
            ))}
            {rows.length === 0 && <tr><td colSpan={11} className="px-2 py-6 text-center text-gray-400">
              {isProc ? '처리중인 가구매가 없습니다.' : isAll ? '가구매가 없습니다.' : '해당 날짜 완료건이 없습니다.'}
            </td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="border-t bg-gray-50 font-bold">
              <td className="px-2 py-1.5" colSpan={4}>합계 ({rows.length}건)</td>
              <td className="px-2 py-1.5 text-right text-[#7c3aed]">{tRefund.toLocaleString()}</td>
              <td colSpan={4}></td>
              <td className="px-2 py-1.5 text-right text-red-500">{tLoss.toLocaleString()}</td>
              <td></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── 지정 가구매 행 (사입원가 매칭 + 구성/수량 + 이체) ──
function MarkRow({ m, onSaved, mode, selected, onToggleSelect, onRevert }: {
  m: FakeMark; onSaved: () => void;
  mode: 'processing' | 'done'; selected: boolean; onToggleSelect: () => void; onRevert: () => void;
}) {
  const [unit, setUnit] = useState(String(m.unit_cost ?? ''));
  const [bundle, setBundle] = useState(m.bundle_count || 1);
  const [qty, setQty] = useState(m.quantity || 1);
  const [ship, setShip] = useState(m.shipping_price ?? 0);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);

  const unitN = parseInt(unit || '0', 10) || 0;
  const productCost = unitN * bundle * qty;   // 단가 × 구성 × 주문수량
  const liveLoss = (m.fee || 0) + ship + productCost + (m.packaging || 100);

  const save = async (patch: any) => {
    setBusy(true);
    try { await updateMark(m.order_code, patch); onSaved(); } finally { setBusy(false); }
  };
  const base = () => ({ unit_cost: unitN, bundle_count: bundle, quantity: qty });
  const setBundleSave = (n: number) => { setBundle(n); save({ ...base(), bundle_count: n }); };
  const saveUnit = () => save(base());
  const saveQty = (n: number) => { setQty(n); save({ ...base(), quantity: n }); };
  const onPick = (unitCost: number) => {
    setUnit(String(unitCost));
    save({ ...base(), unit_cost: unitCost });
    setModal(false);
  };
  const searchShipping = async () => {
    setBusy(true);
    try {
      const r = await lookupShipping(m.order_code);
      if (r?.found) { setShip(r.shipping); onSaved(); }
      else alert('송장에서 실배송비를 찾지 못했습니다 (CJ 데이터 미입력 — 기본값 유지)');
    } finally { setBusy(false); }
  };

  return (
    <tr className={`border-t align-top ${selected ? 'bg-purple-50' : ''}`}>
      <td className="px-2 py-1.5 text-center">
        {mode === 'processing' && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect}
            className="accent-[#7c3aed] w-4 h-4" title="이체완료 처리 대상 선택" />
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">{m.order_date}</td>
      <td className="px-2 py-1.5 font-medium">{m.receiver_name || '-'}</td>
      <td className="px-2 py-1.5 max-w-[260px] truncate" title={m.product_name}>{m.product_name}</td>
      <td className="px-2 py-1.5 text-right text-[#7c3aed] font-semibold">{(m.purchase_price ?? 0).toLocaleString()}</td>
      <td className="px-2 py-1.5 text-right text-gray-500">{(m.fee ?? 0).toLocaleString()}</td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <input type="text" inputMode="numeric" value={ship} onChange={e => setShip(parseInt(e.target.value || '0', 10) || 0)}
            onBlur={() => { if (ship !== m.shipping_price) save({ ...base(), shipping_price: ship }); }}
            className="border rounded w-16 px-1 py-0.5 text-right text-xs" title="배송비 직접 수정" />
          <button onClick={searchShipping} disabled={busy} className="text-[10px] px-1 py-0.5 rounded border text-[#16a34a] border-[#16a34a] hover:bg-green-50" title="송장에서 실배송비 검색">🚚</button>
        </div>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1 justify-center flex-wrap">
          <button onClick={() => setModal(true)} disabled={busy} className="text-[10px] px-1.5 py-0.5 rounded border text-[#0074e9] border-[#0074e9] hover:bg-blue-50 whitespace-nowrap" title="importbase에서 비슷한 상품 찾아 매칭">🔍 사입원가 매칭</button>
          <input type="text" inputMode="numeric" value={unit} onChange={e => setUnit(e.target.value)} onBlur={saveUnit}
            placeholder="단가" className="border rounded w-16 px-1 py-0.5 text-right text-xs" title="사입단가" />
          <span className="text-gray-400" title="구성수량">×구성</span>
          {[1, 2, 3].map(n => (
            <button key={n} onClick={() => setBundleSave(n)} className={`text-[10px] px-1.5 py-0.5 rounded ${bundle === n ? 'bg-[#7c3aed] text-white' : 'border text-gray-500 hover:bg-purple-50'}`}>{n}</button>
          ))}
          <span className="text-gray-400">×수량</span>
          <input type="text" inputMode="numeric" value={qty} onChange={e => setQty(parseInt(e.target.value || '1', 10) || 1)} onBlur={() => saveQty(qty)}
            className="border rounded w-12 px-1 py-0.5 text-right text-xs" title="주문수량" />
          <span className="font-bold ml-1">= {productCost.toLocaleString()}</span>
        </div>
        {modal && <CostMatchModal initialQuery={m.product_name} onPick={onPick} onClose={() => setModal(false)} />}
      </td>
      <td className="px-2 py-1.5 text-right text-gray-400">{(m.packaging ?? 100).toLocaleString()}</td>
      <td className="px-2 py-1.5 text-right font-bold text-red-500">{liveLoss.toLocaleString()}</td>
      <td className="px-2 py-1.5 text-center whitespace-nowrap">
        {mode === 'processing' ? (
          <label className="inline-flex items-center gap-1 cursor-pointer text-[11px] text-gray-500" title="개별 이체완료 체크(즉시)">
            <input type="checkbox" checked={m.transferred} disabled={busy}
              onChange={e => save({ transferred: e.target.checked })} className="accent-[#16a34a] w-4 h-4" />
            이체확인
          </label>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] text-[#16a34a] font-semibold">{m.transferred_at}</span>
            <button onClick={onRevert} className="text-[10px] text-gray-400 hover:text-red-500 hover:underline">처리중으로</button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── 수동 가구매 수정 모달 (입력 실수 정정) ──
function ManualEditModal({ m, onSaved, onClose }: { m: ManualEntry; onSaved: () => void; onClose: () => void }) {
  const [date, setDate] = useState(m.purchase_date || '');
  const [recipient, setRecipient] = useState(m.recipient || '');
  const [productName, setProductName] = useState(m.product_name || '');
  const [amount, setAmount] = useState(String(m.amount || 0));
  const [siteName, setSiteName] = useState(m.site_name || '');
  const [depositMemo, setDepositMemo] = useState(m.deposit_memo || '');
  const [memo, setMemo] = useState(m.memo || '');
  const [isRocket, setIsRocket] = useState(m.is_rocket);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateManual(m.id, {
        purchase_date: date || undefined,
        recipient, product_name: productName, site_name: siteName,
        deposit_memo: depositMemo, memo,
        amount: parseInt(amount || '0', 10) || 0,
        is_rocket: isRocket,
      });
      onSaved();
    } finally { setSaving(false); }
  };

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="block">
      <span className="block text-[11px] text-gray-500 mb-0.5">{label}</span>
      {children}
    </label>
  );
  const inp = "border rounded px-2 py-1 text-sm w-full";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-5 max-w-[460px] w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold">✏️ 수동 가구매 수정</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <F label="구매일자"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inp} /></F>
          <F label="수령인"><input value={recipient} onChange={e => setRecipient(e.target.value)} className={inp} /></F>
          <div className="col-span-2"><F label="상품명"><input value={productName} onChange={e => setProductName(e.target.value)} className={inp} /></F></div>
          <F label="판매가(입금액)"><input type="text" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} className={`${inp} text-right`} /></F>
          <F label="사이트"><input value={siteName} onChange={e => setSiteName(e.target.value)} className={inp} placeholder="06.쿠팡 등" /></F>
          <div className="col-span-2"><F label="통장 입금메모"><input value={depositMemo} onChange={e => setDepositMemo(e.target.value)} className={inp} /></F></div>
          <div className="col-span-2"><F label="메모"><input value={memo} onChange={e => setMemo(e.target.value)} className={inp} /></F></div>
          <label className="col-span-2 flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isRocket} onChange={e => setIsRocket(e.target.checked)} className="accent-[#0074e9] w-4 h-4" />
            🚀 로켓 상품 (체크 시 영업비=수수료+배송+원가+포장 분해)
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 rounded border text-sm text-gray-600">취소</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded bg-[#7c3aed] text-white text-sm font-semibold disabled:opacity-50">{saving ? '저장 중...' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

// ── 수동 가구매 행 (통합 목록 내). 로켓은 마크처럼 영업비 분해 ──
function ManualRow({ m, onSaved, mode, selected, onToggleSelect, onRevert }: {
  m: ManualEntry; onSaved: () => void;
  mode: 'processing' | 'done'; selected: boolean; onToggleSelect: () => void; onRevert: () => void;
}) {
  const [fee, setFee] = useState(m.fee || 0);
  const [ship, setShip] = useState(m.shipping ?? 2640);
  const [unit, setUnit] = useState(String(m.unit_cost ?? ''));
  const [bundle, setBundle] = useState(m.bundle_count || 1);
  const [qty, setQty] = useState(m.quantity || 1);
  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const rocket = m.is_rocket;
  const unitN = parseInt(unit || '0', 10) || 0;
  const pc = unitN * bundle * qty;
  const liveLoss = rocket ? (fee + ship + pc + 100) : (m.amount || 0);

  const save = (patch: any) => updateManual(m.id, patch).then(onSaved);
  const baseCost = () => ({ unit_cost: unitN, bundle_count: bundle, quantity: qty });
  const del = async () => { if (confirm('이 수동 가구매를 삭제할까요?')) { await deleteManual(m.id); onSaved(); } };
  const check = (v: boolean) => save({ transferred: v });

  return (
    <tr className={`border-t align-top bg-amber-50/40 ${selected ? 'bg-purple-50' : ''}`}>
      <td className="px-2 py-1.5 text-center">
        {mode === 'processing' && <input type="checkbox" checked={selected} onChange={onToggleSelect} className="accent-[#7c3aed] w-4 h-4" />}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">{m.purchase_date}</td>
      <td className="px-2 py-1.5 font-medium">{m.recipient || '-'}</td>
      <td className="px-2 py-1.5 max-w-[260px]">
        <div className="flex items-center gap-1">
          <span className="px-1 py-[1px] bg-amber-500 text-white text-[9px] rounded font-bold shrink-0">수동</span>
          {rocket && <span className="px-1 py-[1px] bg-[#0074e9] text-white text-[9px] rounded font-bold shrink-0">🚀</span>}
          <span className="truncate" title={m.product_name}>{m.product_name || '-'}</span>
          <button onClick={() => setEditModal(true)} className="text-[11px] px-1 rounded border text-gray-500 border-gray-300 hover:bg-gray-50 shrink-0" title="수정">✏️</button>
          <button onClick={del} className="text-[11px] px-1 rounded border text-red-400 border-red-200 hover:bg-red-50 shrink-0" title="삭제">🗑</button>
        </div>
        {m.deposit_memo && <div className="text-[9px] text-gray-400">통장: {m.deposit_memo}</div>}
        {editModal && <ManualEditModal m={m} onSaved={() => { setEditModal(false); onSaved(); }} onClose={() => setEditModal(false)} />}
      </td>
      <td className="px-2 py-1.5 text-right text-[#7c3aed] font-semibold">{(m.amount || 0).toLocaleString()}</td>
      {rocket ? (
        <>
          <td className="px-2 py-1.5 text-right whitespace-nowrap">
            <div className="flex items-center justify-end gap-0.5">
              <input type="text" inputMode="numeric" value={fee} onChange={e => setFee(parseInt(e.target.value || '0', 10) || 0)} onBlur={() => fee !== m.fee && save({ fee })}
                className="border rounded w-14 px-1 py-0.5 text-right text-xs" title="수수료(90일 무료=0)" />
              <button onClick={() => { const f = Math.round((m.amount || 0) * 0.1008 * 1.1); setFee(f); save({ fee: f }); }}
                className="text-[9px] px-1 py-0.5 rounded border text-[#0074e9] border-[#0074e9] hover:bg-blue-50" title="판매가 × 10.08% × 1.1(부가세) 자동계산">자동</button>
            </div>
          </td>
          <td className="px-2 py-1.5 text-right">
            <input type="text" inputMode="numeric" value={ship} onChange={e => setShip(parseInt(e.target.value || '0', 10) || 0)} onBlur={() => ship !== m.shipping && save({ shipping: ship })}
              className="border rounded w-16 px-1 py-0.5 text-right text-xs" title="배송비" />
          </td>
          <td className="px-2 py-1.5">
            <div className="flex items-center gap-1 justify-center flex-wrap">
              <button onClick={() => setModal(true)} className="text-[10px] px-1.5 py-0.5 rounded border text-[#0074e9] border-[#0074e9] hover:bg-blue-50 whitespace-nowrap">🔍 사입원가 매칭</button>
              <input type="text" inputMode="numeric" value={unit} onChange={e => setUnit(e.target.value)} onBlur={() => unitN !== m.unit_cost && save(baseCost())}
                placeholder="단가" className="border rounded w-16 px-1 py-0.5 text-right text-xs" title="사입단가" />
              <span className="text-gray-400">×구성</span>
              {[1, 2, 3].map(n => (
                <button key={n} onClick={() => { setBundle(n); save({ ...baseCost(), bundle_count: n }); }} className={`text-[10px] px-1.5 py-0.5 rounded ${bundle === n ? 'bg-[#7c3aed] text-white' : 'border text-gray-500 hover:bg-purple-50'}`}>{n}</button>
              ))}
              <span className="text-gray-400">×수량</span>
              <input type="text" inputMode="numeric" value={qty} onChange={e => setQty(parseInt(e.target.value || '1', 10) || 1)} onBlur={() => qty !== m.quantity && save(baseCost())}
                className="border rounded w-12 px-1 py-0.5 text-right text-xs" title="주문수량" />
              <span className="font-bold ml-1">= {pc.toLocaleString()}</span>
            </div>
            {modal && <CostMatchModal initialQuery={m.product_name} onPick={(u) => { setUnit(String(u)); save({ ...baseCost(), unit_cost: u }); setModal(false); }} onClose={() => setModal(false)} />}
          </td>
          <td className="px-2 py-1.5 text-right text-gray-400">100</td>
        </>
      ) : (
        <>
          <td className="px-2 py-1.5 text-right text-gray-300">-</td>
          <td className="px-2 py-1.5 text-right text-gray-300">-</td>
          <td className="px-2 py-1.5 text-center text-[11px] text-gray-400">수동입력</td>
          <td className="px-2 py-1.5 text-right text-gray-300">-</td>
        </>
      )}
      <td className="px-2 py-1.5 text-right font-bold text-red-500">{liveLoss.toLocaleString()}</td>
      <td className="px-2 py-1.5 text-center whitespace-nowrap">
        {mode === 'processing' ? (
          <label className="inline-flex items-center gap-1 cursor-pointer text-[11px] text-gray-500">
            <input type="checkbox" checked={m.transferred} onChange={e => check(e.target.checked)} className="accent-[#16a34a] w-4 h-4" />
            이체확인
          </label>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] text-[#16a34a] font-semibold">{m.transferred_at}</span>
            <button onClick={onRevert} className="text-[10px] text-gray-400 hover:text-red-500 hover:underline">처리중으로</button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── 사입원가 매칭 모달 (importbase 카탈로그에서 비슷한 상품 검색) ──
function CostMatchModal({ initialQuery, onPick, onClose }: {
  initialQuery: string; onPick: (unitCost: number) => void; onClose: () => void;
}) {
  const firstKeyword = initialQuery.replace(/^나인조이\s*/, '').split(/[\s/(]/)[0] || initialQuery;
  const [q, setQ] = useState(firstKeyword);
  const [cands, setCands] = useState<CostCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async (term: string) => {
    setLoading(true);
    try { setCands(await lookupCost(term.trim())); } finally { setLoading(false); }
  };
  useEffect(() => { search(firstKeyword); }, []); // eslint-disable-line

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg w-[640px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b">
          <h3 className="font-bold text-sm">사입원가 매칭 <span className="text-xs font-normal text-gray-400">(importbase 카탈로그)</span></h3>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="px-4 py-2 border-b flex items-center gap-2">
          <input
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search(q); }}
            placeholder="상품명 검색" className="border rounded px-2 py-1 text-sm flex-1" autoFocus
          />
          <button onClick={() => search(q)} className="px-3 py-1 rounded bg-[#0074e9] text-white text-sm font-semibold">검색</button>
        </div>
        <div className="overflow-auto p-2 flex-1">
          {loading && <div className="text-sm text-gray-400 py-8 text-center animate-pulse">검색 중...</div>}
          {!loading && cands && cands.length === 0 && (
            <div className="text-sm text-gray-400 py-8 text-center">매칭되는 상품이 없습니다. 키워드를 바꿔보세요.</div>
          )}
          {!loading && cands && cands.map(c => (
            <button key={c.id} onClick={() => c.unit_cost != null && onPick(c.unit_cost)}
              className="w-full flex items-center gap-3 px-3 py-2 border-b hover:bg-blue-50 text-left">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {c.customs_name}
                  {c.color_option && <span className="text-gray-500 font-normal"> · {c.color_option}</span>}
                  {c.is_soldout && <span className="ml-1 text-[10px] text-red-400">품절</span>}
                </div>
                <div className="text-[11px] text-gray-400 truncate">{c.name_1688} · 단가 {c.unit_price_cny}元</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold text-[#0074e9]">{(c.unit_cost ?? 0).toLocaleString()}원</div>
                <div className="text-[10px] text-gray-400">추정 개당원가</div>
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t text-[11px] text-gray-400">
          개당원가 = 단가(CNY)×환율 + 통관비×CBM배율 (추정). 클릭하면 단가로 적용됩니다.
        </div>
      </div>
    </div>
  );
}

// ── 수동 가구매 입력 (통장입금내역 대조용) ──
function ManualForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({ purchase_date: new Date().toISOString().slice(0, 10), recipient: '', site_name: '', product_name: '', is_rocket: false, amount: '', product_cost: '', deposit_memo: '', memo: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.purchase_date) return;
    setBusy(true);
    try {
      await createManual({ ...form, amount: parseInt(form.amount || '0', 10), product_cost: parseInt(form.product_cost || '0', 10) } as any);
      setForm(f => ({ ...f, recipient: '', site_name: '', product_name: '', is_rocket: false, amount: '', product_cost: '', deposit_memo: '', memo: '' }));
      onAdded();
    } finally { setBusy(false); }
  };

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <h2 className="text-base font-bold mb-1">+ 수동 가구매 입력 <span className="text-xs font-normal text-gray-400">(내가 사준 건 · 로켓 등 · 위 통합목록에 추가됨)</span></h2>
      <div className="flex items-end gap-2 flex-wrap">
        <Field label="구매일자"><input type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} className="border rounded px-2 py-1 text-sm" /></Field>
        <Field label="이름/받는사람"><input value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} className="border rounded px-2 py-1 text-sm w-28" /></Field>
        <Field label="사이트"><input value={form.site_name} onChange={e => setForm(f => ({ ...f, site_name: e.target.value }))} className="border rounded px-2 py-1 text-sm w-24" /></Field>
        <Field label="상품명"><input value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} className="border rounded px-2 py-1 text-sm w-48" /></Field>
        <Field label="로켓상품">
          <label className="flex items-center gap-1 h-[30px] px-2 border rounded cursor-pointer text-sm">
            <input type="checkbox" checked={form.is_rocket} onChange={e => setForm(f => ({ ...f, is_rocket: e.target.checked }))} className="accent-[#0074e9]" />
            <span className={form.is_rocket ? 'text-[#0074e9] font-semibold' : 'text-gray-500'}>🚀 로켓</span>
          </label>
        </Field>
        <Field label={form.is_rocket ? '구입가(금액)' : '금액(영업비)'}><input type="text" inputMode="numeric" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="border rounded px-2 py-1 text-sm w-24 text-right" /></Field>
        {form.is_rocket && (
          <Field label="제품원가(사입)"><input type="text" inputMode="numeric" value={form.product_cost} onChange={e => setForm(f => ({ ...f, product_cost: e.target.value }))} placeholder="원가" className="border rounded px-2 py-1 text-sm w-24 text-right" /></Field>
        )}
        <Field label="통장입력내역"><input value={form.deposit_memo} onChange={e => setForm(f => ({ ...f, deposit_memo: e.target.value }))} placeholder="입금자/메모" className="border rounded px-2 py-1 text-sm w-36" /></Field>
        <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded bg-[#7c3aed] text-white text-sm font-semibold disabled:opacity-50">{busy ? '추가 중...' : '입력'}</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-0.5">{label}</label>
      {children}
    </div>
  );
}
