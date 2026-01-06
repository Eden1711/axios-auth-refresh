// test/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { applyAuthTokenInterceptor } from "../src/index";

describe("applyAuthTokenInterceptor", () => {
  let client: any;
  let mock: MockAdapter;

  beforeEach(() => {
    // 1. Tạo instance axios mới cho mỗi bài test
    client = axios.create();
    // 2. Mock lại axios để không gọi API thật
    mock = new MockAdapter(client);
  });

  afterEach(() => {
    // Reset mock sau mỗi lần chạy
    mock.reset();
    vi.restoreAllMocks();
  });

  it("✅ Should refresh token and retry failed request on 401", async () => {
    const accessToken = "token-old";
    const newAccessToken = "token-new";

    // Mock API bình thường trả về 401 (lần đầu) và 200 (lần sau)
    mock
      .onGet("/data")
      .replyOnce(401)
      .onGet("/data")
      .reply(200, { data: "success" });

    const requestRefreshMock = vi
      .fn()
      .mockResolvedValue({ accessToken: newAccessToken });
    const onSuccessMock = vi.fn();

    applyAuthTokenInterceptor(client, {
      requestRefresh: requestRefreshMock,
      onSuccess: onSuccessMock,
      onFailure: vi.fn(),
    });

    // Gọi API, nó sẽ bị 401 -> Interceptor bắt -> Refresh -> Gọi lại
    const response = await client.get("/data");

    expect(response.status).toBe(200);
    expect(requestRefreshMock).toHaveBeenCalledTimes(1); // gọi refresh
    expect(onSuccessMock).toHaveBeenCalledWith({ accessToken: newAccessToken }); // báo success

    // Kiểm tra xem header của request retry có token mới không
    expect(response.config.headers["Authorization"]).toBe(
      `Bearer ${newAccessToken}`
    );
  });

  it("🚀 Should handle concurrent requests (The Queue Logic)", async () => {
    // 3 Request lỗi cùng lúc

    // Mock 3 API đều lỗi 401 lần đầu
    mock.onGet("/1").replyOnce(401).onGet("/1").reply(200, "done-1");
    mock.onGet("/2").replyOnce(401).onGet("/2").reply(200, "done-2");
    mock.onGet("/3").replyOnce(401).onGet("/3").reply(200, "done-3");

    const requestRefreshMock = vi.fn().mockImplementation(async () => {
      //API refresh tốn 100ms
      await new Promise((r) => setTimeout(r, 100));
      return { accessToken: "token-xin-cho-queue" };
    });

    applyAuthTokenInterceptor(client, {
      requestRefresh: requestRefreshMock,
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    });

    // Gọi 3 request
    const [res1, res2, res3] = await Promise.all([
      client.get("/1"),
      client.get("/2"),
      client.get("/3"),
    ]);

    // Tất cả phải thành công
    expect(res1.data).toBe("done-1");
    expect(res2.data).toBe("done-2");
    expect(res3.data).toBe("done-3");

    //  Refresh token chỉ được gọi ĐÚNG 1 LẦN
    expect(requestRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("❌ Should logout user if refresh fails", async () => {
    // Mock API lỗi 401
    mock.onGet("/data").reply(401);

    // Mock API refresh cũng lỗi
    const requestRefreshMock = vi
      .fn()
      .mockRejectedValue(new Error("Refresh failed"));
    const onFailureMock = vi.fn();

    applyAuthTokenInterceptor(client, {
      requestRefresh: requestRefreshMock,
      onSuccess: vi.fn(),
      onFailure: onFailureMock,
    });

    //  ném ra lỗi
    await expect(client.get("/data")).rejects.toThrow();

    // Verify
    expect(requestRefreshMock).toHaveBeenCalled();
    expect(onFailureMock).toHaveBeenCalled(); // Hàm logout phải được gọi
  });

  it("⚙️ Should support custom headers (attachTokenToRequest)", async () => {
    mock.onGet("/custom").replyOnce(401).onGet("/custom").reply(200);

    applyAuthTokenInterceptor(client, {
      requestRefresh: vi
        .fn()
        .mockResolvedValue({ accessToken: "custom-token" }),
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
      // Custom Header Logic
      attachTokenToRequest: (req, token) => {
        req.headers["x-api-key"] = token; // Gắn vào header lạ
      },
    });

    const res = await client.get("/custom");

    // Kiểm tra xem request retry có header x-api-key không
    expect(res.config.headers["x-api-key"]).toBe("custom-token");
    // Và không được có header mặc định
    expect(res.config.headers["Authorization"]).toBeUndefined();
  });
});
