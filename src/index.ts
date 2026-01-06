// src/index.ts
import {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

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
}

// Queue lưu các request bị fail để retry sau
interface FailedRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

export const applyAuthTokenInterceptor = (
  axiosInstance: AxiosInstance,
  config: AuthInterceptorConfig
) => {
  let isRefreshing = false;
  let failedQueue: FailedRequest[] = [];

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

  axiosInstance.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };

      // Nếu không phải lỗi 401 hoặc request này đã từng retry rồi -> Bỏ qua
      if (
        error.response?.status !== 401 ||
        !originalRequest ||
        originalRequest._retry
      ) {
        return Promise.reject(error);
      }

      // Đang có request khác thực hiện refresh token
      if (isRefreshing) {
        return new Promise(function (resolve, reject) {
          failedQueue.push({
            resolve: (token: string) => {
              // Khi có token mới, gắn lại vào request cũ và gọi lại
              const attachToken =
                config.attachTokenToRequest || defaultAttachToken;
              attachToken(originalRequest, token);
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
        let refreshToken = config.getRefreshToken
          ? config.getRefreshToken()
          : undefined;

        if (refreshToken === null) {
          refreshToken = undefined;
        }

        //  refresh
        const newTokens = await config.requestRefresh(refreshToken);

        // Refresh thành công
        config.onSuccess(newTokens);

        // Cập nhật token
        const attachToken = config.attachTokenToRequest || defaultAttachToken;
        attachToken(originalRequest, newTokens.accessToken);

        // Chạy lại queue
        processQueue(null, newTokens.accessToken);

        // Gọi lại request ban đầu
        return axiosInstance(originalRequest);
      } catch (err) {
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
