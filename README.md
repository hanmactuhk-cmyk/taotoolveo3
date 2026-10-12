# FlowDesk Studio — Bản gốc C# WinForms kèm giải pháp chống reCAPTCHA & Stealth Mode

Ứng dụng C# WinForms chạy trên Windows, giữ nguyên toàn bộ kiến trúc gốc (`FlowDesk.cs`, `flow-bridge.js`, `FlowDesk.csproj`, `build.cmd`) và đã được tích hợp trực tiếp **giải pháp vượt lỗi reCAPTCHA / "hoạt động bất thường"**.

## Giải pháp Bypass reCAPTCHA & Stealth Mode đã tích hợp trong mã nguồn:

1. **Vô hiệu hóa cờ tự động hóa (Anti-Bot Flags)**:
   - Trong `BrowserManager.cs`, khi khởi chạy Chrome qua CDP, đã bổ sung các cờ:
     `--disable-blink-features=AutomationControlled`
     `--exclude-switches=enable-automation`
     `--disable-infobars`
   - Giúp Google Flow không phát hiện ra trình duyệt đang được điều khiển tự động qua cổng gỡ lỗi (`--remote-debugging-port`).

2. **Tiêm mã Stealth trực tiếp qua CDP (`Page.addScriptToEvaluateOnNewDocument`)**:
   - Ngay khi tải trang Flow, CDP sẽ tự động chạy script ẩn `navigator.webdriver = undefined`, giả lập `navigator.languages`, plugins và đối tượng `window.chrome`.

3. **Giữ nguyên phiên đăng nhập (Session & Cookie Persistence)**:
   - Sử dụng thư mục hồ sơ riêng (`Data/Profiles/`) giúp bạn đăng nhập Google thủ công 1 lần duy nhất, các lần sau tự động khôi phục session mà không bị hỏi lại CAPTCHA.

## Cách biên dịch & chạy:
Trên máy Windows có cài .NET Framework 4.8 và Chrome/Edge:
1. Chạy tệp `build.cmd`
2. Khởi chạy `FlowDesk.exe`
