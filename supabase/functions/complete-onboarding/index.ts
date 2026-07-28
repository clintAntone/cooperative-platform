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
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  // Identify caller
  const { data: { user }, error: userError } = await callerClient.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Confirm this account actually requires onboarding (prevents misuse)
  const { data: profile } = await adminClient
    .from('profiles')
    .select('requires_onboarding')
    .eq('id', user.id)
    .single()

  if (!profile?.requires_onboarding) {
    return new Response(JSON.stringify({ error: 'Account does not require onboarding' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json()
  const { new_email, new_password } = body

  if (!new_email || !new_password) {
    return new Response(JSON.stringify({ error: 'new_email and new_password are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const normalizedEmail = new_email.toLowerCase().trim()

  // Check email uniqueness using the is_email_available RPC (avoids listUsers pagination limits)
  const { data: emailAvailable } = await adminClient.rpc('is_email_available', { p_email: normalizedEmail })
  if (emailAvailable === false) {
    return new Response(JSON.stringify({ error: 'This email address is already registered.' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Update auth user — service role skips email confirmation flow
  const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
    email: normalizedEmail,
    password: new_password,
    email_confirm: true,
  })

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Clear the onboarding flag
  const { error: profileErr } = await adminClient
    .from('profiles')
    .update({ requires_onboarding: false })
    .eq('id', user.id)

  if (profileErr) {
    // Auth is already updated; log and continue — the flag check on next login
    // will still pass since the email change succeeded.
    console.error('Failed to clear requires_onboarding flag:', profileErr.message)
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
