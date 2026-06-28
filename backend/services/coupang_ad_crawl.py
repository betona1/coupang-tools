"""쿠팡 광고센터(advertising.coupang.com) 매출성장(상품)광고 보고서 자동 수집.

흐름: WING 로그인(coupang_wing_auth 프로필) → advertising SSO(Marketplace Log in→xauth OAuth)
      → marketing-reporting GraphQL(requestReport: daily, granularity=vendorItem=상품)
      → 완료 폴링(reportList) → excel 다운로드 → 파싱 → CoupangAdCost 저장.

API 출처(리버스엔지니어링 참고): github.com/minyeamer/linkmerce  coupang/advertising/report
  - GraphQL:  POST https://advertising.coupang.com/marketing-reporting/v2/graphql
  - Excel:    GET  https://advertising.coupang.com/marketing-reporting/v2/api/excel-report?id={id}
  - 캠페인:   getCampaignList / 요청: requestReport / 목록: reportList
"""
from __future__ import annotations
import base64
import io
import json
import time
from datetime import date, timedelta

ORIGIN = 'https://advertising.coupang.com'
GRAPHQL = ORIGIN + '/marketing-reporting/v2/graphql'
EXCEL = ORIGIN + '/marketing-reporting/v2/api/excel-report?id='


def _ymd_int(d):
    return int(d.strftime('%Y%m%d'))


def _ad_authed(driver):
    u = driver.current_url
    return ('advertising.coupang.com' in u) and ('/user/login' not in u) and ('xauth' not in u)


def _login_advertising(acc, lg):
    """WING 프로필로 로그인된 드라이버 → advertising.coupang.com SSO 완료된 드라이버 반환(실패 시 None).
    광고센터는 xauth(realm=seller) 로그인폼을 별도 요구 → WING과 동일 폼(#username/#password/#kc-login)
    을 자동 입력. 같은 Chrome 프로필이라 신뢰기기로 OTP 없이 통과 기대."""
    from cpc import coupang_wing_auth as cwa
    from cpc import coupang_rocket_service as crs
    from selenium.webdriver.common.by import By
    driver = cwa.login_with_cookies(acc, log_fn=lg)
    if driver is None:
        lg('WING 로그인 실패 — 설정에서 재인증 필요')
        return None
    try:
        driver.set_page_load_timeout(45)
    except Exception:
        pass
    driver.get(ORIGIN + '/marketing/dashboard/sales'); time.sleep(5)
    if _ad_authed(driver):
        lg('광고센터 세션 유효')
        return driver
    # 로그인 페이지 → "Coupang Marketplace & Rocket Growth Seller" Log in 클릭
    driver.get(ORIGIN + '/user/login'); time.sleep(6)
    for el in driver.find_elements(By.XPATH, "//button[normalize-space()='Log in'] | //a[normalize-space()='Log in']"):
        try:
            driver.execute_script('arguments[0].click();', el)
            break
        except Exception:
            pass
    # 세션 재사용으로 바로 복귀하거나 xauth 로그인폼 등장 대기
    for _ in range(15):
        time.sleep(2)
        if _ad_authed(driver):
            lg('광고센터 SSO 완료(세션 재사용)')
            driver.get(ORIGIN + '/marketing/dashboard/sales'); time.sleep(4)
            return driver
        if driver.find_elements(By.ID, 'username'):
            break
    # xauth 로그인폼 자동 입력
    if driver.find_elements(By.ID, 'username'):
        login_id = acc.wing_login_id or acc.cupang_id
        login_pw = crs.decrypt_secret(acc.wing_password_enc) if acc.wing_password_enc else ''
        if not login_pw:
            lg('WING 비밀번호 미등록 — 광고센터 로그인 불가')
            return None
        lg(f'광고센터 로그인 폼 입력: {login_id}')
        try:
            u = driver.find_element(By.ID, 'username'); u.click(); time.sleep(0.3); u.send_keys(login_id); time.sleep(0.3)
            p = driver.find_element(By.ID, 'password'); p.click(); time.sleep(0.3); p.send_keys(login_pw); time.sleep(0.3)
            driver.find_element(By.ID, 'kc-login').click()
        except Exception as e:
            lg(f'로그인 폼 입력 오류: {e}')
            return None
        for _ in range(20):
            time.sleep(2)
            if _ad_authed(driver):
                lg('광고센터 로그인 성공')
                driver.get(ORIGIN + '/marketing/dashboard/sales'); time.sleep(4)
                return driver
            try:
                body = driver.find_element(By.TAG_NAME, 'body').text
            except Exception:
                body = ''
            if cwa._looks_like_otp(body):
                lg('⚠ 광고센터 2FA(OTP) 요구 — WING 설정에서 한 번 재인증(기기신뢰) 후 재시도하세요')
                return None
    lg(f'광고센터 SSO 실패 (URL={driver.current_url[:80]})')
    return None


def _gql(driver, body, timeout=70):
    """로그인된 브라우저 컨텍스트에서 GraphQL POST(쿠키 자동) → JSON."""
    driver.set_script_timeout(timeout)
    js = ("const cb=arguments[arguments.length-1];"
          "fetch(arguments[1],{method:'POST',credentials:'include',"
          "headers:{'content-type':'application/json'},body:JSON.stringify(arguments[0])})"
          ".then(r=>r.text()).then(t=>cb(t)).catch(e=>cb('ERR:'+e));")
    txt = driver.execute_async_script(js, body, GRAPHQL)
    if isinstance(txt, str) and txt.startswith('ERR:'):
        return {'_error': txt}
    try:
        return json.loads(txt)
    except Exception:
        return {'_raw': (txt or '')[:300]}


def _campaign_body(s, e, report_type='pa'):
    return [{
        "operationName": "GetCampaignListInBillboard",
        "query": ("query GetCampaignListInBillboard($startDate:Int!,$endDate:Int!,$reportType:ReportType!)"
                  "{getCampaignList(startDate:$startDate,endDate:$endDate,reportType:$reportType){id name}}"),
        "variables": {"startDate": s, "endDate": e, "reportType": report_type},
    }]


def _request_body(s, e, campaign_ids, report_type='pa', date_group='daily', granularity='vendorItem'):
    return [{
        "operationName": None,
        "query": ("mutation($startDate:Int!,$endDate:Int!,$campaignIds:[ID],$reportType:ReportType!,"
                  "$dateGroup:DateGroup!,$granularity:Granularity,$excludeIfNoClickCount:Boolean){"
                  "requestReport(data:{startDate:$startDate,endDate:$endDate,campaignIds:$campaignIds,"
                  "reportType:$reportType,dateGroup:$dateGroup,granularity:$granularity,"
                  "excludeIfNoClickCount:$excludeIfNoClickCount}){id status}}"),
        "variables": {"startDate": s, "endDate": e, "campaignIds": campaign_ids, "reportType": report_type,
                      "dateGroup": date_group, "granularity": granularity, "excludeIfNoClickCount": False},
    }]


def _list_body(report_type='pa'):
    # reportList(data: QueryReportRequestsInput!) — requestReport와 동일하게 data로 감싼다
    return [{
        "operationName": None,
        "query": ("query($reportType:ReportType!,$page:Int!,$pageSize:Int!,$duration:Int!,$onlyScheduledReport:Boolean){"
                  "reportList(data:{reportType:$reportType,page:$page,pageSize:$pageSize,duration:$duration,"
                  "onlyScheduledReport:$onlyScheduledReport}){reports{id status}}}"),
        "variables": {"reportType": report_type, "page": 1, "pageSize": 10, "duration": 90, "onlyScheduledReport": False},
    }]


def _download_excel(driver, report_id, timeout=90):
    """엑셀 보고서를 브라우저 컨텍스트에서 받아 base64 → bytes."""
    driver.set_script_timeout(timeout)
    js = ("const cb=arguments[arguments.length-1];"
          "fetch(arguments[0],{credentials:'include'}).then(r=>r.arrayBuffer()).then(b=>{"
          "let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);"
          "cb('OK'+btoa(s));}).catch(e=>cb('ERR:'+e));")
    res = driver.execute_async_script(js, EXCEL + str(report_id))
    if not isinstance(res, str) or not res.startswith('OK'):
        raise RuntimeError(f'엑셀 다운로드 실패: {str(res)[:120]}')
    return base64.b64decode(res[2:])


def _resolve_exposure_ids(acc, date_from, date_to, crs):
    """저장된 광고행의 옵션ID → 노출상품ID 환산해 exposure_id 채움.
    소스: ① CoupangRocketProduct(vid→seller_product_id) ② 쿠팡 매출API(판매된 옵션 vid→productId)."""
    from .models import CoupangAdCost
    vid2exp = crs._build_vid2exp()   # 카탈로그(CoupangVidMap) + 재고추적
    # 쿠팡 매출 API — 판매된 옵션의 vid→노출상품ID (기간 1개월 미만, 카탈로그 미보유분 보강)
    try:
        rev = crs.get_revenue_history(acc, str(date_from), str(date_to))
        for x in rev.get('rows', []):
            vid = str(x.get('vendor_item_id') or '').strip()
            pid = str(x.get('product_id') or '').strip()
            if vid and pid:
                vid2exp.setdefault(vid, pid)
    except Exception:
        pass
    # 광고행에 환산 적용 (옵션ID별 일괄 업데이트)
    base = CoupangAdCost.objects.filter(cupang_id=acc.cupang_id, ad_date__gte=date_from, ad_date__lte=date_to)
    vids = set(v for v in base.values_list('vendor_item_id', flat=True).distinct() if v)
    n = 0
    for vid in vids:
        exp = vid2exp.get(str(vid).strip())
        if exp:
            n += base.filter(vendor_item_id=vid).update(exposure_id=exp)
    return n


def crawl_ads(acc, date_from=None, date_to=None, report_level='vendorItem', wait_seconds=120, log_fn=None):
    """매출성장(상품) 광고 보고서 일별 수집 → CoupangAdCost. NDJSON 로그 제너레이터 친화."""
    from cpc import coupang_rocket_service as crs

    def lg(m):
        if log_fn:
            log_fn(m)

    today = date.today()
    if not date_to:
        date_to = today - timedelta(days=1)         # 어제까지(쿠팡 광고 데이터 확정)
    if not date_from:
        date_from = date_to - timedelta(days=6)      # 기본 최근 7일
    if isinstance(date_from, str):
        date_from = date.fromisoformat(date_from)
    if isinstance(date_to, str):
        date_to = date.fromisoformat(date_to)
    s, e = _ymd_int(date_from), _ymd_int(date_to)
    lg(f'광고센터 로그인...({acc.cupang_id})')
    driver = _login_advertising(acc, lg)
    if driver is None:
        return {'error': '광고센터 로그인 실패', 'inserted': 0}
    try:
        lg(f'캠페인 목록 조회 {date_from}~{date_to}...')
        camp = _gql(driver, _campaign_body(s, e))
        try:
            campaigns = [str(r['id']) for r in camp[0]['data']['getCampaignList']]
        except (KeyError, IndexError, TypeError):
            return {'error': f'캠페인 조회 실패: {json.dumps(camp, ensure_ascii=False)[:300]}', 'inserted': 0}
        lg(f'캠페인 {len(campaigns)}개')
        if not campaigns:
            return {'error': '기간 내 캠페인 없음', 'inserted': 0}

        lg('보고서 생성 요청(requestReport, 상품단위 일별)...')
        req = _gql(driver, _request_body(s, e, campaigns, granularity=report_level))
        try:
            report_id = req[0]['data']['requestReport']['id']
        except (KeyError, IndexError, TypeError):
            return {'error': f'보고서 요청 실패: {json.dumps(req, ensure_ascii=False)[:300]}', 'inserted': 0}
        lg(f'보고서 ID {report_id} — 생성 대기...')

        ready = False
        for _ in range(0, max(wait_seconds, 5), 3):
            time.sleep(3)
            lst = _gql(driver, _list_body())
            try:
                reports = lst[0]['data']['reportList']['reports']
            except (KeyError, IndexError, TypeError):
                reports = []
            for rp in reports:
                if str(rp.get('id')) == str(report_id) and rp.get('status') == 'completed':
                    ready = True
                    break
            if ready:
                break
        if not ready:
            return {'error': '보고서 생성 시간초과', 'inserted': 0}

        lg('엑셀 다운로드...')
        xls = _download_excel(driver, report_id)
        lg(f'다운로드 {len(xls):,} bytes — 파싱/저장...')
        result = crs.upload_coupang_ad_excel(io.BytesIO(xls), acc.cupang_id, default_date=str(date_to))
        result['report_id'] = report_id
        # 옵션ID → 노출상품ID 환산해 exposure_id 채우기 (정산 매칭용)
        try:
            resolved = _resolve_exposure_ids(acc, date_from, date_to, crs)
            result['resolved'] = resolved
            lg(f'노출상품ID 환산 {resolved}건')
        except Exception as ex:
            lg(f'노출ID 환산 경고: {str(ex)[:120]}')
        lg(f"완료 — {result.get('inserted')}건 / 광고비 {result.get('total_ad_cost', 0):,}")
        return result
    finally:
        try:
            driver.quit()
        except Exception:
            pass
