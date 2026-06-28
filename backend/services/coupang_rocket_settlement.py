"""로켓그로스 정산현황 크롤러 (WING /settlements/status-new).

쿠키 로그인(coupang_wing_auth) → 정산 리포트 목록 테이블 파싱 → CoupangRocketSettlement 저장.
테이블: 정산일 | 정산유형(주별) | 지급비율(70) | 매출인식일(범위) | 최종지급액 | 상세리포트
"""
import re
import time

STATUS_URL = 'https://wing.coupang.com/tenants/rfm/settlements/status-new'


def _pint(s):
    s = re.sub(r'[^\d-]', '', s or '')
    return int(s) if s and s != '-' else 0


def _pdate(s):
    m = re.search(r'(\d{4})[-.\s]+(\d{1,2})[-.\s]+(\d{1,2})', s or '')
    if m:
        return f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
    return None


def _last_num(line):
    nums = [n for n in re.findall(r'-?[\d,]+', line) if re.search(r'\d', n)]
    return _pint(nums[-1]) if nums else 0


def _parse_detail(text):
    """상세보기 펼침 텍스트 → 정산 항목별 금액.

    매출금액(A) − 판매수수료(B) − 상계금액(C) = 판매기준매출액(D)
    지급액(H) = D × 지급비율 / 최종지급액 = H − I − J(풀필먼트) + K
    """
    lines = [l.strip() for l in (text or '').split('\n') if l.strip()]
    d = {'gross_sale': 0, 'cancel_amount': 0, 'commission_b': 0, 'base_revenue_d': 0,
         'payment_h': 0, 'fulfillment_j': 0, 'inventory_k': 0, 'final_amount': 0,
         'ff_inout': 0, 'ff_shipping': 0, 'ff_storage': 0, 'ff_return': 0,
         'ff_restock': 0, 'ff_outbound': 0}

    def find(*kws, need_num=True):
        for l in lines:
            if all(k in l for k in kws):
                n = _last_num(l)
                if n or not need_num:
                    return n
        return 0

    for l in lines:
        m = re.search(r'판매액\s*\(a\)\s*([\d,]+)', l)
        if m:
            d['gross_sale'] = _pint(m.group(1))
        m = re.search(r'취소액\s*([\d,\-]+)', l)
        if m and '판매액' in l:
            d['cancel_amount'] = abs(_pint(m.group(1)))

    d['commission_b'] = find('판매수수료', '(B)')
    d['base_revenue_d'] = find('판매기준')
    d['payment_h'] = find('지급액', '(H)')
    d['fulfillment_j'] = find('풀필먼트서비스 비용', '(J)')
    d['inventory_k'] = find('재고 손실 보상')
    d['final_amount'] = find('최종지급액')
    # 풀필먼트 세부 (라벨 단독행이면 다음 행 또는 같은 행 숫자)
    d['ff_inout'] = find('입출고비')
    d['ff_shipping'] = find('배송비')
    d['ff_storage'] = find('보관비')
    d['ff_return'] = find('반품 회수비')
    d['ff_restock'] = find('반품 재입고비')
    d['ff_outbound'] = find('반출 배송')

    # 매출금액(A), 상계금액(C) 유도
    if d['gross_sale'] or d['cancel_amount']:
        d['revenue_a'] = d['gross_sale'] - d['cancel_amount']
    else:
        d['revenue_a'] = d['base_revenue_d'] + d['commission_b']
    d['coupon_c'] = max(0, d['revenue_a'] - d['commission_b'] - d['base_revenue_d'])
    return d


def crawl_rocket_settlements(acc, months=36, log_fn=None):
    from cpc import coupang_wing_auth as cwa
    from cpc.models import CoupangRocketSettlement
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import Select

    def lg(m):
        if log_fn:
            log_fn(m)

    lg('쿠키 로그인...')
    driver = cwa.login_with_cookies(acc, log_fn=lg)
    if driver is None:
        return {'error': '쿠키 로그인 실패 — 설정에서 재인증 필요', 'saved': 0, 'rows': []}
    try:
        try:
            driver.set_page_load_timeout(45)
        except Exception:
            pass
        lg('정산현황 페이지 로딩...')
        try:
            driver.get(STATUS_URL)
        except Exception:
            pass
        time.sleep(12)

        # 조회 기간 select 를 months(36 등)로
        for s in driver.find_elements(By.TAG_NAME, 'select'):
            vals = [o.get_attribute('value') for o in s.find_elements(By.TAG_NAME, 'option')]
            if str(months) in vals:
                try:
                    Select(s).select_by_value(str(months))
                    lg(f'조회 기간 {months}개월 설정')
                except Exception:
                    pass
                break
        time.sleep(1)

        # 조회/검색 버튼 클릭
        for b in driver.find_elements(By.TAG_NAME, 'button'):
            try:
                if b.is_displayed() and b.text.strip() in ('조회', '검색'):
                    b.click()
                    lg('조회 클릭')
                    break
            except Exception:
                continue
        time.sleep(8)

        # 정산 리포트 목록 테이블 (th 에 '정산일' + '지급액')
        rows = []
        for t in driver.find_elements(By.TAG_NAME, 'table'):
            ths = [h.text.strip() for h in t.find_elements(By.TAG_NAME, 'th')]
            if any('정산일' in h for h in ths) and any('지급액' in h for h in ths):
                for tr in t.find_elements(By.TAG_NAME, 'tr'):
                    tds = [d.text.strip() for d in tr.find_elements(By.TAG_NAME, 'td')]
                    if len(tds) < 5:
                        continue
                    sd = _pdate(tds[0])
                    if not sd:
                        continue
                    parts = re.split(r'~|∼|–|-(?=\s*\d{4})', tds[3])
                    rf = _pdate(parts[0]) if parts else None
                    rt = _pdate(parts[1]) if len(parts) > 1 else None
                    rows.append({
                        'settlement_date': sd,
                        'settlement_type': tds[1] or '주별',
                        'pay_ratio': _pint(tds[2]),
                        'recognition_from': rf,
                        'recognition_to': rt,
                        'final_amount': _pint(tds[4]),
                    })
                break
        lg(f'정산 리포트 {len(rows)}건 파싱')

        # ── 상세보기 펼쳐 항목별 파싱 (최종지급액으로 행 매칭) ──
        details = {}  # final_amount → detail dict
        detail_btns = []
        for b in driver.find_elements(By.TAG_NAME, 'button'):
            try:
                if b.is_displayed() and b.text.strip() == '상세보기':
                    detail_btns.append(b)
            except Exception:
                continue
        lg(f'상세보기 {len(detail_btns)}개')
        for i, b in enumerate(detail_btns):
            try:
                driver.execute_script("arguments[0].scrollIntoView(true);", b)
                time.sleep(0.4)
                driver.execute_script("arguments[0].click();", b)
                time.sleep(5)
                body = driver.find_element(By.TAG_NAME, 'body').text
                d = _parse_detail(body)
                fa = d.get('final_amount') or 0
                if fa:
                    d['detail_raw'] = '\n'.join(
                        l for l in body.split('\n')
                        if any(k in l for k in ('매출', '수수료', '쿠폰', '지급액', '풀필먼트',
                                                '입출고', '배송비', '보관비', '반품', '최종지급', '판매액', '취소액')))[:4000]
                    details[fa] = d
                    lg(f'  상세[{i+1}] 매출{d.get("revenue_a"):,} 수수료{d["commission_b"]:,} 지급{d["payment_h"]:,} 풀필먼트{d["fulfillment_j"]:,} 최종{fa:,}')
                # 다시 클릭해 접기(다음 행 깔끔하게)
                try:
                    driver.execute_script("arguments[0].click();", b)
                    time.sleep(1)
                except Exception:
                    pass
            except Exception as e:
                lg(f'  상세[{i+1}] 파싱 실패: {e}')

        saved = 0
        for r in rows:
            d = details.get(r['final_amount'], {})
            defaults = {
                'pay_ratio': r['pay_ratio'],
                'recognition_to': r['recognition_to'],
                'final_amount': d.get('final_amount') or r['final_amount'],
                'raw': r,
            }
            if d:
                for k in ('gross_sale', 'cancel_amount', 'revenue_a', 'commission_b', 'coupon_c',
                          'base_revenue_d', 'payment_h', 'fulfillment_j', 'inventory_k',
                          'ff_inout', 'ff_shipping', 'ff_storage', 'ff_return', 'ff_restock', 'ff_outbound',
                          'detail_raw'):
                    if k in d:
                        defaults[k] = d[k]
                defaults['has_detail'] = True
            CoupangRocketSettlement.objects.update_or_create(
                account=acc,
                settlement_date=r['settlement_date'],
                settlement_type=r['settlement_type'],
                recognition_from=r['recognition_from'],
                defaults=defaults,
            )
            saved += 1
        lg(f'DB 저장 {saved}건 (상세 {len(details)}건)')
        return {'saved': saved, 'rows': rows, 'details': len(details)}
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def get_rocket_settlements(acc=None):
    """acc=None 이면 전체 계정 (cupang_id 포함)."""
    from cpc.models import CoupangRocketSettlement
    qs = CoupangRocketSettlement.objects.select_related('account').all()
    if acc is not None:
        qs = qs.filter(account=acc)
    rows = []
    total = 0
    per_account = {}
    for s in qs:
        total += s.final_amount or 0
        cid = s.account.cupang_id
        per_account[cid] = per_account.get(cid, 0) + (s.final_amount or 0)
        rows.append({
            'cupang_id': cid,
            'account_name': s.account.account_name or '',
            'settlement_date': s.settlement_date.strftime('%Y-%m-%d') if s.settlement_date else None,
            'settlement_type': s.settlement_type,
            'pay_ratio': s.pay_ratio,
            'recognition_from': s.recognition_from.strftime('%Y-%m-%d') if s.recognition_from else None,
            'recognition_to': s.recognition_to.strftime('%Y-%m-%d') if s.recognition_to else None,
            'final_amount': s.final_amount,
            'has_detail': s.has_detail,
            'gross_sale': s.gross_sale, 'cancel_amount': s.cancel_amount,
            'revenue_a': s.revenue_a, 'commission_b': s.commission_b, 'coupon_c': s.coupon_c,
            'base_revenue_d': s.base_revenue_d, 'payment_h': s.payment_h,
            'fulfillment_j': s.fulfillment_j, 'inventory_k': s.inventory_k,
            'ff_inout': s.ff_inout, 'ff_shipping': s.ff_shipping, 'ff_storage': s.ff_storage,
            'ff_return': s.ff_return, 'ff_restock': s.ff_restock, 'ff_outbound': s.ff_outbound,
            'synced_at': s.synced_at.strftime('%Y-%m-%d %H:%M') if s.synced_at else None,
        })
    return {'rows': rows, 'totals': {'count': len(rows), 'final_amount': total},
            'per_account': per_account}
