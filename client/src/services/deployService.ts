import axiosInstance from './axiosInstance'

export interface DeployPayload {
  name: string
  email: string
  repoUrl: string
}

export interface Deployment extends DeployPayload {
  _id: string
  status: 'queued' | 'building' | 'live' | 'failed'
  createdAt: string
  updatedAt: string
}

export const submitDeployment = (payload: DeployPayload) =>
  axiosInstance.post<{ message: string; deployment: Deployment }>('/deploy', payload)

export const fetchDeployments = () =>
  axiosInstance.get<Deployment[]>('/deploy')

export const streamCloneLogs = (id: string, onLog: (msg: string) => void, onDone: () => void) => {
  const base = import.meta.env.VITE_API_BASE_URL
  const es = new EventSource(`${base}/deploy/${id}/clone`)

  es.onmessage = (e) => {
    if (e.data === '__DONE__') { es.close(); onDone() }
    else if (e.data === '__PING__') { /* heartbeat — ignore */ }
    else onLog(e.data)
  }

  es.onerror = (e) => {
    // Only treat as fatal if the connection was cleanly closed by server
    // readyState 2 = CLOSED (server ended it), anything else is a transient error
    if (es.readyState === EventSource.CLOSED) {
      onLog('❌ Connection to server lost')
      es.close()
      onDone()
    } else {
      console.warn('[SSE] transient error, EventSource will auto-reconnect', e)
    }
  }

  return es
}
