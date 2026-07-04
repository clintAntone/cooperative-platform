-- ─── Unique deposit reference numbers ────────────────────────────────────────
-- Prevent the same transaction reference from being submitted more than once.
-- NULL and empty-string references are excluded (reference is optional).

-- Step 1: Clear the reference on duplicate rows, keeping only the earliest
-- submission per reference value. This handles any existing duplicates so the
-- unique index can be created cleanly.
UPDATE deposit_requests AS dr
SET reference = NULL
WHERE reference IS NOT NULL
  AND reference <> ''
  AND id NOT IN (
    -- Keep the oldest row for each reference value
    SELECT DISTINCT ON (reference) id
    FROM deposit_requests
    WHERE reference IS NOT NULL AND reference <> ''
    ORDER BY reference, created_at ASC
  );

-- Step 2: Create the partial unique index (NULLs and empty strings are excluded)
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_requests_reference_unique
  ON deposit_requests(reference)
  WHERE reference IS NOT NULL AND reference <> '';
