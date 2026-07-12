import { useQuery } from '@tanstack/react-query'
import { Header } from '../components/layout/Header'
import { Card, CardBody } from '../components/ui/Card'
import { supabase } from '../lib/supabase'
import { useCurrency } from '../hooks/useCurrency'

// ─── Config loader ────────────────────────────────────────────────────────────

function useRulesConfig() {
  return useQuery({
    queryKey: ['rules_config'],
    queryFn: async () => {
      const keys = [
        'share_price',
        'max_shares_per_member',
        'min_installment_amount',
        'loan_interest_rate',
        'max_loan_multiplier',
        'savings_interest_rate',
        'savings_interest_period_months',
        'savings_min_deposit',
        'savings_required_for_loan',
      ]
      const { data, error } = await supabase
        .from('system_config')
        .select('config_key, config_value, value_type')
        .in('config_key', keys)
      if (error) throw error

      const map: Record<string, string> = {}
      for (const row of data ?? []) map[row.config_key] = row.config_value
      return map
    },
    staleTime: 60_000,
  })
}

// ─── Section components ───────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  color = 'blue',
}: {
  icon: React.ReactNode
  title: string
  color?: 'blue' | 'green' | 'purple' | 'amber' | 'rose'
}) {
  const colorMap = {
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    green:  'bg-green-50 text-green-700 border-green-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
    rose:   'bg-rose-50 text-rose-700 border-rose-200',
  }
  const iconMap = {
    blue:   'bg-blue-100 text-blue-600',
    green:  'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    amber:  'bg-amber-100 text-amber-600',
    rose:   'bg-rose-100 text-rose-600',
  }
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${colorMap[color]}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconMap[color]}`}>
        {icon}
      </div>
      <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-center">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-base font-bold text-gray-900">{value}</p>
    </div>
  )
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-gray-700">
      <span className="mt-1 w-4 h-4 shrink-0 text-blue-500">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </span>
      <span>{children}</span>
    </li>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
      <span className="font-semibold">Note: </span>{children}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function RulesPage() {
  const { data: cfg = {}, isLoading } = useRulesConfig()
  const { format: currency } = useCurrency()

  const n = (key: string, fallback: number) =>
    cfg[key] ? parseFloat(cfg[key]) : fallback

  const sharePrice        = n('share_price', 5000)
  const maxShares         = n('max_shares_per_member', 5)
  const minInstallment    = n('min_installment_amount', 500)
  const loanRate          = n('loan_interest_rate', 2)
  const loanMultiplier    = n('max_loan_multiplier', 3)
  const savingsRate       = n('savings_interest_rate', 2.5)
  const savingsPeriod     = n('savings_interest_period_months', 6)
  const savingsMinDeposit = n('savings_min_deposit', 500)
  const savingsForLoan    = cfg['savings_required_for_loan'] === 'true'

  const savingsPeriodLabel = savingsPeriod === 6 ? 'every 6 months' :
    savingsPeriod === 12 ? 'annually' : `every ${savingsPeriod} months`

  if (isLoading) {
    return (
      <div>
        <Header title="Rules & Policies" subtitle="Cooperative membership rules and product guidelines" />
        <div className="p-4 sm:p-6">
          <div className="space-y-4 max-w-3xl mx-auto">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Rules & Policies"
        subtitle="Cooperative membership rules and product guidelines"
      />

      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">

        {/* Quick nav */}
        <div className="flex flex-wrap gap-2">
          {['Membership', 'Equity Shares', 'Savings', 'Loans', 'Deposits & Receipts'].map(label => (
            <a
              key={label}
              href={`#rules-${label.replace(/\s+/g, '-').toLowerCase()}`}
              className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-700 transition-colors"
            >
              {label}
            </a>
          ))}
        </div>

        {/* ── Membership ──────────────────────────────────────────────────── */}
        <section id="rules-membership" className="space-y-4">
          <SectionHeader
            color="blue"
            title="Membership"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <Card>
            <CardBody className="space-y-4">
              <ul className="space-y-3">
                <Rule>Registration requires admin approval before you can access the platform.</Rule>
                <Rule>
                  Your membership becomes <strong>Active</strong> once you complete your first equity share.
                  Only Active members can apply for loans.
                </Rule>
                <Rule>
                  A <strong>Savings Account</strong> is automatically opened for you when your first equity share is completed — no action needed.
                </Rule>
                <Rule>
                  Membership can be <strong>Suspended</strong> if a loan defaults. Suspended members cannot submit deposit requests or apply for loans until reinstated by an admin.
                </Rule>
              </ul>
            </CardBody>
          </Card>
        </section>

        {/* ── Equity Shares ───────────────────────────────────────────────── */}
        <section id="rules-equity-shares" className="space-y-4">
          <SectionHeader
            color="purple"
            title="Equity Shares"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Share Price" value={currency(sharePrice)} />
            <Stat label="Max Shares" value={`${maxShares} shares`} />
            <Stat label="Min Installment" value={currency(minInstallment)} />
          </div>
          <Card>
            <CardBody className="space-y-4">
              <ul className="space-y-3">
                <Rule>
                  Each share has a fixed target of <strong>{currency(sharePrice)}</strong>. You build it up through installment deposits until fully paid.
                </Rule>
                <Rule>
                  The minimum single deposit installment is <strong>{currency(minInstallment)}</strong>.
                </Rule>
                <Rule>
                  A member can hold up to <strong>{maxShares} shares</strong> at a time.
                </Rule>
                <Rule>
                  Once a share is completed, the next one is created automatically. Any overpayment rolls over to the new share.
                </Rule>
                <Rule>
                  Completed shares count toward your loan eligibility and appear on your membership certificate.
                </Rule>
                <Rule>
                  Equity shares do <strong>not</strong> earn interest. Returns on shares come from the cooperative's annual dividend distribution.
                </Rule>
              </ul>
            </CardBody>
          </Card>
        </section>

        {/* ── Savings ─────────────────────────────────────────────────────── */}
        <section id="rules-savings" className="space-y-4">
          <SectionHeader
            color="green"
            title="Savings"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            }
          />
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Interest Rate" value={`${savingsRate}%`} />
            <Stat label="Credited" value={savingsPeriodLabel} />
            <Stat label="Min Deposit" value={currency(savingsMinDeposit)} />
          </div>
          <Card>
            <CardBody className="space-y-4">
              <ul className="space-y-3">
                <Rule>
                  Your savings account opens automatically once you complete your first equity share.
                </Rule>
                <Rule>
                  The minimum single deposit is <strong>{currency(savingsMinDeposit)}</strong>. There is no maximum — you can deposit any amount.
                </Rule>
                <Rule>
                  Interest of <strong>{savingsRate}%</strong> is credited to your savings balance <strong>{savingsPeriodLabel}</strong>.
                </Rule>
                <Rule>
                  Deposits and withdrawals both require admin approval, similar to equity deposits.
                </Rule>
                {savingsForLoan && (
                  <Rule>
                    An active savings account is required before you can apply for a loan.
                  </Rule>
                )}
              </ul>

              {/* ADB explanation */}
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-green-800">How interest is calculated — Average Daily Balance (ADB)</p>
                <p className="text-sm text-green-700">
                  Interest is not simply applied to your balance on the release date. Instead, it is calculated on
                  the <strong>average balance you held throughout the entire {savingsPeriod}-month period</strong>.
                  Each peso earns interest only for the exact number of days it actually sat in your account.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    {
                      name: 'Ana',
                      desc: `Deposited ${currency(5000)} on Day 1, nothing else`,
                      avg: currency(5000),
                      interest: currency(5000 * savingsRate / 100),
                    },
                    {
                      name: 'Ben',
                      desc: `Deposited ${currency(200)} every day for ${savingsPeriod * 30} days`,
                      avg: `~${currency(5000 * savingsRate / 100 * 36)}`, // rough approx
                      interest: 'Higher — consistent saver',
                    },
                    {
                      name: 'Carlo',
                      desc: `Did nothing, then deposited ${currency(500000)} 5 days before release`,
                      avg: `~${currency(500000 * 5 / (savingsPeriod * 30))}`,
                      interest: `~${currency(500000 * 5 / (savingsPeriod * 30) * savingsRate / 100)} — not the full ${savingsRate}%`,
                    },
                  ].map(ex => (
                    <div key={ex.name} className="bg-white border border-green-200 rounded-lg p-3 space-y-1">
                      <p className="font-semibold text-green-800">{ex.name}</p>
                      <p className="text-gray-600">{ex.desc}</p>
                      <p className="text-green-700 font-medium">{ex.interest}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-green-600">
                  Making a large deposit right before the interest release date gives very little benefit —
                  that money is only counted for the few days it was actually held.
                </p>
              </div>
            </CardBody>
          </Card>
        </section>

        {/* ── Loans ───────────────────────────────────────────────────────── */}
        <section id="rules-loans" className="space-y-4">
          <SectionHeader
            color="amber"
            title="Loans"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Monthly Interest Rate" value={`${loanRate}%`} />
            <Stat label="Max Loan Amount" value={`${loanMultiplier}× your equity`} />
          </div>
          <Card>
            <CardBody className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Eligibility Requirements</p>
                <ul className="space-y-3">
                  <Rule>You must have <strong>Active</strong> membership status.</Rule>
                  <Rule>You must have at least <strong>one completed equity share</strong>.</Rule>
                  <Rule>You must have <strong>no existing active loan</strong> or pending application.</Rule>
                  <Rule>All your co-makers must confirm before the application is submitted for review.</Rule>
                  {savingsForLoan && (
                    <Rule>You must have an active savings account.</Rule>
                  )}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Loan Amount</p>
                <ul className="space-y-3">
                  <Rule>
                    Maximum loan = <strong>{loanMultiplier}× the total value of your completed shares</strong>.
                    For example, 2 completed shares at {currency(sharePrice)} = {currency(sharePrice * 2)} equity → max loan of {currency(sharePrice * 2 * loanMultiplier)}.
                  </Rule>
                  <Rule>Only one active loan is allowed at a time. You must fully repay before reapplying.</Rule>
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Co-Makers</p>
                <ul className="space-y-3">
                  <Rule>A co-maker is a fellow member who guarantees your loan and is responsible if you default.</Rule>
                  <Rule>A co-maker must be Active, have at least one completed share, and have no active loan of their own.</Rule>
                  <Rule>A co-maker cannot be guaranteeing more than one active application at a time.</Rule>
                  <Rule>Once a co-maker confirms, they cannot withdraw their confirmation.</Rule>
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Interest</p>
                <ul className="space-y-3">
                  <Rule>
                    Monthly interest rate: <strong>{loanRate}%</strong> per month.
                    The cooperative may use either flat-rate or reducing-balance calculation depending on your loan product.
                  </Rule>
                  <Rule>
                    <strong>Flat rate</strong>: interest is computed on the original principal each month — payments are equal throughout.
                  </Rule>
                  <Rule>
                    <strong>Reducing balance</strong>: interest is computed only on the outstanding balance — later payments have less interest and more principal.
                  </Rule>
                  <Rule>You will see a full repayment schedule preview before you submit your application.</Rule>
                </ul>
              </div>

              <Note>
                If your loan is marked as <strong>Defaulted</strong>, your membership is automatically suspended
                and you will lose access to deposits and new loans until the situation is resolved with an administrator.
              </Note>
            </CardBody>
          </Card>
        </section>

        {/* ── Deposits & Receipts ─────────────────────────────────────────── */}
        <section id="rules-deposits-&-receipts" className="space-y-4">
          <SectionHeader
            color="rose"
            title="Deposits & Receipts"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          />
          <Card>
            <CardBody className="space-y-4">
              <ul className="space-y-3">
                <Rule>All deposits — for equity shares and savings — must be submitted as a request and approved by an administrator before your balance is updated.</Rule>
                <Rule>You must upload a receipt or deposit slip with every deposit request. Accepted formats: JPG, PNG, or PDF (max 10 MB).</Rule>
                <Rule>
                  The receipt must clearly show the <strong>amount</strong>, <strong>date</strong>, and <strong>transaction reference</strong>.
                  Blurry or incomplete receipts may be rejected.
                </Rule>
                <Rule>
                  If a deposit is rejected, the reason will appear in your history. You can correct the issue and submit a new request.
                </Rule>
                <Rule>
                  Approved deposits are final and cannot be reversed by the member. Contact your administrator for any dispute.
                </Rule>
              </ul>
            </CardBody>
          </Card>
        </section>

        {/* Footer */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <p className="font-semibold">Questions not covered here?</p>
          <p className="mt-0.5 text-blue-700">
            Contact your cooperative administrator. Rules and rates shown on this page reflect the current system
            configuration and may be updated by the administrator at any time.
          </p>
        </div>
      </div>
    </div>
  )
}
