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
  const { first_name, middle_name, last_name, email, password } = body

  if (!first_name || !last_name || !email || !password) {
    return new Response(JSON.stringify({ error: 'first_name, last_name, email, and password are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Check email availability
  const { data: existingUsers } = await adminClient.auth.admin.listUsers()
  const emailTaken = existingUsers?.users?.some(u => u.email?.toLowerCase() === email.toLowerCase().trim())
  if (emailTaken) {
    return new Response(JSON.stringify({ error: 'This email address is already registered.' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Generate next MEM-XXXX employee ID
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
  const memberId = `MEM-${String(nextNum).padStart(4, '0')}`

  // Build full_name from parts
  const full_name = [first_name, middle_name, last_name].filter(Boolean).join(' ')

  // Create auth user — handle_new_user trigger will create the profile
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email: email.toLowerCase().trim(),
    password,
    email_confirm: true,
    user_metadata: {
      full_name,
      first_name,
      middle_name: middle_name ?? null,
      last_name,
      employee_id: memberId,
    },
  })

  if (createError) {
    return new Response(JSON.stringify({ error: createError.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({ id: newUser.user?.id, member_id: memberId, full_name }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
