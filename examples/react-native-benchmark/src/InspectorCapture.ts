export interface CapturedResponse {
  url: string
  responseBody?: string | null
  responseBodySize?: number
}

export function startHakkaCapture(maxRequests: number) {
  void maxRequests
}

export function getHakkaCaptures(): CapturedResponse[] | null {
  return null
}

export function showHakkaInspector() {
  return Promise.resolve()
}
