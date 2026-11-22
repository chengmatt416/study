-- Pretest and quiz signals carry the difficulty (1 foundation, 2 core, 3 hard) of the question, so the router can tell
-- "does not know the basics" from "knows the basics but misses the hard question".
ALTER TABLE learner_signals ADD COLUMN difficulty INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 3);
