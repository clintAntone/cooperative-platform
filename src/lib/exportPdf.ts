import jsPDF from 'jspdf'
// @ts-ignore
import autoTable from 'jspdf-autotable'

function header(doc: jsPDF, title: string, subtitle?: string) {
  doc.setFillColor(37, 99, 235) // blue-600
  doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('CoopFinance', 14, 11)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(title, 14, 19)
  if (subtitle) {
    doc.setFontSize(8)
    doc.text(subtitle, 14, 24)
  }
  // Date on right
  doc.setFontSize(8)
  doc.text(new Date().toLocaleDateString('en-PH', { dateStyle: 'long' }), 196, 19, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

export interface MemberRow {
  full_name: string
  account_status: string
  membership_status: string
  completed_shares: number
}

export function exportMembersPdf(members: MemberRow[], subtitle?: string) {
  const doc = new jsPDF()
  header(doc, 'Member Report', subtitle)

  autoTable(doc, {
    startY: 34,
    head: [['Name', 'Account Status', 'Membership', 'Completed Shares']],
    body: members.map(m => [
      m.full_name,
      m.account_status,
      m.membership_status,
      String(m.completed_shares),
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  doc.save('members-report.pdf')
}

export interface LoanRow {
  member_name: string
  amount: number
  outstanding: number
  status: string
  disbursed_at: string | null
}

export function exportLoanPortfolioPdf(
  rows: LoanRow[],
  stats: { totalDisbursed: number; totalOutstanding: number; totalRepaid: number; activeLoans: number }
) {
  const doc = new jsPDF()
  header(doc, 'Loan Portfolio Report')

  // Summary block
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Portfolio Summary', 14, 40)
  doc.setFont('helvetica', 'normal')
  const fmt = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
  const summaryY = 45
  const summaryLines = [
    ['Total Disbursed:', fmt(stats.totalDisbursed)],
    ['Total Outstanding:', fmt(stats.totalOutstanding)],
    ['Total Repaid:', fmt(stats.totalRepaid)],
    ['Active Loans:', String(stats.activeLoans)],
  ]
  summaryLines.forEach(([label, value], i) => {
    doc.text(label, 14, summaryY + i * 6)
    doc.text(value, 80, summaryY + i * 6)
  })

  autoTable(doc, {
    startY: summaryY + summaryLines.length * 6 + 6,
    head: [['Member', 'Disbursed', 'Outstanding', 'Status', 'Date']],
    body: rows.map(r => [
      r.member_name,
      fmt(r.amount),
      fmt(r.outstanding),
      r.status,
      r.disbursed_at ? new Date(r.disbursed_at).toLocaleDateString('en-PH') : '—',
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  doc.save('loan-portfolio.pdf')
}

export interface MemberStatementRow {
  date: string
  type: string
  description: string
  amount: number
  running_total?: number
}

export function exportMemberStatementPdf(
  memberName: string,
  rows: MemberStatementRow[],
  summary: { totalContributions: number; completedShares: number; membershipStatus: string }
) {
  const doc = new jsPDF()
  header(doc, `Member Statement`, memberName)

  const fmt = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Account Summary', 14, 40)
  doc.setFont('helvetica', 'normal')
  const summaryLines = [
    ['Membership Status:', summary.membershipStatus],
    ['Completed Shares:', String(summary.completedShares)],
    ['Total Contributions:', fmt(summary.totalContributions)],
  ]
  summaryLines.forEach(([label, value], i) => {
    doc.text(label, 14, 46 + i * 6)
    doc.text(value, 80, 46 + i * 6)
  })

  autoTable(doc, {
    startY: 46 + summaryLines.length * 6 + 6,
    head: [['Date', 'Type', 'Description', 'Amount']],
    body: rows.map(r => [
      r.date,
      r.type,
      r.description,
      fmt(r.amount),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })

  doc.save(`member-statement-${memberName.replace(/\s+/g, '-').toLowerCase()}.pdf`)
}

export function exportMembershipCertificate(params: {
  memberName: string
  employeeId?: string | null
  completedShares: number
  totalInvested: number
  memberSince: string
  coopName?: string
}) {
  const {
    memberName,
    employeeId,
    completedShares,
    totalInvested,
    memberSince,
    coopName = 'CoopFinance',
  } = params

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = 297
  const H = 210
  const cx = W / 2

  // jsPDF doesn't account for charSpace when computing center alignment.
  // Correction: shift x left by half the total extra spacing.
  const textCentered = (text: string, x: number, y: number, cs: number) => {
    doc.setCharSpace(cs)
    const extra = (text.length - 1) * cs
    doc.text(text, x - extra / 2, y, { align: 'center' })
    doc.setCharSpace(0)
  }

  // Use PHP prefix to avoid ₱ encoding issue in standard PDF fonts
  const fmtAmount = (n: number) =>
    'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const issueDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })

  // ── Background: deep navy fill, then cream inset ───────────────────────────
  const NAVY   = [10, 22, 60]   as [number,number,number]
  const GOLD   = [193, 154, 64] as [number,number,number]
  const GOLD_L = [235, 205, 130] as [number,number,number]
  const CREAM  = [255, 252, 240] as [number,number,number]
  const DARK   = [20, 20, 50]   as [number,number,number]

  // Navy outer frame (full bleed, then cream inset)
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, H, 'F')

  doc.setFillColor(...CREAM)
  doc.rect(7, 7, W - 14, H - 14, 'F')

  // ── Gold border lines ──────────────────────────────────────────────────────
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(1.2)
  doc.rect(10, 10, W - 20, H - 20, 'S')
  doc.setLineWidth(0.4)
  doc.rect(12.5, 12.5, W - 25, H - 25, 'S')

  // ── Corner ornaments (L-shapes in gold) ───────────────────────────────────
  const corners = [
    { x: 10, y: 10, dx: 1, dy: 1 },   // top-left
    { x: W-10, y: 10, dx: -1, dy: 1 }, // top-right
    { x: 10, y: H-10, dx: 1, dy: -1 }, // bottom-left
    { x: W-10, y: H-10, dx: -1, dy: -1 }, // bottom-right
  ]
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(1.5)
  corners.forEach(({ x, y, dx, dy }) => {
    doc.line(x, y, x + dx * 14, y)
    doc.line(x, y, x, y + dy * 14)
  })

  // ── Top decorative band ────────────────────────────────────────────────────
  // Thin gold rule lines bracketing the header text
  const bandTop = 18
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.6)
  doc.line(22, bandTop, W - 22, bandTop)

  // Coop name
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GOLD)
  textCentered(coopName.toUpperCase(), cx, bandTop + 7, 3)

  doc.setLineWidth(0.3)
  doc.line(22, bandTop + 10, W - 22, bandTop + 10)

  // Certificate title
  doc.setFontSize(17)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...NAVY)
  textCentered('CERTIFICATE OF EQUITY MEMBERSHIP', cx, bandTop + 21, 2)

  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.6)
  doc.line(22, bandTop + 25, W - 22, bandTop + 25)

  // ── Subtle watermark seal (circle) ─────────────────────────────────────────
  doc.setDrawColor(...GOLD_L)
  doc.setLineWidth(0.3)
  doc.circle(cx, H / 2 + 12, 38, 'S')
  doc.circle(cx, H / 2 + 12, 35, 'S')

  // ── Body text ─────────────────────────────────────────────────────────────
  const bodyStart = bandTop + 36

  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(100, 90, 70)
  doc.text('This is to certify that', cx, bodyStart, { align: 'center' })

  // Member name
  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text(memberName.toUpperCase(), cx, bodyStart + 14, { align: 'center' })

  // Gold underline beneath name
  const nw = doc.getTextWidth(memberName.toUpperCase())
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.8)
  doc.line(cx - nw / 2, bodyStart + 17, cx + nw / 2, bodyStart + 17)

  // Employee ID
  if (employeeId) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 100, 60)
    doc.text(`Employee ID: ${employeeId}`, cx, bodyStart + 24, { align: 'center' })
  }

  const afterName = bodyStart + (employeeId ? 31 : 25)

  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 50, 40)
  doc.text(
    'is a duly recognized equity member of this cooperative, having fulfilled',
    cx, afterName, { align: 'center' }
  )
  doc.text('all membership requirements as evidenced by the following:', cx, afterName + 6, { align: 'center' })

  // ── Stats: elegant two-column, no boxes ───────────────────────────────────
  const statsY = afterName + 20
  const col1 = cx - 52
  const col2 = cx + 52

  // Gold diamond divider helper
  const diamond = (x: number, y: number) => {
    doc.setFillColor(...GOLD)
    doc.rect(x - 2, y - 2, 4, 4, 'F') // rotated via small square approximation
  }

  // Col 1: Completed Shares
  doc.setFontSize(36)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GOLD)
  doc.text(String(completedShares), col1, statsY + 8, { align: 'center' })

  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...NAVY)
  textCentered('COMPLETED SHARES', col1, statsY + 15, 1.5)

  // Vertical divider
  doc.setDrawColor(...GOLD_L)
  doc.setLineWidth(0.5)
  doc.line(cx, statsY - 4, cx, statsY + 17)
  diamond(cx, statsY + 6)

  // Col 2: Total Invested
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GOLD)
  doc.text(fmtAmount(totalInvested), col2, statsY + 6, { align: 'center' })

  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...NAVY)
  textCentered('TOTAL INVESTED', col2, statsY + 15, 1.5)

  // ── Decorative rule before footer ─────────────────────────────────────────
  const footerY = H - 30
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.4)
  doc.line(30, footerY, cx - 15, footerY)
  doc.line(cx + 15, footerY, W - 30, footerY)
  // Small diamond center
  doc.setFillColor(...GOLD)
  doc.rect(cx - 3, footerY - 3, 6, 6, 'F')

  // ── Signature lines ────────────────────────────────────────────────────────
  const sig1x = cx - 55
  const sig2x = cx + 55
  const sigY  = footerY + 10
  doc.setDrawColor(150, 130, 80)
  doc.setLineWidth(0.3)
  doc.line(sig1x - 28, sigY, sig1x + 28, sigY)
  doc.line(sig2x - 28, sigY, sig2x + 28, sigY)

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 100, 60)
  doc.text('Authorized Signatory', sig1x, sigY + 4.5, { align: 'center' })
  doc.text('Cooperative Secretary', sig2x, sigY + 4.5, { align: 'center' })

  // ── Footer meta ───────────────────────────────────────────────────────────
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(140, 115, 65)
  doc.text(
    `Member since ${memberSince}   |   Issued on ${issueDate}`,
    cx, H - 12, { align: 'center' }
  )

  doc.save(`membership-certificate-${memberName.replace(/\s+/g, '-').toLowerCase()}.pdf`)
}
