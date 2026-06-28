-- 쿠팡 리뷰 저장 테이블 (<DB_HOST>:3306 / joacham)
CREATE TABLE IF NOT EXISTS coupang_review (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id    VARCHAR(30)  NOT NULL,            -- 노출상품ID
  review_id     VARCHAR(40)  NULL,                -- 쿠팡 리뷰ID(없으면 NULL)
  rating        DECIMAL(2,1) NULL,                -- 별점 0~5
  headline      VARCHAR(500) NULL,                -- 리뷰 제목
  content       MEDIUMTEXT   NULL,                -- 리뷰 내용
  reviewer      VARCHAR(100) NULL,                -- 작성자(마스킹)
  review_date   VARCHAR(30)  NULL,                -- 작성일(텍스트 그대로)
  helpful_count INT          DEFAULT 0,           -- 도움돼요 수
  source        VARCHAR(20)  DEFAULT 'coupang',
  collected_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review (product_id, review_id, reviewer, headline(60)),
  KEY idx_product (product_id),
  KEY idx_rating (rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
