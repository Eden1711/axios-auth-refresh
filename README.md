# Axios Auth Refresh Queue 🛡️

A **bulletproof**, zero-config Axios interceptor that handles JWT refresh tokens automatically. It solves the race condition problem when multiple requests fail with `401 Unauthorized` simultaneously.

![License](https://img.shields.io/npm/l/axios-auth-refresh-queue)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)
![Size](https://img.shields.io/bundlephobia/minzip/axios-auth-refresh-queue)

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

⚙️ API Reference
`applyAuthTokenInterceptor(axiosInstance, config)`
| Property | Type | Required | Description | |Data |Data |Data |Data | | `requestRefresh` | (token) => Promise<AuthTokens> | Yes | Your API call logic to get a new token. | | getRefreshToken| () => string | Yes | Function to retrieve the current refresh token from storage. | | onSuccess | (tokens) => void | Yes | Callback invoked when a new token is retrieved successfully. | | onFailure | (error) => void | Yes | Callback invoked when the refresh logic fails (user should be logged out). | | attachTokenToRequest | (req, token) => void | No | Custom function to attach the new token to the retried request headers. |

🤝 Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
