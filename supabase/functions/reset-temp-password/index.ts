import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify caller is admin or staff
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (!callerProfile || !['admin', 'staff'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403, headers: corsHeaders })
    }

    const { profile_id } = await req.json()
    if (!profile_id) return new Response(JSON.stringify({ error: 'profile_id is required' }), { status: 400, headers: corsHeaders })

    // Only allow reset if employee hasn't completed onboarding yet
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, employee_id, requires_onboarding')
      .eq('id', profile_id)
      .single()

    if (!profile) return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: corsHeaders })
    if (!profile.requires_onboarding) {
      return new Response(JSON.stringify({ error: 'Cannot reset password — employee has already completed setup' }), { status: 400, headers: corsHeaders })
    }

    // Generate new password
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
    const password = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile_id, { password })
    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ password, employee_id: profile.employee_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
