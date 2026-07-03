import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const POS_API_URL = 'https://pos.hilotcenter.cloud/api/employees'
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
    const res = await fetch(POS_API_URL, {
      headers: { 'x-api-key': POS_API_KEY },
    })

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch from POS API' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
