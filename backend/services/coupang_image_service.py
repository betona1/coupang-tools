"""쿠팡 로켓그로스 상품 이미지 크롤링

쿠팡 상품페이지(노출상품ID)는 봇탐지로 403 → undetected_chromedriver(UC + Xvfb)로 접속.
og:image 추출 후 브라우저 컨텍스트에서 fetch(base64) 로 다운로드(CDN referer 우회) →
static/coupang_rocket/ 에 저장. 같은 노출상품ID 옵션끼리 이미지 공유.
"""
import os
import re
import ssl
import sys
import urllib.request

from django.conf import settings
from django.utils import timezone

from .models import CoupangRocketProduct

# crawlers/ 패키지는 backend 상위(gmarket_cpc/)에 위치 → import 경로 보장
_GMARKET_CPC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if _GMARKET_CPC_DIR not in sys.path:
    sys.path.insert(0, _GMARKET_CPC_DIR)

IMG_DIR = os.path.join(settings.STATICFILES_DIRS[0], 'coupang_rocket')
# 옵션별 이미지: ?vendorItemId= 를 붙이면 해당 옵션 대표이미지(og:image)가 바뀜
PRODUCT_URL = "https://www.coupang.com/vp/products/{spid}?vendorItemId={vid}"

_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
       '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')


def _download_image(img_url):
    """CDN 이미지 서버사이드 다운로드 (HTML 페이지와 달리 CDN 이미지는 봇차단 없음).
    Referer=coupang.com 헤더로 핫링크 차단도 우회."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(img_url, headers={
        'User-Agent': _UA,
        'Referer': 'https://www.coupang.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    })
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        ctype = r.headers.get_content_type() or 'image/jpeg'
        data = r.read()
    ext = ctype.split('/')[-1].replace('jpeg', 'jpg')
    if ext not in ('jpg', 'png', 'webp', 'gif'):
        ext = 'jpg'
    return data, ext


def _extract_image_url(driver):
    """현재 페이지에서 대표 이미지 URL 추출 (og:image 우선)."""
    try:
        el = driver.find_element('css selector', 'meta[property="og:image"]')
        url = el.get_attribute('content')
        if url:
            return url if url.startswith('http') else 'https:' + url
    except Exception:
        pass
    # 폴백: 메인 이미지 img 태그
    for sel in ('img.prod-image__detail', '.prod-image img', 'img[src*="coupangcdn"]'):
        try:
            el = driver.find_element('css selector', sel)
            url = el.get_attribute('src')
            if url:
                return url if url.startswith('http') else 'https:' + url
        except Exception:
            continue
    return None


def crawl_images(product_ids=None):
    """선택 옵션(없으면 전체)의 **옵션별** 이미지를 크롤링.
    각 옵션마다 ?vendorItemId= 로 접속해 해당 옵션 대표이미지 저장.
    NDJSON 이벤트 yield ({"t":"log"/"done"})."""
    import time
    from crawlers.browser import create_driver, safe_quit_driver

    os.makedirs(IMG_DIR, exist_ok=True)
    qs = CoupangRocketProduct.objects.all()
    if product_ids:
        qs = qs.filter(id__in=product_ids)
    products = list(qs)

    yield {"t": "log", "m": f"옵션별 이미지 크롤링 시작 — {len(products)}개 옵션"}

    driver = None
    ok = fail = 0

    def _ensure_driver(drv):
        if drv is not None:
            return drv
        return create_driver()

    try:
        driver = _ensure_driver(None)
        for idx, p in enumerate(products, 1):
            label = f"{p.product_name or ''} {p.option_name or p.vendor_item_id}".strip()
            if not p.seller_product_id:
                fail += 1
                yield {"t": "log", "m": f"[{idx}/{len(products)}] ❌ {label} — 노출상품ID 없음"}
                continue
            success = False
            for attempt in (1, 2):  # 드라이버 사망 시 1회 재생성 후 재시도
                try:
                    driver.get(PRODUCT_URL.format(spid=p.seller_product_id, vid=p.vendor_item_id))
                    time.sleep(3)
                    img_url = _extract_image_url(driver)
                    if not img_url:
                        raise RuntimeError("이미지 URL 추출 실패(봇차단 가능)")
                    data, ext = _download_image(img_url)
                    fname = f"{p.vendor_item_id}.{ext}"
                    with open(os.path.join(IMG_DIR, fname), 'wb') as f:
                        f.write(data)
                    p.image_url = img_url
                    p.image_file = fname
                    p.image_crawled_at = timezone.now()
                    p.save(update_fields=['image_url', 'image_file', 'image_crawled_at'])
                    ok += 1
                    success = True
                    yield {"t": "log", "m": f"[{idx}/{len(products)}] ✅ {label} — {len(data)//1024}KB 저장"}
                    break
                except Exception as e:
                    msg = str(e)
                    if attempt == 1 and ('Connection' in msg or 'refused' in msg or 'session' in msg):
                        # 드라이버 재생성 후 1회 재시도
                        try:
                            safe_quit_driver(driver)
                        except Exception:
                            pass
                        driver = create_driver()
                        yield {"t": "log", "m": f"[{idx}/{len(products)}] ⚠ 브라우저 재시작 후 재시도..."}
                        continue
                    yield {"t": "log", "m": f"[{idx}/{len(products)}] ❌ {label} — {msg[:120]}"}
                    break
            if not success:
                fail += 1
            time.sleep(1)
    finally:
        if driver:
            safe_quit_driver(driver)

    yield {"t": "done", "ok": ok, "fail": fail, "total": len(products)}
