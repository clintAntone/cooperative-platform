-- pg_cron scheduled jobs
-- PREREQUISITE: Enable the pg_cron extension first:
--   Supabase Dashboard → Database → Extensions → search "pg_cron" → Enable
--
-- Then run this file in the SQL editor.

-- Daily at midnight: mark past-due loan installments as overdue
SELECT cron.schedule(
  'mark-overdue-installments',
  '0 0 * * *',
  'SELECT mark_overdue_loan_installments()'
);

-- Every 6 months on the 1st at midnight: release savings interest to all active accounts
SELECT cron.schedule(
  'release-savings-interest',
  '0 0 1 */6 *',
  'SELECT release_savings_interest()'
);
