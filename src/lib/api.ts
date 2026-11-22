const TOKEN_KEY = "zk_mc3_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (token: string) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

type Options = {
  method?: string;
  body?: any;
  query?: Record<string, string | number | boolean | undefined>;
  formData?: FormData;
  raw?: boolean;
};

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, query, formData } = options;
  const url = new URL(`/api${path}`, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    });
  }

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !formData) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: formData ? formData : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Network error — please check your connection.", 0);
  }

  if (response.status === 401) {
    const text = await response.clone().text();
    let message = "Session expired";
    try {
      message = JSON.parse(text).error || message;
    } catch {
      /* ignore */
    }
    if (!path.startsWith("/auth/login") && !path.startsWith("/auth/register")) {
      setToken("");
      if (!window.location.pathname.startsWith("/login")) {
        window.dispatchEvent(new CustomEvent("zk:unauthorized"));
      }
    }
    throw new ApiError(message, 401);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    if (contentType.includes("application/json")) {
      try {
        const data = await response.json();
        message = data.error || message;
      } catch {
        /* ignore */
      }
    }
    throw new ApiError(message, response.status);
  }

  if (options.raw) return response as unknown as T;

  // 304 has no body by definition, and an empty JSON body cannot be parsed.
  // Returning undefined lets callers keep their current state instead of
  // throwing and falling back to hardcoded defaults — which is how a saved theme
  // or panel name used to silently revert on the next load.
  if (response.status === 304 || response.status === 204) return undefined as unknown as T;

  if (contentType.includes("application/json")) {
    const text = await response.text();
    if (!text.trim()) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as unknown as T;
    }
  }
  return (await response.text()) as unknown as T;
}

export const apiDownload = async (path: string, filename: string) => {
  const response = await api<Response>(path, { raw: true });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const uploadFile = async (path: string, file: File, extra: Record<string, string> = {}) => {
  const formData = new FormData();
  formData.append("file", file);
  Object.entries(extra).forEach(([k, v]) => formData.append(k, v));
  return api(path, { method: "POST", formData });
};
