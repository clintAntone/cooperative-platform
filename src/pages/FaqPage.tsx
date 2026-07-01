import { useState } from 'react'
import { Header } from '../components/layout/Header'

interface FaqItem {
  question: string
  answer: React.ReactNode
}

interface FaqSection {
  title: string
  icon: React.ReactNode
  items: FaqItem[]
}

const sections: FaqSection[] = [
  {
    title: 'Getting Started',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    items: [
      {
        question: 'How do I register as a member?',
        answer: (
          <div className="space-y-2">
            <p>To register, click <strong>Register</strong> on the login page and fill in your details — full name, email address, and employee ID. Your account will be submitted for admin review.</p>
            <p>Once approved by an administrator, you will be able to log in and begin contributing to your equity shares.</p>
          </div>
        ),
      },
      {
        question: 'What happens after I register?',
        answer: (
          <p>Your registration is set to <strong>pending</strong> until an administrator reviews and approves it. You will not be able to access the platform until your account is activated. Contact your cooperative administrator if you have been waiting for an extended period.</p>
        ),
      },
      {
        question: 'What is my membership status?',
        answer: (
          <div className="space-y-2">
            <p>Your membership can be in one of the following states:</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li><strong>Pending</strong> — waiting for admin approval</li>
              <li><strong>Active</strong> — you have at least one completed equity share and are in good standing</li>
              <li><strong>Inactive</strong> — your account exists but you have no completed shares yet</li>
              <li><strong>Suspended</strong> — your membership has been suspended, usually due to a loan default</li>
            </ul>
            <p>You must be <strong>Active</strong> to apply for loans.</p>
          </div>
        ),
      },
    ],
  },
  {
    title: 'Equity Shares',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    items: [
      {
        question: 'What is an equity share?',
        answer: (
          <p>An equity share represents your ownership stake in the cooperative. Each share has a fixed target amount (e.g., ₱5,000). You build up your share through installment deposits until it is fully paid. Once completed, that share counts toward your loan eligibility.</p>
        ),
      },
      {
        question: 'How do I deposit into my share?',
        answer: (
          <div className="space-y-2">
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Go to the <strong>Equity</strong> page from the sidebar.</li>
              <li>Click <strong>Request Deposit</strong> next to your in-progress share.</li>
              <li>Enter the amount you deposited, select your payment method, and upload your receipt or deposit slip.</li>
              <li>Submit the request. An administrator will review and approve it.</li>
            </ol>
            <p>Your share balance will only be updated after admin approval.</p>
          </div>
        ),
      },
      {
        question: 'What if my deposit amount is more than the remaining balance on my share?',
        answer: (
          <p>No problem — enter the full amount on your receipt. When the admin approves it, the system will automatically complete your current share and apply any excess amount to your next share. If you do not have a next share yet, one will be created automatically for you.</p>
        ),
      },
      {
        question: 'How many shares can I have?',
        answer: (
          <p>The maximum number of shares per member is set by the cooperative administrator. You can check your current share count on the <strong>Equity</strong> page. Once you have reached the limit, you will not be able to open additional shares until the limit is increased by the admin.</p>
        ),
      },
      {
        question: 'When is a share considered "completed"?',
        answer: (
          <p>A share is marked <strong>Completed</strong> automatically once your total approved deposits reach the share's target amount (e.g., ₱5,000). Completed shares count toward your loan eligibility.</p>
        ),
      },
    ],
  },
  {
    title: 'Deposit Requests',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    items: [
      {
        question: 'Why does my deposit need admin approval?',
        answer: (
          <p>The cooperative needs to verify that the payment was actually received before crediting your share. The admin will check your uploaded receipt or deposit slip against the cooperative's bank records before approving.</p>
        ),
      },
      {
        question: 'What should I upload as proof of payment?',
        answer: (
          <div className="space-y-2">
            <p>Upload a clear image (JPG or PNG) or PDF of any of the following:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Bank deposit slip</li>
              <li>Mobile banking transfer screenshot (GCash, Maya, etc.)</li>
              <li>Official receipt issued by the cooperative</li>
            </ul>
            <p>Make sure the amount, date, and reference number are clearly visible.</p>
          </div>
        ),
      },
      {
        question: 'How long does approval take?',
        answer: (
          <p>Approval times depend on your cooperative's administrators. Typically, requests submitted during business hours are reviewed within the same day. If your request has been pending for more than 2 business days, contact your administrator.</p>
        ),
      },
      {
        question: 'Can my deposit request be rejected?',
        answer: (
          <p>Yes. The admin may reject your request if the receipt is unclear, the amount does not match, or the payment cannot be verified. You will see the rejection reason on your deposit history. You can then submit a corrected request.</p>
        ),
      },
    ],
  },
  {
    title: 'Loans',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
    items: [
      {
        question: 'Am I eligible to apply for a loan?',
        answer: (
          <div className="space-y-2">
            <p>To be eligible, you must:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Have <strong>Active</strong> membership status</li>
              <li>Have at least <strong>one completed equity share</strong></li>
              <li>Have <strong>no existing active loan</strong></li>
              <li>Have <strong>no pending loan application</strong></li>
            </ul>
            <p>If any of these conditions are not met, the <em>Apply for Loan</em> button will be disabled and a banner will explain why.</p>
          </div>
        ),
      },
      {
        question: 'How much can I borrow?',
        answer: (
          <div className="space-y-2">
            <p>Your maximum loan amount is based on the number of completed equity shares you have and your length of membership:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li><strong>New members</strong> (less than 12 months): up to 1× the value of your completed shares</li>
              <li><strong>Senior members</strong> (12+ months): up to 3× the value of your completed shares</li>
            </ul>
            <p>For example, with 2 completed shares at ₱5,000 each (₱10,000 total equity), a senior member can borrow up to ₱30,000.</p>
            <p>The exact limits are configured by your administrator and may differ from the above.</p>
          </div>
        ),
      },
      {
        question: 'What is a co-maker / guarantor?',
        answer: (
          <div className="space-y-2">
            <p>A co-maker is a fellow member who guarantees your loan. They are responsible if you fail to repay. To be eligible as a co-maker, the member must:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Be an active member</li>
              <li>Have at least one completed equity share</li>
              <li>Not currently have an active loan</li>
              <li>Not already be guaranteeing another active application</li>
            </ul>
          </div>
        ),
      },
      {
        question: 'What is the loan application process?',
        answer: (
          <div className="space-y-2">
            <ol className="list-decimal list-inside text-sm space-y-1">
              <li>You submit a loan application and select your co-maker(s).</li>
              <li>Your application is saved as a <strong>Draft</strong> while co-makers are notified.</li>
              <li>Each co-maker logs in, goes to <strong>Lending</strong>, and confirms or declines.</li>
              <li>Once <strong>all co-makers confirm</strong>, your application is automatically submitted to the admin.</li>
              <li>The admin reviews, may set it to <strong>Under Review</strong>, then approves or rejects it.</li>
              <li>If approved, your loan is disbursed and a repayment schedule is generated.</li>
            </ol>
          </div>
        ),
      },
      {
        question: 'How is interest calculated?',
        answer: (
          <div className="space-y-2">
            <p>The cooperative supports two interest calculation methods, configured by your administrator:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li><strong>Flat Rate</strong> — interest is calculated on the original principal for every month. Monthly payment = (Principal + Total Interest) ÷ Term.</li>
              <li><strong>Reducing Balance</strong> — interest is calculated only on the remaining outstanding balance each month. Your payment stays the same but more goes to principal over time.</li>
            </ul>
            <p>You will see a loan preview (monthly payment and total repayable) before you submit your application.</p>
          </div>
        ),
      },
      {
        question: 'Can I have more than one active loan?',
        answer: (
          <p>No. Only one active loan is allowed at a time. You must fully repay your current loan before applying for a new one.</p>
        ),
      },
      {
        question: 'What happens if I default on my loan?',
        answer: (
          <p>If your loan is marked as <strong>Defaulted</strong> by the administrator, your membership will be automatically <strong>suspended</strong>. A suspended member cannot apply for new loans or access loan features. Contact your cooperative administrator to resolve the situation.</p>
        ),
      },
    ],
  },
  {
    title: 'Co-maker Instructions',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    items: [
      {
        question: 'Someone added me as their co-maker. What do I do?',
        answer: (
          <div className="space-y-2">
            <p>You will see a red badge on the <strong>Lending</strong> sidebar item indicating pending co-maker requests.</p>
            <ol className="list-decimal list-inside text-sm space-y-1">
              <li>Click <strong>Lending</strong> in the sidebar.</li>
              <li>At the top you will see a <strong>Guarantor Requests</strong> section showing who added you.</li>
              <li>Review the loan details — amount, term, and purpose.</li>
              <li>Click <strong>Confirm</strong> to agree to guarantee the loan, or <strong>Decline</strong> if you cannot.</li>
            </ol>
          </div>
        ),
      },
      {
        question: 'What does confirming as co-maker mean legally?',
        answer: (
          <p>By confirming, you acknowledge that you are a guarantor for the loan. If the borrower fails to repay, you may be held responsible per the cooperative's bylaws. Only confirm if you trust the borrower and are comfortable with the risk.</p>
        ),
      },
      {
        question: 'Can I decline a co-maker request?',
        answer: (
          <p>Yes. Click <strong>Decline</strong> on the request. The borrower will see that you declined and will need to resolve this — either by finding a replacement co-maker or contacting you. You cannot decline after you have already confirmed.</p>
        ),
      },
    ],
  },
  {
    title: 'Account & Profile',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    items: [
      {
        question: 'How do I sign out?',
        answer: (
          <p>Click <strong>Sign Out</strong> at the bottom of the sidebar. You will be asked to confirm before being logged out.</p>
        ),
      },
      {
        question: 'I forgot my password. How do I reset it?',
        answer: (
          <p>On the login page, click <strong>Forgot password?</strong> and enter your registered email address. You will receive a password reset link. If you do not receive the email, check your spam folder or contact your administrator.</p>
        ),
      },
      {
        question: 'How do I contact the administrator?',
        answer: (
          <p>Reach out to your cooperative's designated administrator directly. Their contact details should be provided during your onboarding. If you were not given contact information, speak to your HR department or cooperative office.</p>
        ),
      },
    ],
  },
]

function AccordionItem({ question, answer }: FaqItem) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-medium text-gray-900 pr-4">{question}</span>
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-gray-600 border-t border-gray-100 pt-3 leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  )
}

export function FaqPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)

  return (
    <div>
      <Header
        title="Help & FAQ"
        subtitle="Answers to common questions and step-by-step instructions"
      />

      <div className="p-6 max-w-4xl mx-auto space-y-8">
        {/* Quick nav */}
        <div className="flex flex-wrap gap-2">
          {sections.map(section => (
            <button
              key={section.title}
              onClick={() => {
                setActiveSection(activeSection === section.title ? null : section.title)
                document.getElementById(`faq-${section.title}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-700 transition-colors"
            >
              {section.title}
            </button>
          ))}
        </div>

        {/* Sections */}
        {sections.map(section => (
          <div key={section.title} id={`faq-${section.title}`} className="space-y-3">
            <div className="flex items-center gap-2 text-gray-900">
              <span className="text-blue-600">{section.icon}</span>
              <h2 className="text-base font-semibold">{section.title}</h2>
            </div>
            <div className="space-y-2">
              {section.items.map(item => (
                <AccordionItem key={item.question} {...item} />
              ))}
            </div>
          </div>
        ))}

        {/* Footer note */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <p className="font-medium">Still have questions?</p>
          <p className="mt-0.5 text-blue-700">
            Contact your cooperative administrator for assistance with your account or any transactions not covered here.
          </p>
        </div>
      </div>
    </div>
  )
}
