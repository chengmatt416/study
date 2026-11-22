ALTER TABLE deck_settings ADD COLUMN request_retention REAL NOT NULL DEFAULT 0.9 CHECK(request_retention >= 0.8 AND request_retention <= 0.97);
ALTER TABLE review_log ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 1 CHECK(scheduled IN (0,1));
UPDATE review_log SET scheduled=0 WHERE mode='shuffle';
CREATE INDEX idx_review_log_card_day ON review_log(user_id, card_id, scheduled, reviewed_at);
