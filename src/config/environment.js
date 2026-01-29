export const ENV_CONFIG = {
  development: {
    API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000',
    DEBUG: true,
  },
  
  production: {
    API_BASE_URL: import.meta.env.VITE_API_BASE_URL || '/api',
    DEBUG: false,
  }
};

export const getCurrentEnvironment = () => {
  if (import.meta.env.DEV) {
    return 'development';
  }
  
  return import.meta.env.VITE_ENVIRONMENT || 'production';
};

export const getEnvConfig = () => {
  const env = getCurrentEnvironment();
  return ENV_CONFIG[env] || ENV_CONFIG.production;
};

export const currentEnv = getEnvConfig();

