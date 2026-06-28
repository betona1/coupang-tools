# CLAUDE.md — 쿠팡 상품 리뷰 수집기 (이 PC에서 완성)

이 프로젝트는 **쿠팡에 로그인 가능한 윈도우 PC(가정용 IP)** 에서 실행/완성한다.
참조 형제 프로젝트: `coupanglist`(구매내역 크롤러) — 같은 PySide6 + QWebEngineView 패턴.

## ★ 이 PC만의 결정적 장점 — 꼭 활용
- 쿠팡 리뷰 공개 API `https://www.coupang.com/vp/product/reviews?productId=...` 는
  **서버(데이터센터) IP에서 호출하면 Akamai가 "Access Denied" 차단**한다(서버에서 curl 확인됨).
- 이 PC의 실제 브라우저에서 같은 origin 으로 `fetch()` 하면 차단 안 됨 → 그래서 데스크톱 GUI.

## 동작
1. `① 쿠팡 로그인 열기` → 내장 브라우저에서 직접 로그인(쿠키 webprofile/ 유지).
2. 노출상품ID 를 줄바꿈으로 입력(예: 8622212696, 7828814219).
3. `② 리뷰 수집 시작` → 상품마다 상세페이지로 이동 후, 브라우저 내부 fetch로
   `vp/product/reviews?productId=&page=N&size=30&sortBy=ORDER_SCORE_ASC&viRoleCode=2&ratingSummary=true`
   를 page=1,2,3... 리뷰 없을 때까지 호출 → 파싱 → 누적.
4. 끝나면 엑셀 저장 + (체크 시) DB `coupang_review` 적재.

## ★ PC에서 1회 검증할 것 (추측 금지 — coupanglist 와 동일 원칙)
- **응답 구조**: 리뷰 API 응답은 보통 **HTML 조각**이다. `_parse_review_html()` 의 selector
  (`article.sdp-review__article__list`, `...__headline`, `...__review__content`,
  `...star-orange`(width%→별점), `...user__name`, `...reviewed-date`) 가 실제와 맞는지 확인.
  - **수집 0건이면** `output/html/review_{productId}_p1.html` 를 열어 실제 클래스명을 보고
    `_parse_review_html()` 만 고치면 됨. (응답이 JSON이면 그쪽으로 분기 추가.)
- **productId**: 노출상품ID(상품 상세 URL `/vp/products/{이 번호}`)가 맞는지. WING '노출상품ID'와 동일.
- **page 파라미터**가 실제로 먹는지(혹시 `pageNumber`/offset 이면 교정).

## DB (<DB_HOST>:3306 / joacham, 테이블 coupang_review)
- 스키마: `DB_SCHEMA.sql` (서버에서 1회 실행해 테이블 생성).
- 접속정보: `.env` (`.env.example` 복사). `pip install pymysql`.
- UPSERT: `INSERT ... ON DUPLICATE KEY UPDATE` (uq: product_id+review_id+reviewer+headline).
- 회사 웹뷰어(gmarket_cpc)가 이 테이블을 읽어 상품별 리뷰를 표시(다음 단계).

## 설치/실행
- `pip install PySide6 PySide6-Addons beautifulsoup4 openpyxl pymysql`
- `python coupang_review_gui.py`  또는  `빌드_exe.bat` 로 exe 빌드.

## 파일
- `coupang_review_gui.py` — 본체(여기를 PC에서 검증·교정).
- `DB_SCHEMA.sql` / `.env.example` / `빌드_exe.bat`.
- `output/html/review_*_p1.html` — 디버그용 첫페이지 원본(구조 확인용).
