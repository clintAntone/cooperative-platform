import { useState } from 'react'
import { Header } from '../components/layout/Header'
import { faqSections, AccordionItem } from '../lib/faqData'

export function FaqPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)

  return (
    <div>
      <Header
        title="Help & FAQ"
        subtitle="Answers to common questions and step-by-step instructions"
      />

      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-8">
        {/* Quick nav */}
        <div className="flex flex-wrap gap-2">
          {faqSections.map(section => (
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
        {faqSections.map(section => (
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
