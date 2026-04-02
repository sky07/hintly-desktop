import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: string
  email: string
  name: string
  subscription_tier: 'free' | 'pro'
  created_at: string
}

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  error: string | null

  setAuth: (user: User, token: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,

      setAuth: (user, token) => set({ user, token, error: null }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      logout: () => set({ user: null, token: null, error: null }),
    }),
    {
      name: 'ia-desktop-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
    }
  )
)
