-- Long answers need room: the per-response output limit is never below 4096 tokens.
UPDATE live_ai_config SET max_output_tokens=4096 WHERE max_output_tokens<4096;
