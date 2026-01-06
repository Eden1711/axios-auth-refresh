# Axios Auth Refresh Queue 🛡️

> 🚀 **Ultra-lightweight (< 1KB)** zero-dependency authentication interceptor for Axios.

> A **bulletproof**, zero-config Axios interceptor that handles JWT refresh tokens automatically. It solves the race condition problem when multiple requests fail with `401 Unauthorized` simultaneously.

![License](https://img.shields.io/badge/License-MIT-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)
[![npm version](https://img.shields.io/npm/v/axios-auth-refresh-queue.svg?style=flat-square)](https://www.npmjs.com/package/axios-auth-refresh-queue)
[![npm downloads](https://img.shields.io/npm/dm/axios-auth-refresh-queue.svg?style=flat-square)](https://www.npmjs.com/package/axios-auth-refresh-queue)
[![install size](https://img.shields.io/badge/dynamic/json?url=https://packagephobia.com/v2/api.json?p=axios-auth-refresh-queue&query=$.install.pretty&label=install%20size&style=flat-square)](https://packagephobia.com/result?p=axios-auth-refresh-queue)
[![JSR](https://jsr.io/badges/@eden1711/axios-auth-refresh-queue)](https://jsr.io/@eden1711/axios-auth-refresh-queue)

## License

[MIT](./LICENSE)

## 🚀 Why use this?

When your Access Token expires, your app might fire 5 API requests at once. Without this library, all 5 will fail, leading to 5 separate "Refresh Token" calls (Race Condition) or forcing the user to logout.

**This library fixes it by:**

1.  Intercepting the first `401` error.
2.  Pausing all other requests in a **Queue**.
3.  Calling the "Refresh Token" API **once**.
4.  Retrying all paused requests with the new token.

## 📦 Installation

```bash
npm install axios-auth-refresh-queue
# or
yarn add axios-auth-refresh-queue
```

🛠️ Usage

1. Basic Setup
   Just wrap your axios instance with applyAuthTokenInterceptor.

```javascript
import axios from "axios";
import { applyAuthTokenInterceptor } from "axios-auth-refresh-queue";

// 1. Create your axios instance
const apiClient = axios.create({
  baseURL: "https://api.your-backend.com", // 👈 REPLACE THIS with your actual API URL
});

// 2. Setup the interceptor
applyAuthTokenInterceptor(apiClient, {
  // Method to get the refresh token from your storage
  // (You can use localStorage, sessionStorage, or cookies here)
  getRefreshToken: () => localStorage.getItem("refresh_token"),

  // Method to call your backend to refresh the token
  requestRefresh: async (refreshToken) => {
    // ⚠️ IMPORTANT: Implement your own refresh token API logic here
    const response = await axios.post(
      "https://api.your-backend.com/auth/refresh",
      {
        token: refreshToken,
      }
    );

    // Function must return this specific object structure
    return {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
    };
  },

  // Callback when refresh succeeds
  onSuccess: (newTokens) => {
    // Logic to save new tokens to storage
    localStorage.setItem("access_token", newTokens.accessToken);
    if (newTokens.refreshToken) {
      localStorage.setItem("refresh_token", newTokens.refreshToken);
    }

    // Optional: Set default header for future requests
    apiClient.defaults.headers.common[
      "Authorization"
    ] = `Bearer ${newTokens.accessToken}`;
  },

  // Callback when refresh fails (e.g., Refresh token also expired)
  onFailure: (error) => {
    console.error("Session expired, logging out...");
    localStorage.clear();
    window.location.href = "/login"; // Redirect to login page
  },
});

export default apiClient;
```

2. Custom Headers (Advanced)
   If your backend doesn't use Authorization: Bearer <token> or requires specific headers (like x-api-key), you can use attachTokenToRequest.

```javascript
applyAuthTokenInterceptor(apiClient, {
  // ... other configs

  attachTokenToRequest: (request, token) => {
    // Custom header logic
    request.headers["x-auth-token"] = token;
    request.headers["x-client-id"] = "my-app-v1";
  },
});
```

### 3. 🔥 Advanced: Secure Mode (HttpOnly Cookie & Memory)

This is the **recommended** setup for high-security applications to prevent XSS attacks.

- **Refresh Token:** Stored in an `HttpOnly Cookie` (handled automatically by the browser).
- **Access Token:** Stored in app memory (variables/state) only.

```typescript
import axios from "axios";
import { applyAuthTokenInterceptor } from "axios-auth-refresh-queue";

// 1. MUST enable withCredentials for cookies to work
const apiClient = axios.create({
  baseURL: "[https://api.your-backend.com](https://api.your-backend.com)",
  withCredentials: true,
});

let accessTokenMemory = null;

applyAuthTokenInterceptor(apiClient, {
  // ❌ NO getRefreshToken function needed
  // (Because the browser handles the cookie automatically)

  // 2. Refresh Logic
  requestRefresh: async () => {
    // Just call the API. The browser sends the cookie automatically.
    const response = await axios.post(
      "[https://api.your-backend.com/auth/refresh](https://api.your-backend.com/auth/refresh)",
      {},
      { withCredentials: true } // 👈 Important
    );

    return {
      accessToken: response.data.accessToken,
      // No need to return refreshToken if it's set via Set-Cookie header
    };
  },

  // 3. Update Memory & Headers
  onSuccess: (newTokens) => {
    // ⚠️ Don't store in localStorage
    accessTokenMemory = newTokens.accessToken;
    // Update default header for future requests
    apiClient.defaults.headers.common[
      "Authorization"
    ] = `Bearer ${newTokens.accessToken}`;

    // (Optional) Update your Redux/Zustand state here if needed
    // store.dispatch(setToken(newTokens.accessToken));
  },

  onFailure: (error) => {
    // Call logout to clear cookies on server
    axios.post("/auth/logout");
    window.location.href = "/login";
  },
});

export default apiClient;
```

### ⏳ Configuration & Timeouts

By default, the interceptor waits **30 seconds** for the refresh token API to respond. If the backend hangs or the network is too slow, the request will fail with a timeout error to prevent the app from being stuck indefinitely.

You can customize this duration using `refreshTimeout`:

```typescript
applyAuthTokenInterceptor(apiClient, {
  // ... other options ...

  // ⚡ Fail fast: Abort if refresh takes more than 10 seconds
  refreshTimeout: 10000,

  onFailure: (error) => {
    // Error message will be: "Refresh token timed out after 10000ms"
    console.error(error.message);
    window.location.href = "/login";
  },
});
```

### ⏩ Skipping Auth Refresh

Sometimes you want to ignore specific requests (e.g., Login API, Health Checks) even if they return 401. You can pass `skipAuthRefresh: true` in the request config.

```typescript
// This request will fail immediately on 401 without triggering refresh flow
axios.get("/api/public-data", {
  skipAuthRefresh: true,
});

// Useful for the Login endpoint itself to prevent infinite loops
axios.post("/api/login", data, {
  skipAuthRefresh: true,
});
```

### 🔧 Custom Status Codes

Some backends return `403 Forbidden` instead of `401 Unauthorized` when the token expires. You can customize which status codes trigger the refresh logic:

```typescript
applyAuthTokenInterceptor(apiClient, {
  // ... other options

  // Trigger refresh on both 401 and 403
  statusCodes: [401, 403],
});
```

### 🐞 Debug Mode

If you are having trouble understanding why the interceptor is not working as expected, enable the `debug` mode. It will log helpful messages to the console with the `[Auth-Queue]` prefix.

```typescript
applyAuthTokenInterceptor(apiClient, {
  // ...
  debug: true, // Logs: 🚨 401 Detected -> 🔄 Refreshing -> ✅ Success
});
```

⚙️ API Reference
`applyAuthTokenInterceptor(axiosInstance, config)`
| Property | Type | Required | Description | |Data |Data |Data |Data | | `requestRefresh` | (token) => Promise<AuthTokens> | Yes | Your API call logic to get a new token. | | getRefreshToken| () => string | Yes | Function to retrieve the current refresh token from storage. | | onSuccess | (tokens) => void | Yes | Callback invoked when a new token is retrieved successfully. | | onFailure | (error) => void | Yes | Callback invoked when the refresh logic fails (user should be logged out). | | attachTokenToRequest | (req, token) => void | No | Custom function to attach the new token to the retried request headers. |

🤝 Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
