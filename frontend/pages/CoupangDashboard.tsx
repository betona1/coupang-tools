import SalesOnlyDashboard from './SalesOnlyDashboard';
import { useCoupangData } from '../hooks/useCoupangData';

export default function CoupangDashboard() {
  const hook = useCoupangData();
  return <SalesOnlyDashboard hook={hook} themeColor="#e44232" excelPath="/api/cpc/coupang/summary/excel/" siteName="06.쿠팡" />;
}
