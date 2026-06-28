"""쿠팡 리뷰 서버 수집 — undetected_chromedriver(uc)로 Akamai 우회.

이 서버 IP는 데탑과 같은 공유기(같은 외부IP)지만, **일반 Selenium은 자동화 지문이
Akamai에 탐지**돼 Access Denied. **uc(undetected)** 는 통과 → 서버에서 직접 수집 가능.

흐름: uc 브라우저 → 상품페이지 1회 로드(Akamai 통과) → 브라우저 내부 fetch로
`vp/product/reviews?productId=&page=N` 끝까지 → HTML 파싱(데탑 GUI와 동일 selector)
→ joacham.coupang_review 적재(UPSERT).
"""
import os
import re
import glob
import shutil
import tempfile
import time

from django.db import connections

CHROME_BIN = "/home/joacham/.local/share/google-chrome/chrome"
REVIEW_URL = ("https://www.coupang.com/vp/product/reviews?productId={pid}&page={page}"
              "&size=30&sortBy=ORDER_SCORE_ASC&ratings=&q=&viRoleCode=2&ratingSummary=true")


def _make_uc():
    import undetected_chromedriver as uc
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from crawlers.browser import _ensure_display, _get_chrome_version
    _ensure_display()
    ver = _get_chrome_version()
    drv_src = sorted(glob.glob(os.path.expanduser(
        f"~/.cache/selenium/chromedriver/linux64/{ver}*/chromedriver")))[-1]
    fd, drv = tempfile.mkstemp(prefix="uc_review_", dir="/tmp"); os.close(fd)
    shutil.copy(drv_src, drv); os.chmod(drv, 0o755)
    opts = uc.ChromeOptions()
    opts.binary_location = CHROME_BIN
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--user-data-dir=" + tempfile.mkdtemp(prefix="ucrev_prof_"))
    return uc.Chrome(options=opts, headless=False, version_main=ver, driver_executable_path=drv)


_FETCH_JS = r"""
var pid=arguments[0], page=arguments[1], cb=arguments[2];
var url="https://www.coupang.com/vp/product/reviews?productId="+pid+"&page="+page
  +"&size=30&sortBy=ORDER_SCORE_ASC&ratings=&q=&viRoleCode=2&ratingSummary=true";
fetch(url,{credentials:'include',headers:{'accept':'*/*'}})
  .then(function(r){return r.text();}).then(function(t){cb(t);})
  .catch(function(e){cb('ERR:'+e);});
"""


def _star(style):
    m = re.search(r"width\s*:\s*(\d+)", style or "")
    return round(int(m.group(1)) / 20.0, 1) if m else None


def _digits(s):
    m = re.findall(r"\d+", str(s) or "")
    return int(m[0]) if m else 0


def parse_reviews(html, product_id):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html or "", "html.parser")
    arts = soup.select("article.sdp-review__article__list") \
        or soup.select(".sdp-review__article__list") \
        or soup.select("[class*='review__article__list']")
    out = []
    for a in arts:
        def pick(*sels):
            for s in sels:
                el = a.select_one(s)
                if el:
                    return el
            return None
        rid = a.get("data-review-id") or a.get("id") or ""
        name = pick("[class*='user__name']")
        date = pick("[class*='reviewed-date']", "[class*='reviewed']", "[class*='__date']")
        head = pick("[class*='headline']")
        body = pick("[class*='review__content']", ".sdp-review__article__list__review")
        star = pick("[class*='star-orange']", "[class*='star']", "[class*='rating']")
        helpf = pick("[class*='helpful']")
        # 별점: ① star 요소 data-rating ② article data-rating ③ style width% ④ rating 클래스 텍스트(N점)
        rating = None
        for el in (star, a):
            if el is None:
                continue
            dr = el.get("data-rating") or el.get("data-review-rating") or el.get("data-rating-value")
            if dr and str(dr).strip().replace(".", "").isdigit():
                rating = float(dr); break
        if rating is None and star is not None:
            rating = _star(star.get("style", ""))
        if rating is None:
            hr = a.select_one("[class*='hidden-rating']") or a.select_one("[class*='js_reviewArticleHiddenValue']")
            if hr:
                rating = _star(hr.get("style", "")) or (float(hr.get_text(strip=True)) if hr.get_text(strip=True).replace(".", "").isdigit() else None)
        headline = head.get_text(strip=True) if head else ""
        content = body.get_text(" ", strip=True) if body else ""
        reviewer = name.get_text(strip=True) if name else ""
        rdate = date.get_text(strip=True) if date else ""
        rev_id = str(rid).replace("reviewArticle", "").strip("_- ")
        if not rev_id:
            # 쿠팡 review_id 없으면 내용 해시로 고유 id 생성(재수집 시 중복방지)
            import hashlib
            sig = f"{product_id}|{reviewer}|{rdate}|{rating}|{headline}|{content}"
            rev_id = "h" + hashlib.md5(sig.encode("utf-8")).hexdigest()[:18]
        out.append({
            "product_id": product_id,
            "review_id": rev_id,
            "rating": rating,
            "headline": headline,
            "content": content,
            "reviewer": reviewer,
            "review_date": rdate,
            "helpful_count": _digits(helpf.get_text()) if helpf else 0,
        })
    return out


def _save(rows):
    if not rows:
        return 0
    sql = ("INSERT INTO coupang_review "
           "(product_id,review_id,rating,headline,content,reviewer,review_date,helpful_count,source) "
           "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'coupang') "
           "ON DUPLICATE KEY UPDATE rating=VALUES(rating),headline=VALUES(headline),"
           "content=VALUES(content),reviewer=VALUES(reviewer),review_date=VALUES(review_date),"
           "helpful_count=VALUES(helpful_count)")
    data = [(r["product_id"], r["review_id"], r["rating"], r["headline"], r["content"],
             r["reviewer"], r["review_date"], r["helpful_count"]) for r in rows]
    with connections["joacham"].cursor() as c:
        c.executemany(sql, data)
    return len(data)


def crawl_reviews(product_keys, max_pages=40, log_fn=None):
    """노출ID 목록의 리뷰를 uc로 수집해 coupang_review 적재. 진행상황 log_fn(dict) yield 가능."""
    def lg(m):
        if log_fn:
            log_fn(m)
    d = _make_uc()
    result = {}
    try:
        for pid in product_keys:
            pid = str(pid)
            try:
                d.get(f"https://www.coupang.com/vp/products/{pid}")
                time.sleep(5)
                if "Access Denied" in (d.title or ""):
                    lg(f"{pid}: Access Denied(차단) — 스킵")
                    result[pid] = {"error": "denied"}
                    continue
                all_rows, saved = [], 0
                seen = set()
                empty_streak = 0
                for page in range(1, max_pages + 1):
                    html = d.execute_async_script(_FETCH_JS, pid, page)
                    if not html or html.startswith("ERR:"):
                        break
                    rows = parse_reviews(html, pid)
                    if not rows:            # 리뷰 0 → 마지막 페이지 도달
                        break
                    # 강한 dedup 키: review_id 있으면 그걸로, 없으면 작성자+작성일+별점+전체내용
                    fresh = []
                    for r in rows:
                        key = r["review_id"] or (r["reviewer"], r["review_date"], r["rating"], r["content"])
                        if key in seen:
                            continue
                        seen.add(key)
                        fresh.append(r)
                    all_rows.extend(fresh)
                    empty_streak = empty_streak + 1 if not fresh else 0
                    if empty_streak >= 2:   # 2페이지 연속 신규 0 → 끝
                        break
                    time.sleep(0.6)
                saved = _save(all_rows)
                result[pid] = {"reviews": len(all_rows), "saved": saved}
                lg(f"{pid}: 리뷰 {len(all_rows)}건 수집/적재 {saved}")
            except Exception as e:
                result[pid] = {"error": str(e)[:120]}
                lg(f"{pid}: 오류 {str(e)[:80]}")
    finally:
        try:
            d.quit()
        except Exception:
            pass
    return result
