# Configuration

This directory contains configuration files for the application.

## Files

### environment.js
Environment-specific configuration for development and production environments.

- **Development**: Uses `http://localhost:8000` as the default API base URL
- **Production**: Uses `/api` as the default API base URL (can be overridden with `VITE_API_BASE_URL`)

### api.js
API configuration and helper functions for making API calls.

- `API_BASE_URL`: The base URL for API requests
- `buildApiUrl(endpoint)`: Helper to build full API URLs
- `API_ENDPOINTS`: Object containing all API endpoint paths
- `apiCall(endpoint, options)`: Helper function for making API calls with error handling

## Environment Variables

You can create a `.env` file in the root directory to override default values:

```
VITE_API_BASE_URL=https://your-api-url.com
VITE_ENVIRONMENT=production
```

Note: All Vite environment variables must be prefixed with `VITE_`.

