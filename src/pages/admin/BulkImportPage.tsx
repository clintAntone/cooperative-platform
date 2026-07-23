import { useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { Header } from '../../components/layout/Header'
import { Card, CardBody } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useCurrency } from '../../hooks/useCurrency'
import { toast } from '../../lib/toast'

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportTab = 'shares' | 'deposits' | 'loans'

interface ShareRow {
  _row: number
  employee_id: string
  target_amount: number
  paid_amount: number
  status: string
  // resolved
  user_id?: string
  member_name?: string
  errors: string[]
}

interface DepositRow {
  _row: number
  employee_id: string
  amount: number
  payment_method: string
  reference: string
  date: string
  // resolved
  user_id?: string
  share_id?: string
  member_name?: string
  errors: string[]
}

interface LoanRow {
  _row: number
  employee_id: string
  principal: number
  interest_rate: number
  term_months: number
  calculation_method: string
  repayment_frequency: string
  outstanding: number
  disbursed_at: string
  due_date: string
  status: string
  // resolved
  user_id?: string
  member_name?: string
  errors: string[]
}

// ─── Templates ────────────────────────────────────────────────────────────────

function downloadTemplate(tab: ImportTab) {
  let rows: Record<string, string | number>[] = []
  let filename = ''

  if (tab === 'shares') {
    filename = 'shares_import_template'
    rows = [
      { employee_id: 'EMP-04-01-ABCD1234', target_amount: 5000, paid_amount: 0, status: 'in_progress' },
      { employee_id: 'EMP-04-02-EFGH5678', target_amount: 5000, paid_amount: 2500, status: 'in_progress' },
    ]
  } else if (tab === 'deposits') {
    filename = 'deposits_import_template'
    rows = [
      { employee_id: 'EMP-04-01-ABCD1234', amount: 1000, payment_method: 'cash', reference: 'REF-001', date: '2026-07-23' },
      { employee_id: 'EMP-04-02-EFGH5678', amount: 2500, payment_method: 'bank_transfer', reference: '', date: '2026-07-23' },
    ]
  } else {
    filename = 'loans_import_template'
    rows = [
      {
        employee_id: 'EMP-04-01-ABCD1234',
        principal: 50000,
        interest_rate: 5,
        term_months: 12,
        calculation_method: 'flat',
        repayment_frequency: 'monthly',
        outstanding: 50000,
        disbursed_at: '2026-07-23',
        due_date: '2027-07-23',
        status: 'active',
      },
    ]
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(val: unknown): string {
  if (!val) return new Date().toISOString().split('T')[0]
  if (typeof val === 'number') {
    // Excel serial date
    const date = XLSX.SSF.parse_date_code(val)
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }
  return String(val).trim()
}

const VALID_PAYMENT_METHODS = ['cash', 'bank_transfer', 'mobile_money']
const VALID_SHARE_STATUSES = ['in_progress', 'completed', 'cancelled']
const VALID_LOAN_STATUSES = ['active', 'completed', 'defaulted', 'written_off']
const VALID_CALC_METHODS = ['flat', 'reducing_balance']
const VALID_FREQ = ['weekly', 'bi_weekly', 'semi_monthly', 'monthly']

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => ref.current?.click()}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300 hover:bg-gray-50'}`}
    >
      <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-sm text-gray-500">Drop Excel file here or <span className="text-blue-600">browse</span></p>
      <p className="text-xs text-gray-400 mt-1">.xlsx or .xls</p>
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </div>
  )
}

// ─── Row status pill ──────────────────────────────────────────────────────────

function RowStatus({ errors }: { errors: string[] }) {
  if (errors.length === 0) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Ready</span>
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{errors.length} error{errors.length > 1 ? 's' : ''}</span>
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function BulkImportPage() {
  const { user } = useAuth()
  const { format: currency } = useCurrency()
  const [tab, setTab] = useState<ImportTab>('shares')

  // Shares
  const [shareRows, setShareRows] = useState<ShareRow[] | null>(null)
  const [shareImporting, setShareImporting] = useState(false)
  const [shareResult, setShareResult] = useState<{ ok: number; failed: number } | null>(null)

  // Deposits
  const [depositRows, setDepositRows] = useState<DepositRow[] | null>(null)
  const [depositImporting, setDepositImporting] = useState(false)
  const [depositResult, setDepositResult] = useState<{ ok: number; failed: number } | null>(null)

  // Loans
  const [loanRows, setLoanRows] = useState<LoanRow[] | null>(null)
  const [loanImporting, setLoanImporting] = useState(false)
  const [loanResult, setLoanResult] = useState<{ ok: number; failed: number } | null>(null)

  // ── Parse & validate shares ──────────────────────────────────────────────

  const parseShares = async (file: File) => {
    setShareRows(null); setShareResult(null)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

    // Fetch all profiles for lookup
    const { data: profiles } = await supabase.from('profiles').select('id, employee_id, full_name').eq('role', 'member')
    const empMap = Object.fromEntries((profiles ?? []).map(p => [p.employee_id?.toUpperCase(), p]))

    const rows: ShareRow[] = raw.map((r, i) => {
      const errors: string[] = []
      const emp_id = String(r['employee_id'] ?? '').trim().toUpperCase()
      const target = parseFloat(String(r['target_amount'] ?? ''))
      const paid = parseFloat(String(r['paid_amount'] ?? '0'))
      const status = String(r['status'] ?? 'in_progress').trim().toLowerCase()

      if (!emp_id) errors.push('employee_id is required')
      if (isNaN(target) || target <= 0) errors.push('target_amount must be a positive number')
      if (isNaN(paid) || paid < 0) errors.push('paid_amount must be 0 or positive')
      if (!VALID_SHARE_STATUSES.includes(status)) errors.push(`status must be one of: ${VALID_SHARE_STATUSES.join(', ')}`)

      const profile = empMap[emp_id]
      if (emp_id && !profile) errors.push(`Employee ID "${emp_id}" not found`)

      return {
        _row: i + 2,
        employee_id: emp_id,
        target_amount: isNaN(target) ? 0 : target,
        paid_amount: isNaN(paid) ? 0 : paid,
        status,
        user_id: profile?.id,
        member_name: profile?.full_name,
        errors,
      }
    })

    setShareRows(rows)
  }

  const importShares = async () => {
    if (!shareRows) return
    const valid = shareRows.filter(r => r.errors.length === 0)
    setShareImporting(true)
    let ok = 0; let failed = 0

    // Get current max share_number per user
    const { data: existingShares } = await supabase.from('equity_shares').select('user_id, share_number')
    const maxShareNum: Record<string, number> = {}
    for (const s of existingShares ?? []) {
      maxShareNum[s.user_id] = Math.max(maxShareNum[s.user_id] ?? 0, s.share_number)
    }

    for (const row of valid) {
      const shareNum = (maxShareNum[row.user_id!] ?? 0) + 1
      maxShareNum[row.user_id!] = shareNum
      const { error } = await supabase.from('equity_shares').insert({
        user_id: row.user_id,
        share_number: shareNum,
        target_amount: row.target_amount,
        paid_amount: row.paid_amount,
        status: row.status,
        completed_at: row.status === 'completed' ? new Date().toISOString() : null,
      })
      if (error) { failed++; console.error(error) } else { ok++ }
    }

    setShareImporting(false)
    setShareResult({ ok, failed })
    if (ok > 0) toast({ title: `${ok} share${ok > 1 ? 's' : ''} imported`, variant: 'success' })
    if (failed > 0) toast({ title: `${failed} row${failed > 1 ? 's' : ''} failed`, variant: 'error' })
  }

  // ── Parse & validate deposits ────────────────────────────────────────────

  const parseDeposits = async (file: File) => {
    setDepositRows(null); setDepositResult(null)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

    const { data: profiles } = await supabase.from('profiles').select('id, employee_id, full_name').eq('role', 'member')
    const empMap = Object.fromEntries((profiles ?? []).map(p => [p.employee_id?.toUpperCase(), p]))

    // Fetch active shares for each member
    const { data: shares } = await supabase.from('equity_shares').select('id, user_id, status').eq('status', 'in_progress')
    const shareMap = Object.fromEntries((shares ?? []).map(s => [s.user_id, s.id]))

    const rows: DepositRow[] = raw.map((r, i) => {
      const errors: string[] = []
      const emp_id = String(r['employee_id'] ?? '').trim().toUpperCase()
      const amount = parseFloat(String(r['amount'] ?? ''))
      const method = String(r['payment_method'] ?? '').trim().toLowerCase()
      const reference = String(r['reference'] ?? '').trim()
      const date = parseDate(r['date'])

      if (!emp_id) errors.push('employee_id is required')
      if (isNaN(amount) || amount <= 0) errors.push('amount must be a positive number')
      if (!VALID_PAYMENT_METHODS.includes(method)) errors.push(`payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`)

      const profile = empMap[emp_id]
      if (emp_id && !profile) errors.push(`Employee ID "${emp_id}" not found`)

      const share_id = profile ? shareMap[profile.id] : undefined
      if (profile && !share_id) errors.push('Member has no active (in_progress) share')

      return {
        _row: i + 2,
        employee_id: emp_id,
        amount: isNaN(amount) ? 0 : amount,
        payment_method: method,
        reference,
        date,
        user_id: profile?.id,
        share_id,
        member_name: profile?.full_name,
        errors,
      }
    })

    setDepositRows(rows)
  }

  const importDeposits = async () => {
    if (!depositRows) return
    const valid = depositRows.filter(r => r.errors.length === 0)
    setDepositImporting(true)
    let ok = 0; let failed = 0

    for (const row of valid) {
      const { error } = await supabase.rpc('admin_record_contribution_direct' as any, {
        p_user_id: row.user_id,
        p_share_id: row.share_id,
        p_amount: row.amount,
        p_payment_method: row.payment_method,
        p_reference: row.reference || null,
        p_date: new Date(row.date).toISOString(),
        p_recorded_by: user!.id,
      })
      if (error) { failed++; console.error(error) } else { ok++ }
    }

    setDepositImporting(false)
    setDepositResult({ ok, failed })
    if (ok > 0) toast({ title: `${ok} deposit${ok > 1 ? 's' : ''} imported`, variant: 'success' })
    if (failed > 0) toast({ title: `${failed} row${failed > 1 ? 's' : ''} failed`, variant: 'error' })
  }

  // ── Parse & validate loans ───────────────────────────────────────────────

  const parseLoans = async (file: File) => {
    setLoanRows(null); setLoanResult(null)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

    const { data: profiles } = await supabase.from('profiles').select('id, employee_id, full_name').eq('role', 'member')
    const empMap = Object.fromEntries((profiles ?? []).map(p => [p.employee_id?.toUpperCase(), p]))

    const rows: LoanRow[] = raw.map((r, i) => {
      const errors: string[] = []
      const emp_id = String(r['employee_id'] ?? '').trim().toUpperCase()
      const principal = parseFloat(String(r['principal'] ?? ''))
      const interest_rate = parseFloat(String(r['interest_rate'] ?? ''))
      const term_months = parseInt(String(r['term_months'] ?? ''))
      const calc_method = String(r['calculation_method'] ?? '').trim().toLowerCase()
      const freq = String(r['repayment_frequency'] ?? 'monthly').trim().toLowerCase()
      const outstanding = parseFloat(String(r['outstanding'] ?? String(r['principal'] ?? '')))
      const disbursed_at = parseDate(r['disbursed_at'])
      const due_date = parseDate(r['due_date'])
      const status = String(r['status'] ?? 'active').trim().toLowerCase()

      if (!emp_id) errors.push('employee_id is required')
      if (isNaN(principal) || principal <= 0) errors.push('principal must be a positive number')
      if (isNaN(interest_rate) || interest_rate < 0) errors.push('interest_rate must be 0 or positive')
      if (isNaN(term_months) || term_months <= 0) errors.push('term_months must be a positive integer')
      if (!VALID_CALC_METHODS.includes(calc_method)) errors.push(`calculation_method must be one of: ${VALID_CALC_METHODS.join(', ')}`)
      if (!VALID_FREQ.includes(freq)) errors.push(`repayment_frequency must be one of: ${VALID_FREQ.join(', ')}`)
      if (!due_date) errors.push('due_date is required')
      if (!VALID_LOAN_STATUSES.includes(status)) errors.push(`status must be one of: ${VALID_LOAN_STATUSES.join(', ')}`)

      const profile = empMap[emp_id]
      if (emp_id && !profile) errors.push(`Employee ID "${emp_id}" not found`)

      // total_repayable: simple estimate for display
      const total_repayable = calc_method === 'flat'
        ? principal + (principal * (interest_rate / 100) * (term_months / 12))
        : principal // rough; actual is computed server-side

      return {
        _row: i + 2,
        employee_id: emp_id,
        principal: isNaN(principal) ? 0 : principal,
        interest_rate: isNaN(interest_rate) ? 0 : interest_rate,
        term_months: isNaN(term_months) ? 0 : term_months,
        calculation_method: calc_method,
        repayment_frequency: freq,
        outstanding: isNaN(outstanding) ? (isNaN(principal) ? 0 : principal) : outstanding,
        disbursed_at,
        due_date,
        status,
        user_id: profile?.id,
        member_name: profile?.full_name,
        errors,
        _total_repayable: total_repayable,
      } as LoanRow & { _total_repayable: number }
    })

    setLoanRows(rows)
  }

  const importLoans = async () => {
    if (!loanRows) return
    const valid = loanRows.filter(r => r.errors.length === 0)
    setLoanImporting(true)
    let ok = 0; let failed = 0

    for (const row of valid) {
      const total_repayable = row.principal + (row.principal * (row.interest_rate / 100) * (row.term_months / 12))
      const { error } = await supabase.from('loans').insert({
        application_id: null,
        user_id: row.user_id,
        principal: row.principal,
        interest_rate: row.interest_rate,
        term_months: row.term_months,
        calculation_method: row.calculation_method,
        repayment_frequency: row.repayment_frequency,
        total_repayable,
        amount_paid: row.status === 'completed' ? total_repayable : (total_repayable - row.outstanding),
        outstanding: row.outstanding,
        status: row.status,
        disbursed_at: new Date(row.disbursed_at).toISOString(),
        due_date: row.due_date,
      })
      if (error) { failed++; console.error(error) } else { ok++ }
    }

    setLoanImporting(false)
    setLoanResult({ ok, failed })
    if (ok > 0) toast({ title: `${ok} loan${ok > 1 ? 's' : ''} imported`, variant: 'success' })
    if (failed > 0) toast({ title: `${failed} row${failed > 1 ? 's' : ''} failed`, variant: 'error' })
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const tabs: { value: ImportTab; label: string }[] = [
    { value: 'shares', label: 'Shares' },
    { value: 'deposits', label: 'Deposits' },
    { value: 'loans', label: 'Loans' },
  ]

  return (
    <div>
      <Header
        title="Bulk Import"
        subtitle="Upload Excel files to import shares, deposits, or loans in bulk"
      />

      <div className="p-4 sm:p-6 space-y-5">
        {/* Info banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="text-sm text-amber-800">
            <p className="font-medium">Admin bypass tool — use with care</p>
            <p className="mt-0.5 text-amber-700">Records are inserted directly without going through the normal approval workflow. Download the template first to ensure the correct column format.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {tabs.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Shares tab ─────────────────────────────────────────── */}
        {tab === 'shares' && (
          <div className="space-y-4">
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Import Equity Shares</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Required columns: <code className="bg-gray-100 px-1 rounded">employee_id</code>, <code className="bg-gray-100 px-1 rounded">target_amount</code> — Optional: <code className="bg-gray-100 px-1 rounded">paid_amount</code>, <code className="bg-gray-100 px-1 rounded">status</code></p>
                  </div>
                  <button onClick={() => downloadTemplate('shares')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                    Download Template
                  </button>
                </div>
                <DropZone onFile={parseShares} />
              </CardBody>
            </Card>

            {shareRows && (
              <Card>
                <CardBody>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-semibold text-gray-900">{shareRows.length} rows parsed</span>
                      <span className="ml-2 text-xs text-gray-500">{shareRows.filter(r => r.errors.length === 0).length} valid · {shareRows.filter(r => r.errors.length > 0).length} with errors</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={importShares}
                      loading={shareImporting}
                      disabled={shareImporting || shareRows.filter(r => r.errors.length === 0).length === 0}
                    >
                      Import {shareRows.filter(r => r.errors.length === 0).length} Shares
                    </Button>
                  </div>
                  {shareResult && (
                    <div className={`mb-3 px-3 py-2 rounded-lg text-sm ${shareResult.failed > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      {shareResult.ok} imported successfully{shareResult.failed > 0 ? `, ${shareResult.failed} failed` : ''}.
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Row', 'Employee ID', 'Member', 'Target', 'Paid', 'Status', 'Result'].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {shareRows.map(row => (
                          <tr key={row._row} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
                            <td className="px-3 py-2 text-gray-400">{row._row}</td>
                            <td className="px-3 py-2 font-mono text-gray-700">{row.employee_id}</td>
                            <td className="px-3 py-2 text-gray-700">{row.member_name ?? <span className="text-gray-400">—</span>}</td>
                            <td className="px-3 py-2 text-gray-700">{currency(row.target_amount)}</td>
                            <td className="px-3 py-2 text-gray-700">{currency(row.paid_amount)}</td>
                            <td className="px-3 py-2 text-gray-700">{row.status}</td>
                            <td className="px-3 py-2">
                              <RowStatus errors={row.errors} />
                              {row.errors.length > 0 && (
                                <ul className="mt-1 space-y-0.5">
                                  {row.errors.map((e, i) => <li key={i} className="text-red-600">{e}</li>)}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        )}

        {/* ── Deposits tab ───────────────────────────────────────── */}
        {tab === 'deposits' && (
          <div className="space-y-4">
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Import Deposits</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Required: <code className="bg-gray-100 px-1 rounded">employee_id</code>, <code className="bg-gray-100 px-1 rounded">amount</code>, <code className="bg-gray-100 px-1 rounded">payment_method</code> — Optional: <code className="bg-gray-100 px-1 rounded">reference</code>, <code className="bg-gray-100 px-1 rounded">date</code></p>
                    <p className="text-xs text-amber-600 mt-0.5">Member must have an active (in_progress) share. Deposits are applied directly to that share.</p>
                  </div>
                  <button onClick={() => downloadTemplate('deposits')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                    Download Template
                  </button>
                </div>
                <DropZone onFile={parseDeposits} />
              </CardBody>
            </Card>

            {depositRows && (
              <Card>
                <CardBody>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-semibold text-gray-900">{depositRows.length} rows parsed</span>
                      <span className="ml-2 text-xs text-gray-500">{depositRows.filter(r => r.errors.length === 0).length} valid · {depositRows.filter(r => r.errors.length > 0).length} with errors</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={importDeposits}
                      loading={depositImporting}
                      disabled={depositImporting || depositRows.filter(r => r.errors.length === 0).length === 0}
                    >
                      Import {depositRows.filter(r => r.errors.length === 0).length} Deposits
                    </Button>
                  </div>
                  {depositResult && (
                    <div className={`mb-3 px-3 py-2 rounded-lg text-sm ${depositResult.failed > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      {depositResult.ok} imported successfully{depositResult.failed > 0 ? `, ${depositResult.failed} failed` : ''}.
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Row', 'Employee ID', 'Member', 'Amount', 'Method', 'Reference', 'Date', 'Result'].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {depositRows.map(row => (
                          <tr key={row._row} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
                            <td className="px-3 py-2 text-gray-400">{row._row}</td>
                            <td className="px-3 py-2 font-mono text-gray-700">{row.employee_id}</td>
                            <td className="px-3 py-2 text-gray-700">{row.member_name ?? <span className="text-gray-400">—</span>}</td>
                            <td className="px-3 py-2 text-gray-700">{currency(row.amount)}</td>
                            <td className="px-3 py-2 text-gray-700">{row.payment_method}</td>
                            <td className="px-3 py-2 text-gray-500">{row.reference || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{row.date}</td>
                            <td className="px-3 py-2">
                              <RowStatus errors={row.errors} />
                              {row.errors.length > 0 && (
                                <ul className="mt-1 space-y-0.5">
                                  {row.errors.map((e, i) => <li key={i} className="text-red-600">{e}</li>)}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        )}

        {/* ── Loans tab ──────────────────────────────────────────── */}
        {tab === 'loans' && (
          <div className="space-y-4">
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Import Loans</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Required: <code className="bg-gray-100 px-1 rounded">employee_id</code>, <code className="bg-gray-100 px-1 rounded">principal</code>, <code className="bg-gray-100 px-1 rounded">interest_rate</code>, <code className="bg-gray-100 px-1 rounded">term_months</code>, <code className="bg-gray-100 px-1 rounded">calculation_method</code>, <code className="bg-gray-100 px-1 rounded">repayment_frequency</code>, <code className="bg-gray-100 px-1 rounded">due_date</code></p>
                    <p className="text-xs text-gray-400 mt-0.5">Optional: <code className="bg-gray-100 px-1 rounded">outstanding</code>, <code className="bg-gray-100 px-1 rounded">disbursed_at</code>, <code className="bg-gray-100 px-1 rounded">status</code></p>
                  </div>
                  <button onClick={() => downloadTemplate('loans')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                    Download Template
                  </button>
                </div>
                <DropZone onFile={parseLoans} />
              </CardBody>
            </Card>

            {loanRows && (
              <Card>
                <CardBody>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-semibold text-gray-900">{loanRows.length} rows parsed</span>
                      <span className="ml-2 text-xs text-gray-500">{loanRows.filter(r => r.errors.length === 0).length} valid · {loanRows.filter(r => r.errors.length > 0).length} with errors</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={importLoans}
                      loading={loanImporting}
                      disabled={loanImporting || loanRows.filter(r => r.errors.length === 0).length === 0}
                    >
                      Import {loanRows.filter(r => r.errors.length === 0).length} Loans
                    </Button>
                  </div>
                  {loanResult && (
                    <div className={`mb-3 px-3 py-2 rounded-lg text-sm ${loanResult.failed > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      {loanResult.ok} imported successfully{loanResult.failed > 0 ? `, ${loanResult.failed} failed` : ''}.
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Row', 'Employee ID', 'Member', 'Principal', 'Rate', 'Months', 'Method', 'Outstanding', 'Due Date', 'Status', 'Result'].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {loanRows.map(row => (
                          <tr key={row._row} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
                            <td className="px-3 py-2 text-gray-400">{row._row}</td>
                            <td className="px-3 py-2 font-mono text-gray-700">{row.employee_id}</td>
                            <td className="px-3 py-2 text-gray-700">{row.member_name ?? <span className="text-gray-400">—</span>}</td>
                            <td className="px-3 py-2 text-gray-700">{currency(row.principal)}</td>
                            <td className="px-3 py-2 text-gray-700">{row.interest_rate}%</td>
                            <td className="px-3 py-2 text-gray-700">{row.term_months}</td>
                            <td className="px-3 py-2 text-gray-700">{row.calculation_method}</td>
                            <td className="px-3 py-2 text-gray-700">{currency(row.outstanding)}</td>
                            <td className="px-3 py-2 text-gray-500">{row.due_date}</td>
                            <td className="px-3 py-2 text-gray-700">{row.status}</td>
                            <td className="px-3 py-2">
                              <RowStatus errors={row.errors} />
                              {row.errors.length > 0 && (
                                <ul className="mt-1 space-y-0.5">
                                  {row.errors.map((e, i) => <li key={i} className="text-red-600">{e}</li>)}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
