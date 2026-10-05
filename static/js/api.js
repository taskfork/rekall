export const API_BASE = '/api';

// Auto-redirect to login if session expires
const origFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await origFetch(...args);
  if (response.status === 401) {
    window.location.href = '/api/auth/oidc/login';
  }
  return response;
};
