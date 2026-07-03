import React, { createContext, useContext, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { toast } from '../lib/toast'

export interface ImpersonatedUser {
  id: string
  full_name: string
  role: string
}

interface ImpersonationContextType {
  impersonatedUser: ImpersonatedUser | null
  isImpersonating: boolean
  startImpersonation: (member: ImpersonatedUser) => Promise<void>
  stopImpersonation: () => Promise<void>
}

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined)

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()
  const [impersonatedUser, setImpersonatedUser] = useState<ImpersonatedUser | null>(null)

  const startImpersonation = useCallback(async (member: ImpersonatedUser) => {
    if (profile?.role !== 'admin') return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('log_admin_action', {
        p_action: 'impersonation_start',
        p_target_user_id: member.id,
        p_metadata: { member_name: member.full_name },
      })
    } catch {
      // Non-blocking — log failure shouldn't prevent impersonation
    }

    setImpersonatedUser(member)
    toast({ title: `Viewing as ${member.full_name}`, description: 'Read-only member view', variant: 'info' })
  }, [profile?.role])

  const stopImpersonation = useCallback(async () => {
    if (!impersonatedUser) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('log_admin_action', {
        p_action: 'impersonation_end',
        p_target_user_id: impersonatedUser.id,
        p_metadata: { member_name: impersonatedUser.full_name },
      })
    } catch {
      // Non-blocking
    }

    setImpersonatedUser(null)
    toast({ title: 'Returned to admin view', variant: 'success' })
  }, [impersonatedUser])

  return (
    <ImpersonationContext.Provider value={{
      impersonatedUser,
      isImpersonating: impersonatedUser !== null,
      startImpersonation,
      stopImpersonation,
    }}>
      {children}
    </ImpersonationContext.Provider>
  )
}

export function useImpersonation() {
  const context = useContext(ImpersonationContext)
  if (!context) throw new Error('useImpersonation must be used within ImpersonationProvider')
  return context
}

/** Returns the user ID that data queries should target.
 *  When an admin is impersonating a member this returns the member's ID;
 *  otherwise it returns the real logged-in user's ID. */
export function useEffectiveUserId() {
  const { user } = useAuth()
  const { impersonatedUser } = useImpersonation()
  return impersonatedUser?.id ?? user?.id
}
