import React from 'react'
import { cn } from '../../lib/utils'

interface TableProps {
  children: React.ReactNode
  className?: string
}

export function Table({ children, className }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('min-w-full divide-y divide-gray-200', className)}>
        {children}
      </table>
    </div>
  )
}

interface TheadProps {
  children: React.ReactNode
  className?: string
}

export function Thead({ children, className }: TheadProps) {
  return (
    <thead className={cn('bg-gray-50 sticky top-0 z-10', className)}>
      {children}
    </thead>
  )
}

interface ThProps {
  children?: React.ReactNode
  className?: string
}

export function Th({ children, className }: ThProps) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider',
        className
      )}
    >
      {children}
    </th>
  )
}

interface TbodyProps {
  children: React.ReactNode
  className?: string
}

export function Tbody({ children, className }: TbodyProps) {
  return (
    <tbody className={cn('bg-white divide-y divide-gray-200', className)}>
      {children}
    </tbody>
  )
}

interface TrProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export function Tr({ children, className, onClick }: TrProps) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'even:bg-gray-50/40',
        onClick && 'cursor-pointer hover:bg-gray-100',
        className
      )}
    >
      {children}
    </tr>
  )
}

interface TdProps {
  children: React.ReactNode
  className?: string
}

export function Td({ children, className }: TdProps) {
  return (
    <td className={cn('px-4 py-3 text-sm text-gray-700 whitespace-nowrap', className)}>
      {children}
    </td>
  )
}
