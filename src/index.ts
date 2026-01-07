// src/index.ts
import {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

declare module "axios" {
  export interface AxiosRequestConfig {
    skipAuthRefresh?: boolean;
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Configuration options for the Auth Interceptor.
 */
export interface AuthInterceptorConfig {
  /** * The function to call when the token expires.
   * Should return the new access token (and refresh token if available).
   */
  requestRefresh: (refreshToken?: string) => Promise<AuthTokens>;

  /**
   * Function to get the current refresh token from storage.
   */
  getRefreshToken?: () => string | null | undefined;

  /** Callback chạy khi refresh thành công */
  onSuccess: (tokens: AuthTokens) => void;

  /** Callback chạy khi refresh thất bại  */
  onFailure: (error: any) => void;

  /**  Tự custom cách gắn token vào header. Mặc định là 'Authorization: Bearer ...' */
  attachTokenToRequest?: (
    request: InternalAxiosRequestConfig,
    token: string
  ) => void;

  /**
   * Handler chạy trước mọi request.
   * Dùng để tự động gắn Access Token vào header từ localStorage/Store.
   */
  headerTokenHandler?: (
    request: InternalAxiosRequestConfig
  ) => void | Promise<void>;

  refreshTimeout?: number;

  /** * error code refresh token.
   * @default [401]
   */
  statusCodes?: number[];

  /** * log debug interceptor.
   * @default false
   */
  debug?: boolean;

  /**
   * [OPTIONAL] Check if the token in storage is valid.
   * Used for Cross-Tab Synchronization.
   *
   * If this returns a string (the token), we skip the refresh and use this token.
   * If this returns null/false, we proceed with the refresh.
   */
  checkTokenIsValid?: () =>
    | Promise<string | null | false>
    | string
    | null
    | false;
}

// Queue lưu các request bị fail để retry sau
interface FailedRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  config: InternalAxiosRequestConfig;
}

const LOCK_KEY = "axios-auth-refresh-lock";

/**
 * Applies the authentication interceptor to an Axios instance.
 * * @param axiosInstance - The Axios instance to intercept.
 * @param config - Configuration for the interceptor.
 * * @example
 * ```ts
 * applyAuthTokenInterceptor(axios, {
 * requestRefresh: myRefreshFunction,
 * onSuccess: (tokens) => saveTokens(tokens),
 * onFailure: () => logout(),
 * });
 * ```
 */
export const applyAuthTokenInterceptor = (
  axiosInstance: AxiosInstance,
  config: AuthInterceptorConfig
): void => {
  // Setup Request Interceptor (Header Handler)
  if (config.headerTokenHandler) {
    axiosInstance.interceptors.request.use(
      async (requestConfig) => {
        await config.headerTokenHandler!(requestConfig);
        return requestConfig;
      },
      (error) => Promise.reject(error)
    );
  }

  let isRefreshing = false;
  let failedQueue: FailedRequest[] = [];

  const TIMEOUT_MS = config.refreshTimeout || 30000;

  const log = (msg: string, ...args: any[]) => {
    if (config.debug) {
      console.log(
        `%c[Auth-Queue] ${msg}`,
        "color: #e67e22; font-weight: bold;",
        ...args
      );
    }
  };

  // Hàm mặc định để gắn token nếu user không truyền attachTokenToRequest
  const defaultAttachToken = (
    request: InternalAxiosRequestConfig,
    token: string
  ) => {
    request.headers.set("Authorization", `Bearer ${token}`);
  };

  const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach((prom) => {
      if (error) {
        prom.reject(error);
      } else {
        if (token) {
          const attachToken = config.attachTokenToRequest || defaultAttachToken;
          attachToken(prom.config, token);
        }
        // Gọi lại request
        prom.resolve(axiosInstance(prom.config));
      }
    });
    failedQueue = [];
  };

  const statusCodes = config.statusCodes || [401];

  axiosInstance.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
        skipAuthRefresh?: boolean;
      };

      if (error.response) {
        log(
          `🚨 Error ${error.response.status} detected from ${originalRequest?.url}`
        );
      }

      if (originalRequest?.skipAuthRefresh) {
        log("⏩ Skipping because skipAuthRefresh is set.");
        return Promise.reject(error);
      }

      // Nếu không phải lỗi 401 hoặc request này đã từng retry rồi -> Bỏ qua
      if (
        !error.response ||
        !statusCodes.includes(error.response.status) ||
        !originalRequest ||
        originalRequest.skipAuthRefresh ||
        originalRequest._retry
      ) {
        return Promise.reject(error);
      }

      // Đang có request khác thực hiện refresh token
      if (isRefreshing) {
        log("⏳ Refresh already in progress (Local). Adding to queue...");
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: originalRequest });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      return new Promise((resolve, reject) => {
        // push request error into queue
        failedQueue.push({ resolve, reject, config: originalRequest });

        // Refresh
        const performRefresh = async () => {
          try {
            log("🔒 Acquired Lock. Checking logic...");

            // 1. Cross-Tab Check: check token another Tab is refreshing?
            if (config.checkTokenIsValid) {
              const validToken = await config.checkTokenIsValid();
              if (validToken && typeof validToken === "string") {
                log("✨ Token was already refreshed by another tab. Reusing.");
                processQueue(null, validToken);
                return;
              }
            }

            // 2. Ready Refresh
            log("🔄 Starting refresh token flow...");
            let refreshToken = config.getRefreshToken
              ? config.getRefreshToken()
              : undefined;

            if (refreshToken === null) refreshToken = undefined;

            const timeoutPromise = new Promise<never>((_, rej) => {
              setTimeout(() => {
                rej(new Error(`Refresh token timed out after ${TIMEOUT_MS}ms`));
              }, TIMEOUT_MS);
            });

            // 3. Call API Refresh
            const newTokens = await Promise.race([
              config.requestRefresh(refreshToken),
              timeoutPromise,
            ]);

            // 4. Success -> Callback & Process Queue
            log("✅ Refresh Successful! Token updated.");
            config.onSuccess(newTokens);
            processQueue(null, newTokens.accessToken);
          } catch (err: any) {
            log("❌ Refresh Failed:", err.message);
            processQueue(err, null);
            config.onFailure(err);
          } finally {
            isRefreshing = false;
          }
        };

        // 👇  WEB LOCKS API
        if (typeof navigator !== "undefined" && navigator.locks) {
          // Please lock the tab. If another tab already holds the lock, the code will stop here and wait.
          navigator.locks.request(LOCK_KEY, async () => {
            await performRefresh();
          });
        } else {
          // Fallback
          performRefresh();
        }
      });
    }
  );
};
