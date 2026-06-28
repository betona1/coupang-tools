# -*- coding: utf-8 -*-
"""
쿠팡 상품 리뷰 수집기 — PySide6 GUI (사장님 PC에서 실행)

내장 크롬(QWebEngineView)으로 쿠팡에 직접 로그인 → 상품별 리뷰를
**브라우저 내부 fetch()** 로 끝까지 수집 → 공유 DB(coupang_review)에 적재(+엑셀 백업).

★ 왜 데스크톱 GUI인가 (핵심):
  - 쿠팡 리뷰 공개 API `https://www.coupang.com/vp/product/reviews?productId=...`
    는 **서버(데이터센터) IP에서 호출하면 Akamai가 Access Denied 차단**한다.
  - 이 PC(가정용 IP) 안의 실제 브라우저에서 같은 origin으로 fetch 하면 차단되지 않는다.
    → coupanglist(구매내역 크롤러)와 동일 전략.

★ 리뷰 API (github JaehyoJJAng 확인):
    GET https://www.coupang.com/vp/product/reviews
        ?productId={상품ID}&page={N}&size=30&sortBy=ORDER_SCORE_ASC
        &ratings=&q=&viRoleCode=2&ratingSummary=true
  - productId = 쿠팡 노출상품ID(상품 상세 URL `/vp/products/{productId}` 의 그 번호).
    셀러 WING의 '노출상품ID'와 동일.
  - 응답은 **리뷰 HTML 조각**(JSON 아님) → BeautifulSoup 으로 파싱.
  - page 를 1,2,3... 늘려 리뷰가 안 나올 때까지 반복(상품당 size=30).

★ PC에서 1회 확인할 것(추측 금지):
  - 실제 응답 HTML의 리뷰 selector/클래스명이 아래 PARSE 가정과 맞는지.
    (수집 0건이면 output/html/review_{pid}_p1.html 열어 클래스명 확인 후 _parse_review_html 교정)

설치:  pip install PySide6 PySide6-Addons beautifulsoup4 openpyxl pymysql
실행:  python coupang_review_gui.py
DB/스키마: 같은 폴더 .env, DB_SCHEMA.md 참조.
"""
import os
import re
import json
import datetime

from PySide6.QtCore import QUrl, QTimer, Qt
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QPlainTextEdit, QLabel, QCheckBox, QSpinBox,
    QListWidget, QListWidgetItem
)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineProfile, QWebEnginePage

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "output")
HTML_DIR = os.path.join(OUT_DIR, "html")
PROFILE_DIR = os.path.join(BASE, "webprofile")
for d in (OUT_DIR, HTML_DIR, PROFILE_DIR):
    os.makedirs(d, exist_ok=True)

COUPANG_HOME = "https://www.coupang.com/"
# 리뷰 fetch JS — 브라우저 내부에서 같은 origin 으로 호출(쿠키/헤더 자동, Akamai 우회)
REVIEW_FETCH_JS = r"""
(function(){
  var pid = "%PID%", page = %PAGE%, size = %SIZE%;
  var url = "https://www.coupang.com/vp/product/reviews"
    + "?productId=" + pid + "&page=" + page + "&size=" + size
    + "&sortBy=ORDER_SCORE_ASC&ratings=&q=&viRoleCode=2&ratingSummary=true";
  return fetch(url, {credentials:'include', headers:{'accept':'*/*'}})
    .then(function(r){ return r.text(); })
    .then(function(t){ return JSON.stringify({ok:true, html:t}); })
    .catch(function(e){ return JSON.stringify({ok:false, error:String(e)}); });
})();
"""


def _star_from_style(style):
    """별점 = width:NN% → 5점 환산. (쿠팡 리뷰 별 영역 width로 표시)"""
    m = re.search(r"width\s*:\s*(\d+)", style or "")
    if m:
        return round(int(m.group(1)) / 20.0, 1)  # 100% = 5점
    return None


def _parse_review_html(html, product_id):
    """리뷰 HTML 조각 → 리뷰 dict 목록. selector 는 쿠팡 표준 클래스 기반(PC서 1회 검증).
    수집 0건이면 저장된 html 열어 클래스명 확인 후 이 함수만 고치면 됨."""
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return None, "bs4 미설치"
    soup = BeautifulSoup(html or "", "html.parser")
    arts = soup.select("article.sdp-review__article__list") \
        or soup.select(".sdp-review__article__list") \
        or soup.select("[class*='review__article__list']")
    out = []
    for a in arts:
        rid = a.get("data-review-id") or a.get("id") or ""

        def pick(*sels):
            for s in sels:
                el = a.select_one(s)
                if el:
                    return el
            return None

        name_el = pick(".sdp-review__article__list__info__user__name",
                       "[class*='user__name']")
        date_el = pick(".sdp-review__article__list__info__product-info__reviewed-date",
                       "[class*='reviewed-date']")
        head_el = pick(".sdp-review__article__list__headline", "[class*='headline']")
        body_el = pick(".sdp-review__article__list__review__content",
                       ".sdp-review__article__list__review", "[class*='review__content']")
        star_el = pick(".sdp-review__article__list__info__product-info__star-orange",
                       "[class*='star-orange']", "[class*='star']")
        help_el = pick("[class*='helpful']")

        rating = None
        if star_el:
            rating = _star_from_style(star_el.get("style", "")) or \
                (int(star_el.get("data-rating")) if star_el.get("data-rating") else None)

        content = (body_el.get_text(" ", strip=True) if body_el else "")
        out.append({
            "product_id": product_id,
            "review_id": str(rid).replace("reviewArticle", "").strip("_- ") or None,
            "rating": rating,
            "headline": (head_el.get_text(strip=True) if head_el else ""),
            "content": content,
            "reviewer": (name_el.get_text(strip=True) if name_el else ""),
            "review_date": (date_el.get_text(strip=True) if date_el else ""),
            "helpful_count": _digits(help_el.get_text() if help_el else ""),
        })
    return out, None


def _digits(s):
    m = re.findall(r"\d+", str(s) or "")
    return int(m[0]) if m else 0


class Main(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("쿠팡 상품 리뷰 수집기 → DB")
        self.resize(1200, 880)

        self.profile = QWebEngineProfile("coupang_review", self)
        self.profile.setPersistentStoragePath(PROFILE_DIR)
        self.profile.setCachePath(PROFILE_DIR)
        self.profile.setPersistentCookiesPolicy(QWebEngineProfile.ForcePersistentCookies)
        self.profile.setHttpUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

        self.view = QWebEngineView()
        self.page = QWebEnginePage(self.profile, self)
        self.view.setPage(self.page)

        bar = QHBoxLayout()
        self.btn_login = QPushButton("① 쿠팡 로그인 열기")
        self.btn_login.clicked.connect(self.open_login)
        bar.addWidget(self.btn_login)
        self.btn_load = QPushButton("내 로켓상품 불러오기")
        self.btn_load.clicked.connect(self.load_products); bar.addWidget(self.btn_load)
        bar.addWidget(QLabel("상품당 최대페이지:"))
        self.max_pages = QSpinBox(); self.max_pages.setRange(1, 200); self.max_pages.setValue(40)
        bar.addWidget(self.max_pages)
        self.chk_db = QCheckBox("DB 적재"); self.chk_db.setChecked(True); bar.addWidget(self.chk_db)
        self.btn_start = QPushButton("② 선택상품 리뷰 수집")
        self.btn_start.clicked.connect(self.start_crawl); bar.addWidget(self.btn_start)
        self.btn_save = QPushButton("③ 엑셀 저장")
        self.btn_save.clicked.connect(self.save_excel); bar.addWidget(self.btn_save)
        bar.addStretch()

        # 로켓상품 체크리스트 (DB에서 불러옴)
        selbar = QHBoxLayout()
        selbar.addWidget(QLabel("내 로켓그로스 상품 (노출상품ID 기준 · 체크 후 수집):"))
        self.btn_all = QPushButton("전체선택"); self.btn_all.clicked.connect(lambda: self._check_all(True))
        self.btn_none = QPushButton("전체해제"); self.btn_none.clicked.connect(lambda: self._check_all(False))
        for b in (self.btn_all, self.btn_none):
            b.setMaximumWidth(80); selbar.addWidget(b)
        selbar.addStretch()
        self.prod_list = QListWidget()
        self.prod_list.setMaximumHeight(180)

        self.log_box = QPlainTextEdit(); self.log_box.setReadOnly(True); self.log_box.setMaximumHeight(150)
        self.log_box.setStyleSheet("font-family:Consolas,monospace; font-size:12px;")

        central = QWidget(); lay = QVBoxLayout(central)
        lay.addLayout(bar)
        lay.addLayout(selbar)
        lay.addWidget(self.prod_list)
        lay.addWidget(self.view, 1)
        lay.addWidget(self.log_box)
        self.setCentralWidget(central)

        self.reviews = []
        self.crawling = False
        self.pids = []
        self.pid_i = 0
        self.cur_page = 1
        self.cur_pid = None
        self.log("준비됨. ① 쿠팡 로그인 → 상품ID 입력 → ② 수집 시작")

    def log(self, m):
        self.log_box.appendPlainText(f"[{datetime.datetime.now():%H:%M:%S}] {m}")

    def open_login(self):
        self.log("쿠팡 홈 여는 중... 창에서 직접 로그인하세요(쿠키는 webprofile에 유지).")
        self.page.load(QUrl(COUPANG_HOME))

    def load_products(self):
        """ads DB에서 내 로켓그로스 상품(노출상품ID 기준)을 불러와 체크리스트로 표시."""
        try:
            import pymysql
        except Exception:
            self.log("pymysql 미설치: pip install pymysql"); return
        cfg = self._read_env()
        try:
            conn = pymysql.connect(host=cfg["DB_HOST"], port=int(cfg.get("DB_PORT", 3306)),
                                   user=cfg["DB_USER"], password=cfg["DB_PASSWORD"],
                                   database=cfg.get("PRODUCT_DB_NAME", "ads"), charset="utf8mb4")
        except Exception as e:
            self.log(f"상품 DB 접속 실패: {e}"); return
        ptab = cfg.get("PRODUCT_TABLE", "cupang_rocket_product")
        atab = cfg.get("ACCOUNT_TABLE", "cupang_api_account")
        sql = (f"SELECT p.seller_product_id, MIN(p.product_name), MIN(a.cupang_id), COUNT(*) "
               f"FROM {ptab} p LEFT JOIN {atab} a ON a.id=p.account_id "
               f"WHERE p.seller_product_id<>'' AND p.is_active=1 "
               f"GROUP BY p.seller_product_id ORDER BY MIN(a.cupang_id), MIN(p.product_name)")
        try:
            with conn.cursor() as c:
                c.execute(sql); rows = c.fetchall()
        except Exception as e:
            self.log(f"상품 조회 실패: {e}"); return
        finally:
            conn.close()
        self.prod_list.clear()
        for exp_id, name, acc, nopt in rows:
            it = QListWidgetItem(f"[{acc or '?'}] {name}  ·  노출ID {exp_id} ({nopt}옵션)")
            it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
            it.setCheckState(Qt.Checked)
            it.setData(Qt.UserRole, str(exp_id))
            self.prod_list.addItem(it)
        self.log(f"📦 로켓상품 {len(rows)}개 불러옴 (노출ID 기준). 체크 후 ② 수집.")

    def _check_all(self, on):
        for i in range(self.prod_list.count()):
            self.prod_list.item(i).setCheckState(Qt.Checked if on else Qt.Unchecked)

    def start_crawl(self):
        if self.crawling:
            self.log("이미 수집 중."); return
        self.pids = [self.prod_list.item(i).data(Qt.UserRole)
                     for i in range(self.prod_list.count())
                     if self.prod_list.item(i).checkState() == Qt.Checked]
        if not self.pids:
            self.log("⚠ '내 로켓상품 불러오기' 후 수집할 상품을 체크하세요."); return
        self.reviews = []
        self.crawling = True
        self.pid_i = 0
        self.log(f"수집 시작: 상품 {len(self.pids)}개 (DB적재={self.chk_db.isChecked()})")
        self._start_pid()

    def _start_pid(self):
        if self.pid_i >= len(self.pids):
            self._finish(); return
        self.cur_pid = self.pids[self.pid_i]
        self.cur_page = 1
        self.log(f"── 상품 {self.cur_pid} ({self.pid_i+1}/{len(self.pids)}) ──")
        # 같은 origin 보장: 상품 상세 페이지에 머문 뒤 fetch
        self.page.load(QUrl(f"https://www.coupang.com/vp/products/{self.cur_pid}"))
        QTimer.singleShot(3500, self._fetch_page)

    def _fetch_page(self):
        if not self.crawling:
            return
        js = (REVIEW_FETCH_JS
              .replace("%PID%", self.cur_pid)
              .replace("%PAGE%", str(self.cur_page))
              .replace("%SIZE%", "30"))
        self.page.runJavaScript(js, self._on_fetch)

    def _on_fetch(self, result):
        if not self.crawling:
            return
        try:
            d = json.loads(result) if result else {}
        except Exception:
            d = {}
        if not d.get("ok"):
            self.log(f"  {self.cur_pid} p{self.cur_page} fetch 실패: {d.get('error','?')} — 다음 상품")
            return self._next_pid()
        html = d.get("html", "") or ""
        # 디버그용 1페이지 저장(구조 확인용)
        if self.cur_page == 1:
            try:
                with open(os.path.join(HTML_DIR, f"review_{self.cur_pid}_p1.html"), "w", encoding="utf-8") as f:
                    f.write(html)
            except Exception:
                pass
        rows, err = _parse_review_html(html, self.cur_pid)
        if err:
            self.log(f"  파싱 오류: {err}"); return self._next_pid()
        if not rows:
            self.log(f"  {self.cur_pid}: p{self.cur_page}에서 리뷰 없음 → 끝(누적 {len(self.reviews)})")
            return self._next_pid()
        self.reviews.extend(rows)
        self.log(f"  {self.cur_pid} p{self.cur_page}: +{len(rows)} (누적 {len(self.reviews)})")
        if self.cur_page < self.max_pages.value():
            self.cur_page += 1
            QTimer.singleShot(700, self._fetch_page)
        else:
            self.log(f"  {self.cur_pid}: 최대페이지 도달 → 다음 상품")
            self._next_pid()

    def _next_pid(self):
        self.pid_i += 1
        QTimer.singleShot(800, self._start_pid)

    def _finish(self):
        self.crawling = False
        rows = self._dedup()
        self.log(f"✅ 수집 완료 — 리뷰 {len(rows)}건 ({len(self.pids)}개 상품)")
        self.save_excel()
        if self.chk_db.isChecked():
            self.save_db()

    def _dedup(self):
        seen = set(); out = []
        for r in self.reviews:
            k = (r.get("product_id"), r.get("review_id"), r.get("reviewer"), r.get("content")[:30])
            if k in seen:
                continue
            seen.add(k); out.append(r)
        return out

    def save_excel(self):
        rows = self._dedup()
        if not rows:
            self.log("저장할 리뷰 없음."); return
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font
        except Exception:
            self.log("openpyxl 미설치"); return
        wb = Workbook(); ws = wb.active; ws.title = "쿠팡리뷰"
        cols = ["노출상품ID", "리뷰ID", "별점", "제목", "내용", "작성자", "작성일", "도움수"]
        ws.append(cols)
        for c in ws[1]:
            c.font = Font(bold=True)
        for r in rows:
            ws.append([r["product_id"], r["review_id"], r["rating"], r["headline"],
                       r["content"], r["reviewer"], r["review_date"], r["helpful_count"]])
        path = os.path.join(OUT_DIR, "쿠팡리뷰_전체.xlsx")
        try:
            wb.save(path); self.log(f"💾 엑셀 저장: {path} ({len(rows)}행)")
        except Exception as e:
            self.log(f"엑셀 저장 실패: {e}")

    def save_db(self):
        rows = self._dedup()
        if not rows:
            self.log("DB 적재할 리뷰 없음."); return
        try:
            import pymysql
        except Exception:
            self.log("pymysql 미설치: pip install pymysql"); return
        cfg = self._read_env()
        try:
            conn = pymysql.connect(host=cfg["DB_HOST"], port=int(cfg.get("DB_PORT", 3306)),
                                   user=cfg["DB_USER"], password=cfg["DB_PASSWORD"],
                                   database=cfg["DB_NAME"], charset="utf8mb4")
        except Exception as e:
            self.log(f"DB 접속 실패: {e}"); return
        sql = """INSERT INTO coupang_review
        (product_id,review_id,rating,headline,content,reviewer,review_date,helpful_count,source)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'coupang')
        ON DUPLICATE KEY UPDATE rating=VALUES(rating),headline=VALUES(headline),
         content=VALUES(content),reviewer=VALUES(reviewer),review_date=VALUES(review_date),
         helpful_count=VALUES(helpful_count)"""
        data = [(r["product_id"], r["review_id"], r["rating"], r["headline"], r["content"],
                 r["reviewer"], r["review_date"], r["helpful_count"]) for r in rows]
        try:
            with conn.cursor() as c:
                c.executemany(sql, data)
            conn.commit()
            self.log(f"🗄️ DB 적재 완료: {len(data)}행 → coupang_review")
        except Exception as e:
            self.log(f"DB 적재 실패: {e}")
        finally:
            conn.close()

    def _read_env(self):
        cfg = {}
        p = os.path.join(BASE, ".env")
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1); cfg[k.strip()] = v.strip()
        return cfg


if __name__ == "__main__":
    import sys
    app = QApplication(sys.argv)
    w = Main(); w.show()
    sys.exit(app.exec())
