import { InternalAxiosRequestConfig, AxiosInstance } from 'axios';

interface AuthTokens {
    accessToken: string;
    refreshToken?: string;
}
interface AuthInterceptorConfig {
    /** Hàm gọi API refresh token. Trả về Promise chứa token mới. */
    requestRefresh: (refreshToken: string) => Promise<AuthTokens>;
    /** Hàm lấy refresh token từ storage (localStorage, cookie...). */
    getRefreshToken: () => string | null | undefined;
    /** Callback chạy khi refresh thành công (để bạn lưu token mới). */
    onSuccess: (tokens: AuthTokens) => void;
    /** Callback chạy khi refresh thất bại (để bạn logout, clear storage). */
    onFailure: (error: any) => void;
    /** (Tùy chọn) Tự custom cách gắn token vào header. Mặc định là 'Authorization: Bearer ...' */
    attachTokenToRequest?: (request: InternalAxiosRequestConfig, token: string) => void;
}
declare const applyAuthTokenInterceptor: (axiosInstance: AxiosInstance, config: AuthInterceptorConfig) => void;

export { type AuthInterceptorConfig, type AuthTokens, applyAuthTokenInterceptor };
