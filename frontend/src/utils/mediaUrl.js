const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const BACKEND_ORIGIN = API_BASE.replace(/\/api\/?$/, '') || window.location.origin;

/** Resolve uploaded file paths (e.g. /uploads/...) to a full backend URL. */
export function resolveMediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BACKEND_ORIGIN}${normalized}`;
}

export default resolveMediaUrl;
