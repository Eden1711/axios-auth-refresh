// src/index.ts
import {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

// declare module "axios" {
//   export interface AxiosRequestConfig {
//     skipAuthRefresh?: boolean;
//   }
// }

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthInterceptorConfig {
  requestRefresh: (refreshToken?: string) => Promise<AuthTokens>;

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

  refreshTimeout?: number;

  /** * error code refresh token.
   * @default [401]
   */
  statusCodes?: number[];

  /** * log debug interceptor.
   * @default false
   */
  debug?: boolean;
}

// Queue lưu các request bị fail để retry sau
interface FailedRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

export const applyAuthTokenInterceptor = (
  axiosInstance: AxiosInstance,
  config: AuthInterceptorConfig
): void => {
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

  const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach((prom) => {
      if (error) {
        prom.reject(error);
      } else {
        prom.resolve(token);
      }
    });
    failedQueue = [];
  };

  // Hàm mặc định để gắn token nếu user không truyền attachTokenToRequest
  const defaultAttachToken = (
    request: InternalAxiosRequestConfig,
    token: string
  ) => {
    request.headers.set("Authorization", `Bearer ${token}`);
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
        originalRequest._retry
      ) {
        return Promise.reject(error);
      }

      // Đang có request khác thực hiện refresh token
      if (isRefreshing) {
        log("⏳ Refresh already in progress. Adding request to queue...");
        return new Promise(function (resolve, reject) {
          failedQueue.push({
            resolve: (token: string) => {
              // Khi có token mới, gắn lại vào request cũ và gọi lại
              const attachToken =
                config.attachTokenToRequest || defaultAttachToken;
              attachToken(originalRequest, token);
              log("✅ Replaying queued request:", originalRequest.url);
              resolve(axiosInstance(originalRequest));
            },
            reject: (err) => {
              reject(err);
            },
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        log("🔄 Starting refresh token flow...");
        let refreshToken = config.getRefreshToken
          ? config.getRefreshToken()
          : undefined;

        if (refreshToken === null) {
          refreshToken = undefined;
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Refresh token timed out after ${TIMEOUT_MS}ms`));
          }, TIMEOUT_MS);
        });

        //  refresh
        const newTokens = await Promise.race([
          config.requestRefresh(refreshToken),
          timeoutPromise,
        ]);

        // Refresh thành công
        log("✨ Refresh Successful! Token updated.");
        config.onSuccess(newTokens);

        // Cập nhật token
        const attachToken = config.attachTokenToRequest || defaultAttachToken;
        attachToken(originalRequest, newTokens.accessToken);

        // Chạy lại queue
        processQueue(null, newTokens.accessToken);

        // Gọi lại request ban đầu
        return axiosInstance(originalRequest);
      } catch (err: any) {
        log("❌ Refresh Failed or Timed out:", err.message);
        // Refresh thất bại
        processQueue(err, null);
        config.onFailure(err);
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }
  );
};
