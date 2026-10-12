# FlowDesk Studio • Ứng dụng Desktop Electron (TypeScript + React)

Ứng dụng Desktop Electron tự động hóa Google Flow qua giao thức Chrome DevTools Protocol (CDP WebSocket), giữ nguyên 100% quy trình và cấu trúc nghiệp vụ từ mã nguồn gốc C# WinForms (`FlowDesk.cs` & `flow-bridge.js`).

---

## 🏗️ Kiến trúc phân lớp dự án

| Phân lớp | Thư mục / Tập tin | Trách nhiệm |
| :--- | :--- | :--- |
| **Main Process** | `electron/main.js`<br>`electron/store.js`<br>`electron/browser-manager.js`<br>`electron/cdp-client.js`<br>`electron/job-runner.js` | Quản lý vòng đời ứng dụng, hồ sơ Chrome riêng (`Data/Profiles/<id>`), kết nối WebSocket CDP cục bộ, nạp script `flow-bridge.js`, quản lý hàng đợi song song và tải tệp kết quả. |
| **Preload** | `electron/preload.js` | Cầu nối an toàn duy nhất qua `contextBridge.exposeInMainWorld('electronAPI', ...)`. **Tuyệt đối không đưa cookie hay mật khẩu vào Renderer**. |
| **Renderer** | `src/App.tsx`<br>`src/main.tsx` | Giao diện React hiển thị bảng tác vụ, trạng thái thời gian thực và cấu hình. **Không trực tiếp gọi tiến trình bên ngoài hay điều khiển Chrome**. |

---

## 📋 Bảng ánh xạ chức năng gốc C# sang Module Electron

| Chức năng gốc (FlowDesk.cs) | Module Electron tương ứng | Cơ chế hoạt động trong Electron |
| :--- | :--- | :--- |
| **Store (accounts.json, Profiles)** | `electron/store.js` | Lưu trữ file an toàn qua cơ chế `.tmp` rồi rename, giữ nguyên cấu trúc JSON `Database` (Accounts, Jobs, Queue, OutputFolder). |
| **BrowserManager.FindBrowser** | `electron/browser-manager.js` | Dò tìm Google Chrome / Edge trên các đường dẫn tiêu chuẩn 64-bit, 32-bit, LocalAppData và PATH. |
| **BrowserManager.OpenLogin** | `electron/browser-manager.js` | Khởi chạy Chrome thật với `--user-data-dir="Data/Profiles/<id>"` và các cờ ẩn tự động hóa `--disable-blink-features=AutomationControlled`. |
| **Cdp.Connect & Call** | `electron/cdp-client.js` | Kết nối WebSocket tới Chrome bằng thư viện `ws`, gửi lệnh và nhận phản hồi CDP thời gian thực với timeout an toàn. |
| **Cdp.Bridge (flow-bridge.js)** | `electron/cdp-client.js` | Nạp `flow-bridge.js` vào ngữ cảnh trang Flow, tự động xử lý khi bảng tài khoản nằm trong Google iframe (`ACCOUNT_FRAME_REQUIRED`). |
| **AccountRefresh.Read** | `electron/cdp-client.js` + `flow-bridge.js` | Đọc email, gói và credits thực tế từ bảng tài khoản Flow; **không suy đoán hay dùng dữ liệu giả lập**. |
| **ProcessTask & Job isolation** | `electron/job-runner.js` | Mở tab Flow riêng cho từng job (`Target.createTarget`) để tránh xung đột cấu hình giữa các job chạy song song. |
| **UploadJobImages** | `electron/cdp-client.js` | Chặn hộp thoại chọn file của Chrome (`Page.setInterceptFileChooserDialog`) và gán file qua `DOM.setFileInputFiles`. |
| **SubmitAndMonitor** | `electron/job-runner.js` | Gửi lệnh bằng click chuột CDP, chỉ báo đã gửi khi Flow xác nhận, theo dõi đến khi có URL video/ảnh thực tế rồi tải về máy. |
| **RetryInPlace & Attempts** | `electron/job-runner.js` | Giữ nguyên hàng job và ID, tạo mã lần chạy mới (`ExecutionId`) và lưu lần chạy cũ vào mảng lịch sử `Attempts`. |

---

## 🔍 Phân định rõ ràng trạng thái kiểm chứng

1. **Chức năng đã chuyển mã hoàn chỉnh (100% Code Ported)**:
   - Toàn bộ nghiệp vụ C# của `Store`, `BrowserManager`, `CdpClient`, `JobRunner`, và `flow-bridge.js` đã được viết lại bằng Node.js / TypeScript.
   - Giao diện Renderer React đã kết nối đầy đủ các hàm IPC của Preload.

2. **Chức năng đã kiểm tra mô phỏng (Tested in Simulation)**:
   - Gõ prompt tự động tách dòng thành hàng job trong bảng; sửa prompt trực tiếp trên ô.
   - Cấu hình song song (concurrency), tạm dừng (pause), dừng (stop), và tạo lại (retry).
   - Đóng gói ứng dụng Windows bằng `vite build` và `electron-builder`.

3. **Chức năng cần kiểm chứng trực tiếp trên tài khoản Flow thật**:
   - Khả năng đọc chính xác thẻ tài khoản Google/Flow trong trường hợp giao diện Google cập nhật DOM.
   - Cơ chế chặn hộp thoại chọn file tải ảnh tham chiếu trên trình duyệt thật.
   - **Lưu ý về lỗi "hoạt động bất thường"**: Mặc dù đã nạp đầy đủ các cờ Stealth (`navigator.webdriver = undefined`, xóa cờ automation), Google Flow liên tục cập nhật thuật toán bot detection; **không thể khẳng định 100% không bao giờ gặp lỗi này nếu chưa chạy thử nghiệm trên tài khoản Flow thực tế của bạn**.

---

## 🚀 Hướng dẫn chạy và đóng gói ứng dụng

### 1. Chạy trong môi trường phát triển (Development):
```bash
# Cài đặt dependencies (nếu chưa cài)
npm install

# Chạy bản dựng giao diện và mở Electron
npm run electron:dev
```

### 2. Đóng gói ứng dụng Windows (.exe):
```bash
# Biên dịch giao diện Vite và đóng gói bằng electron-builder
npm run electron:build
```
Tệp cài đặt Windows (`.exe` NSIS và bản Portable) sẽ được tạo tại thư mục `dist-electron/`.
