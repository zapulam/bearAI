import { currentEnv } from './environment.js';

const getApiBaseUrl = () => {
  return currentEnv.API_BASE_URL;
};

export const API_BASE_URL = getApiBaseUrl();

export const buildApiUrl = (endpoint) => {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  return `${API_BASE_URL}/${cleanEndpoint}`;
};

export const API_ENDPOINTS = {
  CHAT: 'chat/generate',
  CHAT_HISTORY: 'chat/history',
  CHAT_CLEAR: 'chat/clear',
  CHAT_SESSIONS: 'chat/sessions',
  SETTINGS_CONNECTIONS: 'settings/connections',
  SETTINGS_MEMORIES: 'settings/memories',
  SETTINGS_OPENAI_API_KEY: 'settings/openai-api-key',
  SPOTIFY_CONNECT: 'spotify/connect',
  SPOTIFY_CALLBACK: 'spotify/callback',
  SPOTIFY_REFRESH: 'spotify/refresh',
  SPOTIFY_DISCONNECT: 'spotify/disconnect',
  ACTIONS_PENDING: 'actions/pending',
  ACTIONS_APPROVE: (id) => `actions/pending/${id}/approve`,
  ACTIONS_CANCEL: (id) => `actions/pending/${id}/cancel`,
};

export const apiCall = async (endpoint, options = {}) => {
  const url = buildApiUrl(endpoint);
  
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API call to ${endpoint} failed:`, error);
    throw error;
  }
};

