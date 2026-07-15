-- Normalize table naming conventions:
--   deposit_requests          → equity_deposit_requests  (add domain prefix, mirrors savings_deposit_requests)
--   share_transfers           → equity_share_transfers   (align with equity_ prefix)
--   loan_repayment_schedule   → loan_repayment_schedules (pluralize, consistent with loan_repayments)

ALTER TABLE deposit_requests        RENAME TO equity_deposit_requests;
ALTER TABLE share_transfers         RENAME TO equity_share_transfers;
ALTER TABLE loan_repayment_schedule RENAME TO loan_repayment_schedules;

-- Rename indexes for clarity (constraints and FKs retain their original names automatically)
ALTER INDEX IF EXISTS idx_deposit_requests_status_created  RENAME TO idx_equity_deposit_requests_status_created;
ALTER INDEX IF EXISTS idx_deposit_requests_user_id         RENAME TO idx_equity_deposit_requests_user_id;
ALTER INDEX IF EXISTS idx_deposit_requests_reference_unique RENAME TO idx_equity_deposit_requests_reference_unique;
ALTER INDEX IF EXISTS idx_loan_repayment_schedule_loan     RENAME TO idx_loan_repayment_schedules_loan;
