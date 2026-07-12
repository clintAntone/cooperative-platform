-- Migration 60: Add report_cutoff_day to branches
--
-- report_cutoff_day: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
-- Defines which day of the week the weekly reporting period ends.
-- Defaults to 0 (Sunday), meaning each period runs Monday–Sunday.

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS report_cutoff_day SMALLINT DEFAULT 0
    CHECK (report_cutoff_day BETWEEN 0 AND 6);
