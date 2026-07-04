# Cooperative Platform — Improvements Backlog

Items are grouped by effort level. Within each group, higher-impact items are listed first.

**Legend:** 🟢 Quick win · 🟡 Medium effort · 🔴 Large effort

---

## 🟢 Quick Wins (1–4 hours each)

### UI & UX
- [x] Add toast/snackbar notifications for all successful mutations (approve, reject, submit, etc.) — currently silent
- [x] Add `aria-modal`, `role="dialog"`, and ESC-key close to the Modal component
- [x] Add `aria-current="page"` to active sidebar nav links
- [x] Add `aria-required`, `aria-invalid`, and `aria-describedby` to all form inputs
- [x] Add `aria-busy` to Button when `loading` is true
- [x] Add zebra striping option to Table rows for readability
- [x] Add sticky table headers so column labels stay visible while scrolling
- [x] Add sort-by-column click to all admin tables (Members, Loan Applications, Deposit Requests)
- [x] Show rejection reason on the member's loan application row (currently only visible to admin)
- [x] Add a "View co-makers" section inside LoanDetailPage so the borrower can see who guaranteed their loan
- [x] Add `"Load more"` or entry count label to the Recent Activity list on Dashboard (currently capped at 5 with no indicator)
- [x] Add character counter to textarea fields (purpose, rejection reason, notes)
- [x] Add "Forgot password?" link on LoginPage — Supabase supports password reset out of the box
- [x] Normalize all decimal display — some amounts show 0 decimals, some 2; pick one and apply consistently
- [x] Add thousands separator to all large currency and number displays
- [x] Add a "Copy to clipboard" button on loan reference/receipt numbers
- [x] Add `title` tooltip to truncated text cells so the full value shows on hover
- [x] Show a confirmation dialog before admin approves a deposit (accidental single click risk)
- [x] Make the Export button on Reports page also export filtered data, not always the full set
- [x] Add date range filter to the Deposit Requests admin page
- [x] Add a filter by membership status on the Members admin page
- [x] Add `role="status"` and `aria-live="polite"` to the loading spinner
- [x] Remove the HTML `max` validation on amount inputs where server-side handles the cap (already done for deposit, check others)
- [x] Add file size limit check in `uploadReceipt` before attempting upload (current behavior: hangs on large files)
- [x] Add accepted file type validation in `uploadReceipt` (currently accepts anything)
- [x] Add `debounce` to search inputs on Members and Users pages — currently fires a query on every keystroke
- [x] Add a brief description label next to each config key in the System Config page
- [x] Add a "Clear" button to search/filter inputs

### Database
- [x] Add missing indexes for common query patterns:
  ```sql
  CREATE INDEX idx_profiles_role_status ON profiles(role, account_status);
  CREATE INDEX idx_equity_shares_user_status ON equity_shares(user_id, status);
  CREATE INDEX idx_loan_applications_status ON loan_applications(status, created_at DESC);
  CREATE INDEX idx_loans_user_status ON loans(user_id, status);
  CREATE INDEX idx_deposit_requests_status ON deposit_requests(status, created_at DESC);
  CREATE INDEX idx_ledger_user_created ON ledger_entries(user_id, created_at DESC);
  CREATE INDEX idx_loan_repayments_loan ON loan_repayments(loan_id, payment_at DESC);
  ```
- [x] Add `CHECK (paid_amount <= target_amount)` constraint to `equity_shares`
- [x] Add `CHECK (outstanding >= 0)` constraint to `loans`
- [x] Add `CHECK (amount > 0)` constraint to `deposit_requests` (already exists on equity_contributions, missing here)

### Export / Reports
- [ ] Add CSV export option alongside Excel (just change the SheetJS output format)
- [x] Add export button to the LoanDetailPage repayment schedule

---

## 🟡 Medium Effort (half a day to 2 days each)

### Features
- [x] **Toast notification system** — build a global `<ToastProvider>` with `useToast()` hook so any page can fire success/error toasts; wire up to all mutations
- [x] **Error boundaries** — add a React error boundary around each page route so one broken component doesn't crash the whole app
- [x] **Offline/network detection** — detect when the browser goes offline and show a banner; disable form submissions
- [x] **Pagination** — add page-based or cursor-based pagination to Members, Deposit Requests, Loan Applications, and Ledger lists (all currently cut off silently at a limit)
- [x] **Forgot password flow** — add a `/forgot-password` page that calls `supabase.auth.resetPasswordForEmail()`
- [ ] **Email verification** — require email verification on signup before the account can be activated
- [x] **Loan amortization export** — add "Export Schedule" button on LoanDetailPage that downloads the repayment schedule as CSV/Excel
- [ ] **Admin notes on members** — add an internal `notes` text field to the member detail page (stored in profiles or a separate table); only visible to staff/admin
- [ ] **Overdue loan detection** — add a SQL function `get_overdue_loans()` that returns loans where the next scheduled installment date has passed and no payment was recorded; surface these prominently in admin Reports
- [x] **Date range filter on Reports** — let admin filter the member list, loan portfolio, and ledger by a date range
- [x] **Activity log page for members** — show member their own ledger/contribution history in a dedicated page (not just on Dashboard)
- [ ] **Audit log page for admin** — show a paginated list of all admin actions (approvals, rejections, config changes) pulled from a new `admin_audit_log` table
- [x] **Mobile-friendly tables** — on small screens, switch from horizontal-scroll tables to stacked card rows (one card per record with label: value layout)
- [x] **Skeleton loading placeholders** — replace `PageLoader` full-screen spinners with skeleton cards so the layout doesn't jump
- [x] **Loan calculator standalone page** — a page where any active member can enter an amount/term and see projected monthly payment without starting an application
- [x] **Config change audit trail** — display `system_config_history` in the System Config page so admin can see previous values and who changed them
- [ ] **Session timeout warning** — detect Supabase session expiry and show a "Your session is about to expire" banner with a refresh option
- [ ] **Member document upload** — allow members to attach a government ID or proof of address during registration or from their profile
- [x] **Refetch interval on co-maker requests** — `useMyCoMakerRequests` has no polling; add `refetchInterval: 60_000` so the badge updates without page refresh
- [x] **Duplicate application guard** — add a debounce/lock on the loan application submit button to prevent double submission on slow connections
- [ ] **Password strength indicator** — show a visual strength meter below the password field on RegisterPage and password-reset pages

### Database
- [ ] **`get_overdue_loans()` function** — returns loans where `due_date < now()` and `status = 'active'` with days overdue
- [ ] **Soft delete for users** — instead of hard-deleting profiles, add `deleted_at` column and filter it out in queries
- [ ] **RLS hardening on ledger** — restrict staff from viewing ledger entries tagged as internal/admin-only
- [ ] **Atomic loan disbursement** — wrap the approval function's insert into `loans`, schedule generation, and ledger entry in a single transaction block (currently best-effort)

---

## 🔴 Large Effort (multiple days to weeks)

### Mobile & Responsive Design
- [x] **Responsive sidebar** — convert the fixed sidebar into a hamburger-menu drawer on screens < 768px; add an overlay backdrop and swipe-to-close gesture
- [ ] **Full mobile layout audit** — go through every page and ensure touch target sizes are at least 44×44px, spacing is comfortable, and no content is cut off

### Search & Discovery
- [x] **Global search** — add a search bar in the top header that searches across members, loan applications, deposit requests, and transactions simultaneously (Supabase full-text search or a client-side filter on cached data)
- [ ] **Faceted filtering** — allow filtering lists by multiple criteria at once (e.g., status + date range + amount range)

### Notifications
- [ ] **In-app notification center** — a bell icon in the header with a dropdown of recent events (loan approved, deposit approved, co-maker request received, etc.); requires a `notifications` table and real-time subscription
- [ ] **Email notifications via Supabase Edge Functions** — send emails on: deposit approved/rejected, loan approved/rejected, co-maker request received, membership approved

### Reporting & Analytics
- [x] **Charts and visualizations** — add bar/line charts to the Reports page: monthly contributions over time, loan portfolio health, new member growth (use recharts or chart.js)
- [x] **PDF report generation** — generate a formatted PDF of the member report, loan portfolio, and individual member statements
- [ ] **Scheduled report emails** — allow admin to configure weekly/monthly report emails sent automatically via Edge Function + cron

### Security
- [x] **Rate limiting** — client-side lockout after 5 failed login attempts (15-min window, sessionStorage-tracked); server-side configurable via Supabase Auth → Rate Limits dashboard
- [ ] **Two-factor authentication (2FA)** — integrate TOTP-based 2FA through Supabase Auth or a third-party provider
- [ ] **GDPR data export** — let members download all their personal data as a JSON/CSV file
- [ ] **IP-based anomaly detection** — flag logins from unusual locations (requires Edge Function + logging)

### Admin Power Features
- [x] **Bulk actions** — bulk approve/reject deposit requests; bulk activate/suspend members
- [x] **User impersonation** — allow admin to log in as a member to debug their experience (requires careful RLS and audit logging)
- [ ] **Customizable member fields** — allow admin to add custom profile fields (e.g., department, branch) without code changes
- [ ] **Loan restructuring** — allow admin to modify an existing active loan's term or interest rate and regenerate the schedule

### Performance
- [x] **Code splitting** — split the ~966KB JS bundle by route using dynamic `import()` so each page only loads what it needs; this is the single biggest performance improvement
- [ ] **Virtual scrolling** — use a library like `react-virtual` for tables with hundreds of rows
- [ ] **Selective column fetching** — audit all Supabase `.select('*')` calls and replace with only the columns actually needed

---

## 📋 Summary

| Group | Count | Done | Remaining |
|---|---|---|---|
| 🟢 Quick wins | 33 | 33 | 0 |
| 🟡 Medium effort | 21 | 16 | 5 |
| 🔴 Large effort | 20 | 6 | 14 |

**All quick wins complete!** Remaining medium-effort items to tackle next:
- Email verification on signup
- Admin notes on members
- Overdue loan detection (partial — status exists in data model, no dedicated admin view)
- Audit log page for admin (logging exists, no dedicated page yet)
- Session timeout warning
- Member document upload
- Password strength indicator

Remaining large-effort items:
- CSV export option alongside Excel
- Global search
- Faceted filtering
- In-app notification center
- Email notifications via Edge Functions
- Scheduled report emails
- Two-factor authentication (2FA)
- GDPR data export
- IP-based anomaly detection
- Customizable member fields
- Loan restructuring
- Code splitting
- Virtual scrolling
- Selective column fetching
