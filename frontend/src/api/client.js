import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401 → clear token and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  captcha:        ()     => api.get('/auth/captcha'),
  login:          (data) => api.post('/auth/login', data),
  logout:         ()     => api.post('/auth/logout'),
  changePassword: (data) => api.post('/auth/change-password', data),
};

export const devicesApi = {
  list:   ()         => api.get('/devices'),
  create: (data)     => api.post('/devices', data),
  rename: (id, data) => api.patch(`/devices/${id}`, data),
  remove: (id)       => api.delete(`/devices/${id}`),
  qr:     (id)       => api.get(`/devices/${id}/qr`),
  link:   (id)       => api.get(`/devices/${id}/link`),
};

export const usersApi = {
  list:         ()                 => api.get('/users'),
  create:       (data)             => api.post('/users', data),
  update:       (id, data)         => api.patch(`/users/${id}`, data),
  remove:       (id)               => api.delete(`/users/${id}`),
  devices:      (id)               => api.get(`/users/${id}/devices`),
  addDevice:    (userId, data)     => api.post(`/users/${userId}/devices`, data),
  removeDevice: (userId, deviceId) => api.delete(`/users/${userId}/devices/${deviceId}`),
};

export const statsApi = {
  me:          ()         => api.get('/stats/me'),
  server:      ()         => api.get('/stats/server'),
  online:      ()         => api.get('/stats/online'),
  deviceDaily: (id, days) => api.get(`/stats/devices/${id}/daily`, { params: { days } }),
  connections: (id)       => api.get(`/stats/devices/${id}/connections`),
  audit:       (limit)    => api.get('/stats/audit', { params: { limit } }),
};

export default api;
