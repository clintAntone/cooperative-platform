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

  // Verify the caller's identity and admin role
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

  if (callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json()
  const { full_name, first_name, middle_name, last_name, email, phone, password } = body

  if (!full_name || !email || !password) {
    return new Response(JSON.stringify({ error: 'full_name, email, and password are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Generate next member ID (MBR-0001, MBR-0002, …)
  const { data: lastMember } = await adminClient
    .from('profiles')
    .select('employee_id')
    .like('employee_id', 'MBR-%')
    .order('employee_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  let nextNum = 1
  if (lastMember?.employee_id) {
    const parsed = parseInt(lastMember.employee_id.replace('MBR-', ''), 10)
    if (!isNaN(parsed)) nextNum = parsed + 1
  }
  const memberId = `MBR-${String(nextNum).padStart(4, '0')}`

  // Create the auth user — the handle_new_user trigger will create the profile automatically
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name,
      first_name: first_name ?? null,
      middle_name: middle_name ?? null,
      last_name: last_name ?? null,
      phone: phone ?? null,
      employee_id: memberId,
    },
  })

  if (createError) {
    return new Response(JSON.stringify({ error: createError.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ id: newUser.user?.id, member_id: memberId }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
