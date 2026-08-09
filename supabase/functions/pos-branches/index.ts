import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const POS_API_URL = 'https://pos.hilotcenter.cloud/api/coop-branches'
const POS_API_KEY = Deno.env.get('EMPLOYEE_API_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Fetch branches from POS
    const res = await fetch(POS_API_URL, {
      headers: { 'x-api-key': POS_API_KEY },
    })

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch from POS API', status: res.status }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const posBranches = await res.json() as { id: string; name: string; address: string | null; contact_number: string | null; manager: string }[]

    // Upsert into branches table using service role
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    for (const branch of posBranches) {
      await adminClient
        .from('branches')
        .upsert(
          {
            pos_branch_id: branch.id,
            name: branch.name,
            location: branch.address ?? null,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'pos_branch_id', ignoreDuplicates: false }
        )
    }

    // Return the synced branches from our DB (with full coop fields)
    const { data: branches, error } = await adminClient
      .from('branches')
      .select('id, name, location, is_active, report_cutoff_day, pos_branch_id, created_at, updated_at')
      .order('name', { ascending: true })

    if (error) throw error

    return new Response(JSON.stringify(branches), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
