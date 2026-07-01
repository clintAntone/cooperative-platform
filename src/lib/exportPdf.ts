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
