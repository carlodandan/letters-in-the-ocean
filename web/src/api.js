const BASE = '/api';

export class ApiError extends Error {
  constructor(status, payload) {
    const detail = payload?.error;
    super(detail?.message ?? 'The ocean did not answer. Try again in a moment.');
    this.name = 'ApiError';
    this.status = status;
    this.code = detail?.code ?? 'unknown';
    this.care = detail?.care ?? false;
    this.payload = payload ?? null;
    this.resetsAt = detail?.resetsAt ?? null;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      // The session is an HttpOnly cookie on the same origin. No tokens, no
      // Authorization header, nothing for a script on the page to read.
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw new ApiError(0, {
      error: { code: 'offline', message: 'No connection to the ocean. Check your network.' },
    });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, {
        error: { code: 'unreadable', message: 'The ocean answered in a language we do not speak.' },
      });
    }
  }

  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export const api = {
  state: (signal) => request('/state', { signal }),
  stats: (signal) => request('/stats', { signal }),
  findBottle: (signal) => request('/bottle/random', { signal }),
  readBottle: (id, signal) => request(`/bottle/${encodeURIComponent(id)}`, { signal }),
  leaveLetter: (message) => request('/bottle', { method: 'POST', body: { message } }),
  reply: (id, message) =>
    request(`/bottle/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { message } }),
  sendFurther: (id) => request(`/bottle/${encodeURIComponent(id)}/release`, { method: 'POST' }),
  report: (id, reason) =>
    request(`/bottle/${encodeURIComponent(id)}/report`, { method: 'POST', body: { reason } }),
};
