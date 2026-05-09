export const formatDateTime = (value, fallback = '-') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return date.toLocaleString('en-GB', { hour12: false });
};

export const formatDateOnly = (value, fallback = '-') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return date.toLocaleDateString('en-GB');
};
