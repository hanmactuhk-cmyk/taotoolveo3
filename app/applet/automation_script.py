import asyncio
import random
from playwright.async_api import async_playwright, Playwright

# ==========================================
# CẤU HÌNH THÔNG SỐ (TÙY CHỈNH THEO NHU CẦU)
# ==========================================
CDP_URL = "http://localhost:9222"
USER_DATA_DIR = "./chrome_user_data"
TARGET_URL = "https://example.com"  # Thay bằng URL trang web bạn muốn tự động hóa

# Các Selector mẫu (Thay thế bằng selector thực tế trên trang của bạn)
SELECTORS = {
    "username_input": "#username",
    "password_input": "#password",
    "submit_button": "#submit-btn",
    "success_indicator": ".success-message"
}

# Hàm giả lập độ trễ ngẫu nhiên giống người thật (Human-like random delay)
async def human_delay(min_sec: float = 1.5, max_sec: float = 3.5):
    delay = random.uniform(min_sec, max_sec)
    print(f"[*] Đang chờ ngẫu nhiên {delay:.2f} giây...")
    await asyncio.sleep(delay)

async def run_automation():
    async with async_playwright() as p:
        browser = None
        context = None
        page = None
        is_cdp_mode = False

        print("[*] Đang khởi tạo Playwright...")

        # ---------------------------------------------------------
        # BƯỚC 1: KẾT NỐI CHROME QUA CDP (CỔNG 9222) HOẶC FALLBACK
        # ---------------------------------------------------------
        try:
            print(f"[*] Đang thử kết nối vào Google Chrome đang mở qua CDP tại {CDP_URL}...")
            browser = await p.chromium.connect_over_cdp(CDP_URL)
            contexts = browser.contexts
            if contexts:
                context = contexts[0]
            else:
                context = await browser.new_context()
            
            pages = context.pages
            if pages:
                page = pages[0]
            else:
                page = await context.new_page()
            
            is_cdp_mode = True
            print("[+] Kết nối CDP thành công! Sử dụng cửa sổ Chrome thật đang mở.")

        except Exception as cdp_err:
            print(f"[-] Không thể kết nối CDP ({cdp_err}).")
            print(f"[*] Đang chuyển sang cơ chế fallback: launch_persistent_context với thư mục '{USER_DATA_DIR}'...")
            
            try:
                # Fallback: Khởi chạy persistent context lưu profile riêng
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=USER_DATA_DIR,
                    headless=False,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--start-maximized",
                        "--no-sandbox",
                        "--disable-infobars"
                    ],
                    viewport=None
                )
                pages = context.pages
                page = pages[0] if pages else await context.new_page()
                print("[+] Khởi chạy Persistent Context thành công!")
            except Exception as launch_err:
                print(f"[!] Lỗi nghiêm trọng khi khởi tạo browser: {launch_err}")
                return

        try:
            # ---------------------------------------------------------
            # BƯỚC 2: CHỐNG PHÁT HIỆN BOT (ANTI-DETECTION)
            # ---------------------------------------------------------
            # Xóa sạch dấu hiệu navigator.webdriver
            await page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                
                // Giả lập plugins và languages nếu cần thiết
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en', 'vi']
                });
                
                window.chrome = {
                    runtime: {}
                };
            """)
            print("[+] Đã inject script chống phát hiện bot thành công.")

            # ---------------------------------------------------------
            # BƯỚC 3: ĐIỀU HƯỚNG VÀ THỰC THI TÁC VỤ TRANG WEB
            # ---------------------------------------------------------
            print(f"[*] Đang truy cập trang mục tiêu: {TARGET_URL}")
            await page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60000)
            
            # Chờ ngẫu nhiên để mô phỏng hành vi tự nhiên
            await human_delay(2.0, 4.0)

            # Ví dụ thao tác mẫu (bạn có thể thay thế bằng logic riêng của bạn):
            print("[* Kiểm tra các phần tử trên trang...")
            
            # Ví dụ điền form (nếu có):
            # if await page.query_selector(SELECTORS["username_input"]):
            #     await page.fill(SELECTORS["username_input"], "your_username")
            #     await human_delay(1.0, 2.0)
            #     await page.fill(SELECTORS["password_input"], "your_password")
            #     await human_delay(1.0, 2.0)
            #     await page.click(SELECTORS["submit_button"])
            #     print("[+] Đã thực hiện thao tác submit form.")

            print("[+] Tác vụ tự động hóa đã hoàn thành bước điều hướng cơ bản.")
            print("[* Tạm dừng 10 giây để quan sát kết quả trực quan...")
            await asyncio.sleep(10)

        except Exception as err:
            print(f"[!] Lỗi xảy ra trong quá trình thao tác trang: {err}")
            
        finally:
            # ---------------------------------------------------------
            # BƯỚC 4: ĐÓNG TÀI NGUYÊN AN TOÀN
            # ---------------------------------------------------------
            print("[* Đang dọn dẹp và đóng tài nguyên...")
            if page and not is_cdp_mode:
                try:
                    await page.close()
                except:
                    pass
            if context and not is_cdp_mode:
                try:
                    await context.close()
                except:
                    pass
            print("[*] Phiên làm việc đã kết thúc an toàn.")

if __name__ == "__main__":
    print("==================================================")
    print(" BẮT ĐẦU SCRIPT TỰ ĐỘNG HÓA PLAYWRIGHT (PYTHON)")
    print("==================================================")
    asyncio.run(run_automation())
