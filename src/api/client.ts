/**
 * API client — faithful port of the legacy apiResponse/api/apiText helpers.
 * CSRF via qase_csrf cookie on non-GET requests, same-origin credentials,
 * 401-while-signed-in → page reload, {error} JSON parsing.
 */

type ApiOptions = Omit<RequestInit, 'method' | 'headers'> & {
  method?: string;
  headers?: Record<string, string>;
};

let signedIn = false;
/** The auth surfaces (Phase 3) flip this once /api/auth/me resolves. */
export function setSignedIn(value: boolean): void {
  signedIn = value;
}

export async function apiResponse(path: string, options: ApiOptions = {}): Promise<Response> {
  const method = String(options.method ?? 'GET').toUpperCase();
  const csrf = document.cookie.match(/(?:^|; )qase_csrf=([^;]+)/)?.[1];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)
      ? { 'X-CSRF-Token': decodeURIComponent(csrf) }
      : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`/api${path}`, {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
  });
  if (response.status === 401 && signedIn && !path.startsWith('/auth/')) {
    window.location.reload();
    throw new Error('Your session has expired. Sign in again.');
  }
  if (!response.ok) {
    const text = await response.text();
    let message: string | undefined;
    try {
      message = JSON.parse(text).error;
    } catch {
      message = text;
    }
    const error = new Error(message || `Request failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return response;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await apiResponse(path, options);
  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}

export async function apiText(path: string, options: ApiOptions = {}): Promise<string> {
  return (await apiResponse(path, options)).text();
}
