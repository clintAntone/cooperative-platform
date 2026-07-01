import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': '/src',
      },
    },

    server: {
      proxy: {
        '/api/pos': {
          target: 'https://pos.hilotcenter.cloud',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api\/pos/, '/api'),
          headers: {
            'x-api-key': env.VITE_EMPLOYEE_API_KEY,
          },
        },
      },
    },
  }
})
