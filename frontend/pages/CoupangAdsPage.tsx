import { useState, useEffect, useCallback } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import {
  getAdEfficiency, getAdCampaigns, getAdChanges, saveAdChange, deleteAdChange,
  type AdEfficiencyResponse, type AdCampaign, type AdChange, type AdChangeType,
} from '../api/coupangRocketApi';

const ACCOUNTS = ['exansys', 'joacham', 'bitcom1', 'bitic05'];
const won = (n: number) => '₩' + (n || 0).toLocaleString();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const CHANGE_LABEL: Record<AdChangeType, string> = {
  budget: '예산변경', product_split: '상품 광고시작/분리', onoff: 'ON/OFF', etc: '기타',
};
const CHANGE_COLOR: Record<AdChangeType, string> = {
  budget: '#7c3aed', product_split: '#0074e9', onoff: '#16a34a', etc: '#64748b',
};
const roasColor = (r: number) => r >= 300 ? 'text-emerald-700' : r >= 100 ? 'text-violet-700' : 'text-red-600';

export default function CoupangAdsPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(iso(new Date(Date.now() - 864e5)));
  const [cupang, setCupang] = useState('exansys');
  const [eff, setEff] = useState<AdEfficiencyResponse | null>(null);
  const [camps, setCamps] = useState<AdCampaign[]>([]);
  const [changes, setChanges] = useState<AdChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'campaigns' | 'products' | 'changes'>('campaigns');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, c, ch] = await Promise.all([
        getAdEfficiency(from, to, cupang || undefined),
        getAdCampaigns(from, to, cupang || undefined),
        getAdChanges(cupang || undefined),
      ]);
      setEff(e); setCamps(c.campaigns); setChanges(ch);
    } finally { setLoading(false); }
  }, [from, to, cupang]);
  useEffect(() => { load(); }, [load]);

  const t = eff?.totals;

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h1 className="text-xl font-bold">📢 쿠팡광고 효율관리</h1>
        <span className="text-[11px] text-gray-400">advertising.coupang.com 수집 · 매일 14시 자동</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select value={cupang} onChange={e => setCupang(e.target.value)} className="border rounded px-2 py-1 text-sm font-semibold">
            {ACCOUNTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          <span>~</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          {loading && <span className="text-xs text-gray-400 animate-pulse">집계 중...</span>}
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <Card label="광고비" value={won(t?.ad_cost || 0)} color="#7c3aed" />
        <Card label="광고매출(전환)" value={won(t?.ad_sales || 0)} color="#0074e9" />
        <Card label="ROAS" value={`${t?.roas || 0}%`} color={(t?.roas || 0) >= 100 ? '#16a34a' : '#ef4444'} />
        <Card label="ACOS" value={`${t?.acos || 0}%`} color="#f59e0b" />
        <Card label="CPC(클릭당)" value={won(t?.cpc || 0)} />
        <Card label="저효율 광고비(ROAS<100%)" value={won(t?.low_roas_cost || 0)} color="#ef4444" />
      </div>

      {/* 일별 추이 */}
      <div className="bg-white border rounded-lg p-3 mb-4">
        <div className="text-sm font-bold mb-1">일별 광고비 vs 광고매출</div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={eff?.daily || []} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor((eff?.daily.length || 0) / 12))} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 10000 ? `${Math.round(v / 10000)}만` : `${v}`} />
            <Tooltip formatter={(v: number, n: string) => [won(v), n === 'ad_cost' ? '광고비' : '광고매출']} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === 'ad_cost' ? '광고비' : '광고매출'} />
            <Bar dataKey="ad_cost" fill="#c4b5fd" radius={[2, 2, 0, 0]} barSize={14} />
            <Line type="monotone" dataKey="ad_sales" stroke="#0074e9" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 탭 */}
      <div className="inline-flex rounded-md overflow-hidden border text-sm mb-3">
        {([['campaigns', '캠페인별'], ['products', '상품별 집행내역'], ['changes', '설정 변경이력']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1 font-semibold ${tab === k ? 'bg-[#0074e9] text-white' : 'bg-white text-gray-500 hover:bg-blue-50'}`}>{l}</button>
        ))}
      </div>

      {tab === 'campaigns' && <CampaignsView camps={camps} loading={loading} />}
      {tab === 'products' && <ProductsView eff={eff} loading={loading} />}
      {tab === 'changes' && <ChangesView cupang={cupang} changes={changes} camps={camps} onReload={load} />}
    </div>
  );
}

function CampaignsView({ camps, loading }: { camps: AdCampaign[]; loading: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!camps.length) return <Empty loading={loading} />;
  return (
    <div className="space-y-2">
      {camps.map((c) => {
        const isOpen = open[c.campaign_name];
        return (
          <div key={c.campaign_name} className="border rounded-lg bg-white overflow-hidden">
            <button onClick={() => setOpen(o => ({ ...o, [c.campaign_name]: !o[c.campaign_name] }))}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 text-left">
              <span className="text-gray-400">{isOpen ? '▼' : '▶'}</span>
              <span className="font-bold">{c.campaign_name}</span>
              <span className="text-xs text-gray-400">상품 {c.product_count}</span>
              {c.change_history.length > 0 && <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 rounded-full">변경 {c.change_history.length}</span>}
              <span className="ml-auto text-violet-600 font-semibold tabular-nums">{won(c.ad_cost)}</span>
              <span className={`font-bold tabular-nums ${roasColor(c.roas)}`}>ROAS {c.roas}%</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3">
                {c.change_history.length > 0 && (
                  <div className="mb-2 text-xs bg-violet-50 rounded p-2 space-y-0.5">
                    {c.change_history.map((h) => (
                      <div key={h.id}>
                        <span className="text-violet-700 font-semibold">{h.change_date}</span>{' '}
                        {CHANGE_LABEL[h.change_type]}{' '}
                        {h.budget_after != null && <b>→ {won(h.budget_after)}</b>}{' '}
                        <span className="text-gray-500">{h.memo}</span>
                      </div>
                    ))}
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 text-gray-600"><tr>
                    <th className="px-2 py-1 text-left">상품</th>
                    <th className="px-2 py-1 text-right">광고비</th>
                    <th className="px-2 py-1 text-right">광고매출</th>
                    <th className="px-2 py-1 text-right">ROAS</th>
                    <th className="px-2 py-1 text-right">클릭</th>
                  </tr></thead>
                  <tbody>
                    {c.products.map((p, i) => (
                      <tr key={i} className={`border-t ${p.roas < 100 ? 'bg-red-50/40' : ''}`}>
                        <td className="px-2 py-1 max-w-[340px] truncate" title={`${p.name} (노출 ${p.exposure_id || '-'})`}>{p.name || '(미상)'}</td>
                        <td className="px-2 py-1 text-right text-violet-600 tabular-nums">{p.ad_cost.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right text-[#0074e9] tabular-nums">{p.ad_sales.toLocaleString()}</td>
                        <td className={`px-2 py-1 text-right font-bold tabular-nums ${roasColor(p.roas)}`}>{p.roas}%</td>
                        <td className="px-2 py-1 text-right text-gray-500 tabular-nums">{p.clicks.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProductsView({ eff, loading }: { eff: AdEfficiencyResponse | null; loading: boolean }) {
  const [sortKey, setSortKey] = useState<'ad_cost' | 'ad_sales' | 'roas' | 'clicks'>('ad_cost');
  const products = [...(eff?.products || [])].sort((a, b) => (sortKey === 'roas' ? b.roas - a.roas : (b[sortKey] as number) - (a[sortKey] as number)));
  if (!products.length) return <Empty loading={loading} />;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold">상품별 광고비 집행내역 ({eff?.totals.product_count || 0})</span>
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
          </tr></thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={i} className={`border-t hover:bg-gray-50 ${p.roas < 100 ? 'bg-red-50/50' : ''}`}>
                <td className="px-2 py-1.5 max-w-[300px] truncate" title={`${p.name} (노출 ${p.exposure_id || '-'})`}>{p.name || '(미상)'}</td>
                <td className="px-2 py-1.5 text-right text-violet-600 font-semibold tabular-nums">{p.ad_cost.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-[#0074e9] tabular-nums">{p.ad_sales.toLocaleString()}</td>
                <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${roasColor(p.roas)}`}>{p.roas}%</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{p.acos}%</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{p.impressions.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{p.clicks.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{p.ctr}%</td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{won(p.cpc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChangesView({ cupang, changes, camps, onReload }: { cupang: string; changes: AdChange[]; camps: AdCampaign[]; onReload: () => void }) {
  const blank: AdChange = { cupang_id: cupang, change_date: iso(new Date()), change_type: 'budget', campaign_name: '', budget_before: null, budget_after: null, memo: '' };
  const [form, setForm] = useState<AdChange>(blank);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.change_date) return;
    setSaving(true);
    try {
      await saveAdChange({ ...form, cupang_id: cupang });
      setForm({ ...blank, cupang_id: cupang });
      onReload();
    } finally { setSaving(false); }
  };
  const remove = async (id?: number) => {
    if (!id || !confirm('이 변경이력을 삭제할까요?')) return;
    await deleteAdChange(id); onReload();
  };

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      {/* 입력 폼 */}
      <div className="lg:col-span-2 border rounded-lg p-3 bg-white h-fit">
        <div className="font-bold mb-2 text-sm">✏️ 변경 기록 추가 ({cupang})</div>
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <label className="w-20 text-gray-500 pt-1">날짜</label>
            <input type="date" value={form.change_date} onChange={e => setForm(f => ({ ...f, change_date: e.target.value }))} className="border rounded px-2 py-1 flex-1" />
          </div>
          <div className="flex gap-2">
            <label className="w-20 text-gray-500 pt-1">유형</label>
            <select value={form.change_type} onChange={e => setForm(f => ({ ...f, change_type: e.target.value as AdChangeType }))} className="border rounded px-2 py-1 flex-1">
              {(Object.keys(CHANGE_LABEL) as AdChangeType[]).map(k => <option key={k} value={k}>{CHANGE_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <label className="w-20 text-gray-500 pt-1">캠페인</label>
            <input list="camp-list" value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} placeholder="캠페인명 (선택)" className="border rounded px-2 py-1 flex-1" />
            <datalist id="camp-list">{camps.map(c => <option key={c.campaign_name} value={c.campaign_name} />)}</datalist>
          </div>
          {form.change_type === 'budget' && (
            <div className="flex gap-2">
              <label className="w-20 text-gray-500 pt-1">예산</label>
              <input type="number" value={form.budget_before ?? ''} onChange={e => setForm(f => ({ ...f, budget_before: e.target.value ? +e.target.value : null }))} placeholder="변경전" className="border rounded px-2 py-1 w-24" />
              <span className="pt-1">→</span>
              <input type="number" value={form.budget_after ?? ''} onChange={e => setForm(f => ({ ...f, budget_after: e.target.value ? +e.target.value : null }))} placeholder="변경후" className="border rounded px-2 py-1 w-24" />
            </div>
          )}
          <div className="flex gap-2">
            <label className="w-20 text-gray-500 pt-1">메모</label>
            <textarea value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} rows={2} placeholder="예: 2주 50% 할인 종료 → 1만원 축소, 효율상품 분리" className="border rounded px-2 py-1 flex-1" />
          </div>
          <button onClick={submit} disabled={saving} className="w-full py-1.5 rounded bg-[#0074e9] text-white font-bold disabled:opacity-50">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {/* 타임라인 */}
      <div className="lg:col-span-3">
        <div className="font-bold mb-2 text-sm">📅 변경 이력 타임라인</div>
        {!changes.length ? <div className="text-gray-400 text-sm py-8 text-center border rounded">아직 기록 없음</div> : (
          <div className="space-y-2">
            {changes.map((h) => (
              <div key={h.id} className="border rounded-lg p-2.5 bg-white flex items-start gap-3">
                <div className="text-center shrink-0">
                  <div className="text-xs font-bold text-gray-700">{h.change_date}</div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ background: CHANGE_COLOR[h.change_type] }}>
                    {CHANGE_LABEL[h.change_type]}
                  </span>
                </div>
                <div className="flex-1 text-sm">
                  {h.campaign_name && <span className="font-semibold">{h.campaign_name}</span>}
                  {h.change_type === 'budget' && (h.budget_after != null) && (
                    <span className="ml-2 text-violet-700 font-bold">
                      {h.budget_before != null ? `${won(h.budget_before)} → ` : ''}{won(h.budget_after)}
                    </span>
                  )}
                  {h.memo && <div className="text-gray-600 mt-0.5">{h.memo}</div>}
                </div>
                <button onClick={() => remove(h.id)} className="text-gray-300 hover:text-red-500 text-sm shrink-0">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border rounded-lg px-3 py-2 bg-white">
      <div className="text-[11px] text-gray-500 truncate">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={{ color: color || '#111' }}>{value}</div>
    </div>
  );
}

function Empty({ loading }: { loading: boolean }) {
  return <div className="text-gray-400 text-sm py-10 text-center border rounded">{loading ? '집계 중...' : '광고 데이터 없음 (해당 기간/계정)'}</div>;
}
