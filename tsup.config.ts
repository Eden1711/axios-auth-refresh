import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"], // File đầu vào
  format: ["cjs", "esm"], // Build ra 2 định dạng: CommonJS và ES Module
  dts: true, // Tự động tạo file .d.ts (Type definition)
  clean: true, // Xóa thư mục dist cũ trước khi build
  minify: true, // Nén code
  sourcemap: true, // Để debug
});
