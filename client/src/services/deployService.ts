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
    else onLog(e.data)
  }
  es.onerror = () => { onLog('ERROR: connection lost'); es.close(); onDone() }
  return es
}
