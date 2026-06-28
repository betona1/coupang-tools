import axios from 'axios';
import type { SmartStoreSummaryResponse, SmartStoreLast15MinResponse, SalesTimeseriesRow } from '../types';

const api = axios.create({ baseURL: '/api/cpc/coupang' });

export async function getCoupangSummary(
  date: string,
  range?: { start_date: string; end_date: string },
): Promise<SmartStoreSummaryResponse> {
  const params = range ? { start_date: range.start_date, end_date: range.end_date } : { date };
  const { data } = await api.get<SmartStoreSummaryResponse>('/summary/', { params });
  return data;
}

export async function getCoupangLast15Min(): Promise<SmartStoreLast15MinResponse> {
  const { data } = await api.get<SmartStoreLast15MinResponse>('/last15min/');
  return data;
}

export async function getCoupangTimeseries(date: string): Promise<SalesTimeseriesRow[]> {
  const { data } = await api.get<{ date: string; sales: { seller_alias: string; ts: string; sales: number }[] }>(
    '/timeseries/',
    { params: { date } },
  );
  return data.sales.map(r => ({ id: r.seller_alias, ts: r.ts, sales: r.sales }));
}
