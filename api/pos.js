// Vercel serverless function — proxies requests to the POS API
// keeping the API key server-side and out of the browser bundle.
export default async function handler(req, res) {
  const path = req.url.replace(/^\/api\/pos/, '') || '/'

  const target = `https://pos.hilotcenter.cloud/api${path}`

  const headers = {
    'x-api-key': process.env.VITE_EMPLOYEE_API_KEY,
    'Content-Type': 'application/json',
  }

  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD'
        ? JSON.stringify(req.body)
        : undefined,
    })

    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach POS API' })
  }
}
