import { useCallback } from 'react'
import { useAuthStore } from '../stores/authStore'

const API_BASE =
  (typeof process !== 'undefined' && process.env?.REACT_APP_API_URL) ||
  'https://interviewassistantbackend-production.up.railway.app'

interface AuthResponse {
  access_token: string
  token_type: string
  user: {
    id: string
    email: string
    name: string
    subscription_tier: 'free' | 'pro'
    created_at: string
  }
}

export function useAuth() {
  const { user, token, isLoading, error, setAuth, setLoading, setError, logout } =
    useAuthStore()

  const login = useCallback(
    async (email: string, password: string) => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'Login failed')
        }

        const data: AuthResponse = await response.json()
        setAuth(data.user, data.access_token)
        return data
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [setAuth, setLoading, setError]
  )

  const fetchWithAuth = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers)
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }

      const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers,
      })

      if (response.status === 401) {
        if (token) logout()
        throw new Error('Session expired')
      }

      return response
    },
    [token, logout]
  )

  return {
    user,
    token,
    isLoading,
    error,
    isAuthenticated: !!token && !!user,
    login,
    logout,
    fetchWithAuth,
  }
}
