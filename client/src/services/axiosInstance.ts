import axios from 'axios'

const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
})

// Request interceptor — attach auth token if present
axiosInstance.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  error => Promise.reject(error)
)

// Response interceptor — normalise errors
axiosInstance.interceptors.response.use(
  response => response,
  error => {
    const message = error.response?.data?.error ?? error.message ?? 'Unexpected error'
    return Promise.reject(new Error(message))
  }
)

export default axiosInstance
