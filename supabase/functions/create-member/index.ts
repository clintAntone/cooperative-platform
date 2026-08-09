import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  // Verify caller is admin or staff
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userError } = await callerClient.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!['admin', 'staff'].includes(callerProfile?.role ?? '')) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin or staff role required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json()
  const { first_name, middle_name, last_name, email, password, provided_employee_id, phone, date_of_birth } = body

  // provided_employee_id = POS employee ID; triggers temp-credentials mode
  const isTempCredentials = !!provided_employee_id

  if (!first_name || !last_name || !password) {
    return new Response(JSON.stringify({ error: 'first_name, last_name, and password are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!isTempCredentials && !email) {
    return new Response(JSON.stringify({ error: 'email is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let authEmail: string
  let employeeId: string

  if (isTempCredentials) {
    employeeId = provided_employee_id as string

    // Check this employee_id doesn't already have an account
    const { data: existing } = await adminClient
      .from('profiles')
      .select('id')
      .eq('employee_id', employeeId)
      .maybeSingle()

    if (existing) {
      return new Response(JSON.stringify({ error: 'An account already exists for this employee.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    authEmail = `${employeeId.toLowerCase()}@onboarding.temp`
  } else {
    // Standard flow: check email availability via profiles-based RPC, then generate MEM-XXXX
    const { data: emailAvailable } = await adminClient.rpc('is_email_available', { p_email: email.toLowerCase().trim() })
    if (emailAvailable === false) {
      return new Response(JSON.stringify({ error: 'This email address is already registered.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: lastMember } = await adminClient
      .from('profiles')
      .select('employee_id')
      .like('employee_id', 'MEM-%')
      .order('employee_id', { ascending: false })
      .limit(1)
      .maybeSingle()

    let nextNum = 1
    if (lastMember?.employee_id) {
      const parsed = parseInt(lastMember.employee_id.replace('MEM-', ''), 10)
      if (!isNaN(parsed)) nextNum = parsed + 1
    }
    employeeId = `MEM-${String(nextNum).padStart(4, '0')}`
    authEmail = email.toLowerCase().trim()
  }

  const full_name = [first_name, middle_name, last_name].filter(Boolean).join(' ')

  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name,
      first_name,
      middle_name: middle_name ?? null,
      last_name,
      employee_id: employeeId,
      phone: phone ?? null,
    },
  })

  if (createError) {
    return new Response(JSON.stringify({ error: createError.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Store date_of_birth if provided (not in trigger metadata, update directly)
  if (date_of_birth && newUser.user?.id) {
    await adminClient
      .from('profiles')
      .update({ date_of_birth })
      .eq('id', newUser.user.id)
  }

  // For temp credentials mode, mark profile as requiring onboarding.
  // The handle_new_user trigger fires synchronously, but we retry briefly
  // in case of any replication lag on self-hosted Supabase.
  if (isTempCredentials && newUser.user?.id) {
    const userId = newUser.user.id
    let marked = false
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 300))
      const { error: updateErr } = await adminClient
        .from('profiles')
        .update({ requires_onboarding: true })
        .eq('id', userId)
      if (!updateErr) { marked = true; break }
    }
    if (!marked) {
      console.error(`Failed to set requires_onboarding for user ${userId} after 5 attempts`)
    }
  }

  return new Response(
    JSON.stringify({ id: newUser.user?.id, member_id: employeeId, full_name }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
