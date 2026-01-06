// src/index.ts
import {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

// 1. Định nghĩa các kiểu dữ liệu (Types)
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthInterceptorConfig {
  /** Hàm gọi API refresh token. Trả về Promise chứa token mới. */
  requestRefresh: (refreshToken: string) => Promise<AuthTokens>;

  /** Hàm lấy refresh token từ storage (localStorage, cookie...). */
  getRefreshToken: () => string | null | undefined;

  /** Callback chạy khi refresh thành công (để bạn lưu token mới). */
  onSuccess: (tokens: AuthTokens) => void;

  /** Callback chạy khi refresh thất bại (để bạn logout, clear storage). */
  onFailure: (error: any) => void;

  /** (Tùy chọn) Tự custom cách gắn token vào header. Mặc định là 'Authorization: Bearer ...' */
  attachTokenToRequest?: (
    request: InternalAxiosRequestConfig,
    token: string
  ) => void;
}

// Hàng đợi lưu các request bị fail để retry sau
interface FailedRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

// 2. Logic chính
export const applyAuthTokenInterceptor = (
  axiosInstance: AxiosInstance,
  config: AuthInterceptorConfig
) => {
  let isRefreshing = false;
  let failedQueue: FailedRequest[] = [];

  // Hàm xử lý hàng đợi: Duyệt qua các request đang chờ và quyết định retry hay reject
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

  // INTERCEPTOR LOGIC
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

      // CASE 1: Đang có một request khác thực hiện refresh token
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

      // CASE 2: Chưa ai refresh, bắt đầu quy trình refresh
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = config.getRefreshToken();

        if (!refreshToken) {
          throw new Error("No refresh token available");
        }

        // Gọi hàm refresh của user
        const newTokens = await config.requestRefresh(refreshToken);

        // Refresh thành công
        config.onSuccess(newTokens);

        // Cập nhật token cho request hiện tại (người khởi xướng)
        const attachToken = config.attachTokenToRequest || defaultAttachToken;
        attachToken(originalRequest, newTokens.accessToken);

        // Chạy lại hàng đợi (những request bị kẹt lúc đang refresh)
        processQueue(null, newTokens.accessToken);

        // Gọi lại request ban đầu
        return axiosInstance(originalRequest);
      } catch (err) {
        // Refresh thất bại (Token hết hạn hẳn hoặc API lỗi)
        processQueue(err, null);
        config.onFailure(err);
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }
  );
};
