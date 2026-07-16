# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (Vite)
npm run build        # Type-check (tsc) then bundle (vite build)
npm run lint         # ESLint with --max-warnings 0
npm run preview      # Preview the production build locally
```

There are no tests. `npm run build` is the primary verification step — it runs TypeScript strict-mode checking before bundling.

## Architecture Overview

**Stack**: React 18 + TypeScript + Vite, TailwindCSS, Supabase (Postgres + Auth + Storage), TanStack React Query, React Hook Form + Zod, Recharts, jsPDF + xlsx.

**Deployment**: Vercel. `vercel.json` sets `buildCommand`, `outputDirectory`, and SPA rewrites. Path alias `@` → `src/` is configured in both `vite.config.ts` and `tsconfig.json`.

---

### Auth & Routing

`AuthContext` (`src/context/AuthContext.tsx`) holds `user`, `session`, and `profile` (from the `profiles` table). It is the source of truth for identity throughout the app.

`AppLayout` (`src/components/layout/AppLayout.tsx`) wraps protected routes and accepts a `requiredRoles` prop. It reads the profile role and redirects unauthorized users. The root route (`/`) redirects members to `/dashboard` and admin/staff to `/reports`.

Roles: `'admin' | 'member' | 'staff' | 'board'` — defined in `src/types/index.ts`. Board has read-only access to financial reports; staff has operational access; admin has full access.

**Impersonation**: `ImpersonationContext` (`src/context/ImpersonationContext.tsx`) lets admins view the app as a specific member. Use `useEffectiveUserId()` (not `useAuth().user?.id`) in any hook that should respect impersonation context. Impersonation actions are logged non-blockingly via `supabase.rpc('log_admin_action')`.

**Permissions**: `src/lib/permissions.ts` defines 23 `PERMISSION_KEYS` plus arrays for built-in roles. `useCanPermission(key)` checks dynamic per-permission grants (default-allow if not configured). Custom roles are stored in `custom_roles` / `custom_role_permissions` tables.

---

### Data Layer

**Single Supabase client** at `src/lib/supabase.ts`. All queries go through React Query hooks in `src/hooks/`. Never query Supabase directly from components.

**React Query global config** (set in `App.tsx`): `retry: 1`, `staleTime: 30_000`, `refetchOnWindowFocus: false`. Individual hooks may override (e.g., currency hook uses `staleTime: Infinity`).

**Hook pattern** — every hook wraps a React Query `useQuery` or `useMutation`:
- Query key conventions: `['equity_shares', userId]`, `['loans', loanId]`
- Hooks accept an optional `userId`; if omitted, they fall back to `useEffectiveUserId()` (respects impersonation)
- Admin variants of hooks (e.g., `useAdminCreateShare`) fetch all rows, not just the current user's
- `queryClient.invalidateQueries` is called in `onSuccess` to keep the cache fresh

**Supabase FK join limitation**: PostgREST cannot traverse `loans.user_id → auth.users → profiles.id`. For any table that references `auth.users` indirectly, use a **two-step fetch**: query the primary table first, collect `user_id` values, then `.select('id, full_name').in('id', ids)` on `profiles`, and build a lookup map.

**Mutations with Supabase RPC**: complex server-side operations (approve/reject deposit requests, loan approval) call Postgres functions via `supabase.rpc('function_name', params)`.

---

### Forms

React Hook Form + Zod everywhere. Define a `z.object` schema, derive `FormValues = z.infer<typeof schema>`, then pass `zodResolver(schema)` to `useForm`. Custom `Input`, `Select`, and `Textarea` components in `src/components/ui/Input.tsx` accept `error` prop and handle `aria-invalid` / `aria-describedby` automatically.

---

### Toast Notifications

`toast()` in `src/lib/toast.ts` dispatches a `CustomEvent` on `window`. `ToastContext` listens and manages the visible queue (max 4, auto-dismiss in 4 s). Call `toast('message', 'success' | 'error' | 'info')` from anywhere — hooks, utils, outside React tree.

---

### Layout & Responsive Design

- **Sidebar**: `fixed` overlay on mobile, `sticky` on `lg+`. Toggled via `sidebarOpen` state in `AppLayout`. Sign-out modal uses `ReactDOM.createPortal(..., document.body)` with `z-[200]` to avoid stacking-context issues inside the sidebar.
- **Mobile top bar**: `fixed top-0 h-14 z-20 lg:hidden` with hamburger. `<main>` has `pt-14 lg:pt-0`.
- **KPI grids**: `grid-cols-2 xl:grid-cols-4` is the standard pattern for stat cards.
- **Tab bars**: use `overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0` on the wrapper and `w-max min-w-full sm:w-fit` on the inner flex div — this enables edge-to-edge scroll on mobile without wrapping.

---

### Currency & Config

`useCurrency()` returns a `format(amount)` function. The currency symbol comes from `system_config` table (`currency_symbol` key). All financial display must go through this hook, not `formatCurrency` from utils directly.

`system_config` also stores `share_price`, `interest_rate`, `loan_interest_rate`, `dividend_rate`, `rebate_rate`, etc. Read via `useSystemConfig()` hook.

`useAppBranding()` fetches `app_name` and `app_logo_url` from `system_config` and updates `document.title`.

**Env vars**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_EMPLOYEE_API_KEY`. The dev server proxies `/api/pos` to an external POS system (see `vite.config.ts`).

---

### Exports

- **Excel**: `src/lib/exportExcel.ts` — `exportToExcel(rows, filename)` using xlsx.
- **PDF**: `src/lib/exportPdf.ts` — branded helpers (`exportMembersPdf`, `exportLoanPortfolioPdf`, `exportMemberStatementPdf`) using jsPDF + jspdf-autotable.

---

### Domain Model Summary

| Table | Purpose |
|---|---|
| `profiles` | User identity, role, employee_id, account status |
| `equity_shares` | A share subscription per member (has target_amount, paid_amount) |
| `equity_contributions` | Individual payments against a share |
| `deposit_requests` | Member submits → admin approves → contributions auto-created via RPC |
| `loan_applications` | Draft → submitted → under_review → approved/rejected |
| `loans` | Approved and disbursed loans (principal, outstanding, amount_paid) |
| `loan_repayment_schedule` | Per-installment due dates and amounts |
| `loan_repayments` | Recorded payments against a loan |
| `loan_co_makers` | Co-signers on a loan application (must confirm before approval) |
| `membership_status` | Tracks member activation; evaluated from equity share completion |
| `ledger_entries` | Financial audit log (double-entry style) |
| `system_config` | Key-value app settings (share price, rates, currency) |
| `branches` | Organizational units; `report_cutoff_day` controls financial reporting cycles |
| `savings_accounts` / `savings_deposit_requests` / `savings_withdrawals` | Savings product (separate from equity shares) |
| `loan_products` | Configurable loan types: 4 fee types (processing, insurance, service, CBU), 3 calculation methods (flat, reducing_balance, equal_principal) |
| `equity_dividends` / `equity_dividend_logs` | Dividend distribution system |
| `rebate_releases` / `rebate_logs` | Interest rebate system for loan repayments |
| `equity_share_transfers` | Member-to-member share transfer requests (approval workflow) |
| `batch_deposits` / `batch_deposit_items` | Collector-submitted batch of multiple member deposits |
| `damayan_events` / `damayan_assessments` | Mutual aid contribution tracking |
| `member_notes` | Admin timestamped notes on member profiles |
| `custom_roles` / `custom_role_permissions` / `role_permissions` | Dynamic permission grants beyond built-in roles |

**Loan calculations** (`src/lib/utils.ts`): `calculateMonthlyPayment()`, `calculateTotalRepayable()`, `calculateProductFees()` support all 3 interest methods.

Database migrations are in `/supabase/` as numbered SQL files. RLS is the primary access control mechanism — members can only see their own rows; admin/staff bypass via role check helper `get_user_role(uid)`.
