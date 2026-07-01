import React from 'react'

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function Header({ title, subtitle, actions }: HeaderProps) {

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4">
      <div className={`flex gap-2 ${actions ? 'flex-col sm:flex-row sm:items-center sm:justify-between' : ''}`}>
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs sm:text-sm text-gray-500 truncate">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">{actions}</div>
        )}
      </div>
    </header>
  )
}
