import axios from 'axios'

import type {
  GeocodeResponse,
  HealthStatusResponse,
  LocationPoint,
  RoutePlanRequest,
  RoutePlanResponse,
} from '../interfaces'

const API_BASE_URL = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  'http://127.0.0.1:8000/api'
).replace(/\/+$/, '')

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45_000,
  headers: {
    'Content-Type': 'application/json',
  },
})

export function extractApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, unknown> | undefined
    if (data) {
      if (typeof data.error === 'string' && data.error.trim()) {
        return data.error
      }
      if (typeof data.detail === 'string' && data.detail.trim()) {
        return data.detail
      }
      for (const [field, messages] of Object.entries(data)) {
        if (Array.isArray(messages) && messages.length > 0) {
          return `${field}: ${String(messages[0])}`
        }
        if (typeof messages === 'string') {
          return `${field}: ${messages}`
        }
      }
    }
    if (error.code === 'ERR_NETWORK') {
      return `Cannot reach backend API at ${API_BASE_URL}. Make sure Django runserver is running.`
    }
    return error.message || 'Request to backend API failed.'
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred.'
}

export async function fetchBackendHealth(): Promise<HealthStatusResponse> {
  const response = await apiClient.get<HealthStatusResponse>('/health/')
  return response.data
}

export async function fetchGeocodeSuggestions(
  query: string,
  signal?: AbortSignal,
  limit = 5,
): Promise<LocationPoint[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) {
    return []
  }
  const response = await apiClient.get<GeocodeResponse>('/geocode/', {
    params: { q: trimmed, limit },
    signal,
  })
  return response.data.results ?? []
}

export async function planWeatherAwareRoutes(
  payload: RoutePlanRequest,
  signal?: AbortSignal,
): Promise<RoutePlanResponse> {
  const response = await apiClient.post<RoutePlanResponse>('/routes/plan/', payload, {
    signal,
  })
  return response.data
}

