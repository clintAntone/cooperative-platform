import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Header } from '../../components/layout/Header'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { useActiveLoanProducts } from '../../hooks/useLoans'
import { useLoanEligibility } from '../../hooks/useLoanEligibility'
import { calculateMonthlyPayment, calculateTotalRepayable, calculateProductFees, formatInterestLabel, toMonthlyRate } from '../../lib/utils'
import { useCurrency } from '../../hooks/useCurrency'
import type { LoanProduct } from '../../types'

export function LoanCalculatorPage() {
  const { data: products = [], isLoading } = useActiveLoanProducts()
  const { data: maxEligible = null } = useLoanEligibility()
  const { format: currency } = useCurrency()

  const [selectedProduct, setSelectedProduct] = useState<LoanProduct | null>(null)
  const [amount, setAmount] = useState('')
  const [termMonths, setTermMonths] = useState(12)

  // Auto-select single product
  useEffect(() => {
    if (products.length === 1 && !selectedProduct) {
      setSelectedProduct(products[0])
    }
  }, [products, selectedProduct])

  // Reset term when product changes
  useEffect(() => {
    if (selectedProduct) {
      setTermMonths(selectedProduct.min_term_months)
    }
  }, [selectedProduct])

  // Effective max = min(product cap, eligibility cap)
  const effectiveMax = selectedProduct?.max_amount && maxEligible !== null
    ? Math.min(maxEligible, selectedProduct.max_amount)
    : selectedProduct?.max_amount ?? maxEligible ?? undefined

  const principal = Math.min(parseFloat(amount) || 0, effectiveMax ?? Infinity)
  const interestRate = selectedProduct?.interest_rate ?? 0
  const calcMethod = selectedProduct?.calculation_method ?? 'reducing_balance'
  const ratePeriod = selectedProduct?.interest_rate_period ?? 'annual'

  const monthlyPayment = principal > 0 && termMonths > 0 && selectedProduct
    ? calculateMonthlyPayment(principal, interestRate, termMonths, calcMethod, ratePeriod)
    : 0

  const totalRepayable = monthlyPayment > 0
    ? calculateTotalRepayable(principal, interestRate, termMonths, calcMethod, ratePeriod)
    : 0

  const totalInterest = totalRepayable - principal
  const fees = selectedProduct ? calculateProductFees(principal, selectedProduct) : null

  // Build amortization schedule
  function buildSchedule() {
    if (!principal || !selectedProduct || monthlyPayment <= 0) return []
    const r = toMonthlyRate(interestRate, ratePeriod)
    const rows = []
    let balance = principal
    for (let i = 1; i <= termMonths; i++) {
      let interest: number
      let principalPart: number
      if (calcMethod === 'flat') {
        interest = principal * r
        principalPart = principal / termMonths
      } else if (calcMethod === 'equal_principal') {
        principalPart = principal / termMonths
        interest = balance * r
      } else {
        interest = balance * r
        principalPart = monthlyPayment - interest
      }
      balance = Math.max(0, balance - principalPart)
      rows.push({ no: i, payment: principalPart + interest, interest, principal: principalPart, balance })
    }
    return rows
  }

  const schedule = buildSchedule()
  const [showSchedule, setShowSchedule] = useState(false)

  const termOptions = selectedProduct
    ? Array.from(
        { length: selectedProduct.max_term_months - selectedProduct.min_term_months + 1 },
        (_, i) => selectedProduct.min_term_months + i
      )
    : [3, 6, 12, 18, 24, 36]

  return (
    <div>
      <Header
        title="Lending"
        subtitle="Loan applications and active loans"
      />

      {/* Tabs */}
      <div className="border-b border-gray-200 px-4 sm:px-6">
        <div className="flex gap-1">
          <NavLink
            to="/lending"
            end
            className={({ isActive }) =>
              `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`
            }
          >
            My Loans
          </NavLink>
          <NavLink
            to="/lending/calculator"
            className={({ isActive }) =>
              `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`
            }
          >
            Loan Calculator
          </NavLink>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start space-y-6 lg:space-y-0">
          {/* ── Left column: inputs ── */}
          <div className="space-y-6">
            {/* Product selector */}
            {isLoading ? (
              <p className="text-sm text-gray-400">Loading loan products…</p>
            ) : products.length === 0 ? (
              <Card>
                <CardBody className="py-10 text-center">
                  <p className="text-sm text-gray-500">No loan products available yet.</p>
                </CardBody>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-gray-900">Loan Product</h3>
                </CardHeader>
                <CardBody className="space-y-2 pt-0">
                  {products.map(p => (
                    <label
                      key={p.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        selectedProduct?.id === p.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="product"
                        value={p.id}
                        checked={selectedProduct?.id === p.id}
                        onChange={() => setSelectedProduct(p)}
                        className="mt-0.5 accent-blue-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatInterestLabel(p.interest_rate, p.interest_rate_period ?? 'annual', p.calculation_method)} ·{' '}
                          {p.min_term_months}–{p.max_term_months} months
                          {p.max_amount ? ` · up to ${currency(p.max_amount)}` : ''}
                        </p>
                      </div>
                    </label>
                  ))}
                </CardBody>
              </Card>
            )}

            {/* Inputs */}
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-gray-900">Loan Details</h3>
              </CardHeader>
              <CardBody className="space-y-4 pt-0">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Loan Amount</label>
                  <input
                    type="number"
                    step="100"
                    min="0"
                    max={effectiveMax}
                    value={amount}
                    onChange={e => {
                      const val = e.target.value
                      if (effectiveMax != null && parseFloat(val) > effectiveMax) {
                        setAmount(String(effectiveMax))
                      } else {
                        setAmount(val)
                      }
                    }}
                    placeholder="Enter amount"
                    disabled={!selectedProduct}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                  {effectiveMax != null && effectiveMax > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      Max eligible: {currency(effectiveMax)}
                      {maxEligible !== null && selectedProduct?.max_amount && maxEligible > selectedProduct.max_amount
                        ? ' (capped by product limit)'
                        : maxEligible !== null && selectedProduct?.max_amount && selectedProduct.max_amount > maxEligible
                        ? ' (based on your equity shares)'
                        : ''}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Repayment Term: <span className="text-blue-600 font-semibold">{termMonths} months</span>
                  </label>
                  <input
                    type="range"
                    min={selectedProduct?.min_term_months ?? 1}
                    max={selectedProduct?.max_term_months ?? 36}
                    step={1}
                    value={termMonths}
                    onChange={e => setTermMonths(parseInt(e.target.value))}
                    disabled={!selectedProduct}
                    className="w-full accent-blue-600 disabled:opacity-50"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{selectedProduct?.min_term_months ?? 1} mo</span>
                    <span>{selectedProduct?.max_term_months ?? 36} mo</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {termOptions.filter((_, i) => i % Math.ceil(termOptions.length / 6) === 0 || termOptions.length <= 6).map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTermMonths(n)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          termMonths === n
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-300 text-gray-600 hover:border-blue-400'
                        }`}
                      >
                        {n}mo
                      </button>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* ── Right column: results + amortization ── */}
          <div className="space-y-6">
            {monthlyPayment > 0 ? (
              <>
                <Card>
                  <CardHeader>
                    <h3 className="text-sm font-semibold text-gray-900">Payment Summary</h3>
                  </CardHeader>
                  <CardBody className="pt-0">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-50 rounded-xl p-4">
                        <p className="text-xs text-blue-600 font-medium mb-1">Monthly Payment</p>
                        <p className="text-2xl font-bold text-blue-700">{currency(monthlyPayment)}</p>
                        <p className="text-xs text-blue-500 mt-1">for {termMonths} months</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-4">
                        <p className="text-xs text-gray-500 font-medium mb-1">Total Repayable</p>
                        <p className="text-2xl font-bold text-gray-900">{currency(totalRepayable)}</p>
                        <p className="text-xs text-gray-400 mt-1">incl. interest</p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-xs text-gray-400">Principal</p>
                        <p className="text-sm font-semibold text-gray-900">{currency(principal)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Total Interest</p>
                        <p className="text-sm font-semibold text-red-600">{currency(totalInterest)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Rate</p>
                        <p className="text-sm font-semibold text-gray-900">{interestRate}% p.a.</p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Principal ({((principal / totalRepayable) * 100).toFixed(0)}%)</span>
                        <span>Interest ({((totalInterest / totalRepayable) * 100).toFixed(0)}%)</span>
                      </div>
                      <div className="w-full h-3 rounded-full bg-red-200 overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${(principal / totalRepayable) * 100}%` }}
                        />
                      </div>
                    </div>
                    {fees && (fees.processingFee > 0 || fees.insurance > 0 || fees.serviceFee > 0 || fees.cbuMonthly > 0) && (
                      <div className="mt-4 pt-4 border-t border-gray-100 space-y-1.5">
                        <p className="text-xs font-medium text-gray-600">Fees</p>
                        {fees.processingFee > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Processing Fee (upfront)</span>
                            <span className="text-gray-700 font-medium">{currency(fees.processingFee)}</span>
                          </div>
                        )}
                        {fees.insurance > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Insurance (upfront)</span>
                            <span className="text-gray-700 font-medium">{currency(fees.insurance)}</span>
                          </div>
                        )}
                        {fees.serviceFee > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Service Fee (upfront)</span>
                            <span className="text-gray-700 font-medium">{currency(fees.serviceFee)}</span>
                          </div>
                        )}
                        {fees.cbuMonthly > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">CBU (monthly)</span>
                            <span className="text-gray-700 font-medium">{currency(fees.cbuMonthly)}/mo</span>
                          </div>
                        )}
                        <div className="flex justify-between text-xs pt-1.5 border-t border-gray-100">
                          <span className="text-gray-600 font-medium">Net Proceeds</span>
                          <span className="text-gray-900 font-semibold">{currency(fees.netProceeds)}</span>
                        </div>
                      </div>
                    )}
                  </CardBody>
                </Card>

                {/* Amortization schedule toggle */}
                <button
                  onClick={() => setShowSchedule(s => !s)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:border-blue-300 transition-colors"
                >
                  <span>View Amortization Schedule</span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${showSchedule ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showSchedule && (
                  <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                            <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">#</th>
                            <th className="text-right px-4 py-2.5 font-medium text-gray-500 text-xs">Payment</th>
                            <th className="text-right px-4 py-2.5 font-medium text-gray-500 text-xs">Principal</th>
                            <th className="text-right px-4 py-2.5 font-medium text-gray-500 text-xs">Interest</th>
                            <th className="text-right px-4 py-2.5 font-medium text-gray-500 text-xs">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {schedule.map(row => (
                            <tr key={row.no} className="hover:bg-gray-50">
                              <td className="px-4 py-2 text-gray-400 text-xs">{row.no}</td>
                              <td className="px-4 py-2 text-right font-medium text-gray-900">{currency(row.payment)}</td>
                              <td className="px-4 py-2 text-right text-blue-700">{currency(row.principal)}</td>
                              <td className="px-4 py-2 text-right text-red-500">{currency(row.interest)}</td>
                              <td className="px-4 py-2 text-right text-gray-500">{currency(row.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </>
            ) : (
              <div className="hidden lg:flex items-center justify-center h-48 rounded-xl border-2 border-dashed border-gray-200">
                <p className="text-sm text-gray-400">Enter an amount to see payment summary</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
