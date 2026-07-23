import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useImpersonation } from '../../context/ImpersonationContext'
import { usePendingCoMakerCount } from '../../hooks/useLoans'
import { useAppBranding } from '../../hooks/useAppBranding'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'

const PINNED_KEY = 'sidebar_pinned_items'

function loadPinned(): string[] {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') } catch { return [] }
}
function savePinned(paths: string[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(paths))
}

export function usePendingSavingsDepositCount() {
  return useQuery({
    queryKey: ['pending_savings_deposit_count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('savings_deposit_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
      return count ?? 0
    },
    staleTime: 30_000,
  })
}

export function usePendingMemberDepositCount() {
  return useQuery({
    queryKey: ['pending_member_deposit_count'],
    queryFn: async () => {
      const [{ count: sharesCount }, { count: savingsCount }] = await Promise.all([
        supabase.from('equity_deposit_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('savings_deposit_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      return (sharesCount ?? 0) + (savingsCount ?? 0)
    },
    staleTime: 30_000,
  })
}

export function usePendingLoanApplicationCount() {
  return useQuery({
    queryKey: ['pending_loan_application_count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('loan_applications')
        .select('*', { count: 'exact', head: true })
        .in('status', ['submitted', 'under_review'])
      return count ?? 0
    },
    staleTime: 30_000,
  })
}

interface NavItem {
  path: string
  label: string
  icon: React.ReactNode
  roles?: string[]
  end?: boolean
}

interface NavGroup {
  label: string
  roles?: string[]
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  // Member nav — simplified
  {
    label: 'My Accounts',
    roles: ['member'],
    items: [
      {
        path: '/dashboard',
        label: 'Home',
        end: true,
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
      {
        path: '/loans',
        label: 'Loans',
        end: true,
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Help',
    roles: ['member'],
    items: [
      {
        path: '/faq',
        label: 'FAQ',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
    ],
  },

  // Board of Directors nav
  {
    label: 'Overview',
    roles: ['board'],
    items: [
      {
        path: '/overview',
        label: 'Overview',
        end: true,
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Members & Loans',
    roles: ['board'],
    items: [
      {
        path: '/admin/members',
        label: 'Members',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        path: '/admin/loans',
        label: 'Loan Portfolio',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Help',
    roles: ['board'],
    items: [
      {
        path: '/rules',
        label: 'Rules & Policies',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        ),
      },
    ],
  },

  // Admin/Staff nav
  {
    label: 'Overview',
    roles: ['admin', 'staff'],
    items: [
      {
        path: '/overview',
        label: 'Overview',
        end: true,
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Members',
    roles: ['admin', 'staff'],
    items: [
      {
        path: '/admin/members',
        label: 'All Members',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Deposits',
    roles: ['admin', 'staff'],
    items: [
      {
        path: '/staff/post-deposits',
        label: 'Post Deposits',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Member Accounts',
    roles: ['admin', 'staff'],
    items: [
      {
        path: '/admin/deposit-requests',
        label: 'Deposit Requests',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        path: '/admin/share-transfers',
        label: 'Share Transfers',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        ),
      },
      {
        path: '/admin/savings-withdrawals',
        label: 'Savings Withdrawals',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Loans',
    roles: ['admin', 'staff'],
    items: [
      {
        path: '/admin/loans',
        label: 'Applications',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        path: '/admin/loan-products',
        label: 'Loan Products',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Cooperative',
    roles: ['admin', 'staff'],
    items: [
      {
        path: '/admin/dividends',
        label: 'Dividends',
        roles: ['admin'],
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        path: '/admin/rebates',
        label: 'Rebates',
        roles: ['admin'],
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        path: '/admin/damayan',
        label: 'Damayan',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        ),
      },
      {
        path: '/admin/branches',
        label: 'Branches',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Data',
    roles: ['admin'],
    items: [
      {
        path: '/admin/bulk-import',
        label: 'Bulk Import',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Settings',
    roles: ['admin'],
    items: [
      {
        path: '/admin/settings',
        label: 'App Settings',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        ),
      },
      {
        path: '/admin/config',
        label: 'System Config',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        path: '/admin/permissions',
        label: 'Permissions',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        ),
      },
      {
        path: '/admin/roles',
        label: 'Custom Roles',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Help',
    roles: ['admin', 'staff'],
    items: [
      {
        path: '/rules',
        label: 'Rules & Policies',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        ),
      },
      {
        path: '/faq',
        label: 'FAQ',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
    ],
  },
]

// ─── Nav item row with pin support ───────────────────────────────────────────

interface NavItemRowProps {
  item: NavItem
  isPinned: boolean
  onTogglePin: () => void
  pendingCoMakerCount: number
  pendingMemberDepositCount: number
  pendingLoanCount: number
}

function NavItemRow({ item, isPinned, onTogglePin, pendingCoMakerCount, pendingMemberDepositCount, pendingLoanCount }: NavItemRowProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NavLink
        to={item.path}
        end={item.end}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors pr-8',
            isActive
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-700 hover:text-white'
          )
        }
      >
        {item.icon}
        <span className="flex-1 truncate">{item.label}</span>
        {item.path === '/lending' && pendingCoMakerCount > 0 && (
          <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
            {pendingCoMakerCount}
          </span>
        )}

        {item.path === '/admin/deposit-requests' && pendingMemberDepositCount > 0 && (
          <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-yellow-400 text-gray-900 text-[10px] font-bold">
            {pendingMemberDepositCount}
          </span>
        )}
        {item.path === '/admin/loans' && pendingLoanCount > 0 && (
          <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
            {pendingLoanCount}
          </span>
        )}
      </NavLink>
      {/* Pin button — visible on hover or when pinned */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin() }}
        title={isPinned ? 'Unpin' : 'Pin to top'}
        className={cn(
          'absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded transition-all',
          hovered || isPinned ? 'opacity-100' : 'opacity-0',
          isPinned ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-500 hover:text-yellow-400'
        )}
      >
        <svg className="w-3.5 h-3.5" fill={isPinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      </button>
    </div>
  )
}

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  onSearchOpen?: () => void
}

export function Sidebar({ isOpen, onClose, onSearchOpen }: SidebarProps) {
  const { profile, signOut } = useAuth()
  const { impersonatedUser } = useImpersonation()
  const { data: branding } = useAppBranding()
  const { data: pendingCoMakerCount = 0 } = usePendingCoMakerCount()
  const { data: pendingMemberDepositCount = 0 } = usePendingMemberDepositCount()
  const { data: pendingLoanCount = 0 } = usePendingLoanApplicationCount()
  const [confirmSignOut, setConfirmSignOut] = React.useState(false)
  const location = useLocation()

  // When impersonating, show the nav for the impersonated user's role
  const effectiveRole = impersonatedUser?.role ?? profile?.role

  const visibleGroups = navGroups
    .filter(group => {
      if (!group.roles) return true
      return effectiveRole && group.roles.includes(effectiveRole)
    })
    .filter(group => group.items.length > 0)

  // Collapsed state per group label, persisted in localStorage
  const storageKey = 'sidebar_collapsed_groups'
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') }
    catch { return {} }
  })

  // Pinned items (paths), persisted in localStorage
  const [pinnedPaths, setPinnedPaths] = useState<string[]>(loadPinned)

  const togglePin = useCallback((path: string) => {
    setPinnedPaths(prev => {
      const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
      savePinned(next)
      return next
    })
  }, [])

  // All items across visible groups (for resolving pinned items)
  const allVisibleItems = visibleGroups.flatMap(g => g.items)

  // Auto-expand the group containing the active route
  useEffect(() => {
    const activeGroup = visibleGroups.find(g =>
      g.items.some(item => location.pathname === item.path || location.pathname.startsWith(item.path + '/'))
    )
    if (activeGroup && collapsed[activeGroup.label]) {
      setCollapsed(prev => ({ ...prev, [activeGroup.label]: false }))
    }
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = useCallback((label: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [label]: !prev[label] }
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }, [])

  return (
    <aside className={`flex flex-col w-64 bg-gray-900 text-white overflow-y-auto
  fixed inset-y-0 left-0 z-40 transition-transform duration-300 ease-in-out
  ${isOpen ? 'translate-x-0' : '-translate-x-full'}
  lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:flex-shrink-0`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-700">
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          )}
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-none">{branding?.name ?? 'CoopFinance'}</p>
          <p className="text-xs text-gray-400 mt-0.5">Platform</p>
        </div>
        <button
          onClick={onClose}
          className="lg:hidden ml-auto p-1 text-gray-400 hover:text-white rounded-md"
          aria-label="Close menu"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Search — admin/staff only, desktop */}
      {onSearchOpen && (
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={onSearchOpen}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors text-sm"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="flex-1 text-left">Search…</span>
            <kbd className="text-xs bg-gray-700 px-1.5 py-0.5 rounded text-gray-400">⌘K</kbd>
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {/* Pinned items */}
        {pinnedPaths.filter(p => allVisibleItems.some(i => i.path === p)).length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-yellow-400 flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z" />
              </svg>
              Pinned
            </div>
            <div className="mt-0.5 mb-2 space-y-0.5">
              {pinnedPaths
                .map(p => allVisibleItems.find(i => i.path === p))
                .filter((item): item is NavItem => !!item)
                .map(item => (
                  <NavItemRow
                    key={`pinned-${item.path}`}
                    item={item}
                    isPinned
                    onTogglePin={() => togglePin(item.path)}
                    pendingCoMakerCount={pendingCoMakerCount}
                    pendingMemberDepositCount={pendingMemberDepositCount}
                    pendingLoanCount={pendingLoanCount}
                  />
                ))}
            </div>
            <div className="border-t border-gray-700/50 mb-2" />
          </div>
        )}

        {/* Regular groups */}
        {visibleGroups.map(group => {
          const isCollapsed = !!collapsed[group.label]
          const hasActive = group.items.some(item =>
            location.pathname === item.path || location.pathname.startsWith(item.path + '/')
          )
          return (
            <div key={group.label}>
              <button
                onClick={() => toggleGroup(group.label)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors',
                  hasActive && isCollapsed
                    ? 'text-blue-400 hover:text-blue-300'
                    : 'text-gray-500 hover:text-gray-300'
                )}
              >
                <span>{group.label}</span>
                <svg
                  className={cn('w-3 h-3 transition-transform duration-200', isCollapsed ? '-rotate-90' : '')}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {!isCollapsed && (
                <div className="mt-0.5 mb-2 space-y-0.5">
                  {group.items
                    .filter(item => !item.roles || !effectiveRole || item.roles.includes(effectiveRole))
                    .map(item => (
                      <NavItemRow
                        key={item.path}
                        item={item}
                        isPinned={pinnedPaths.includes(item.path)}
                        onTogglePin={() => togglePin(item.path)}
                        pendingCoMakerCount={pendingCoMakerCount}
                            pendingMemberDepositCount={pendingMemberDepositCount}
                        pendingLoanCount={pendingLoanCount}
                      />
                    ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* User info and sign out */}
      <div className="px-4 py-4 border-t border-gray-700">
        {profile && (
          <NavLink
            to="/profile"
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'mb-3 flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors',
                isActive ? 'bg-gray-700' : 'hover:bg-gray-700'
              )
            }
          >
            <div className="w-9 h-9 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.full_name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300 text-sm font-semibold">
                  {profile.full_name?.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{profile.full_name}</p>
              <p className="text-xs text-gray-400 capitalize">{profile.role}</p>
            </div>
            <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </NavLink>
        )}
        <div className="border-t border-gray-700 mb-2" />
        <button
          onClick={() => setConfirmSignOut(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign Out
        </button>
      </div>

      {/* Sign out confirmation — rendered via portal so the backdrop covers the full viewport */}
      {confirmSignOut && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Sign out?</h3>
            <p className="text-sm text-gray-500 mb-5">You will be returned to the login page.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmSignOut(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={signOut}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </aside>
  )
}
