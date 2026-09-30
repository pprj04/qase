-- Qase PostgreSQL migration 013: run feedback.
-- Thumbs up/down stored on the run row so the dashboard restores the vote on
-- reload; NULL means the user has not voted yet.

ALTER TABLE qa_runs
	ADD COLUMN feedback jsonb,
	ADD CONSTRAINT qa_runs_feedback_object
		CHECK (feedback IS NULL OR jsonb_typeof(feedback) = 'object');
