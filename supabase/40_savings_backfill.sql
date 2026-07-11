-- Backfill: create savings accounts for members who already have ≥1 completed share
-- but whose account was not created because the trigger didn't exist yet.
INSERT INTO savings_accounts (user_id)
SELECT user_id
FROM membership_status
WHERE completed_shares >= 1
ON CONFLICT (user_id) DO NOTHING;
