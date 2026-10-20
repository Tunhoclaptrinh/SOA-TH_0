# Kết quả đo Lab 3

Thời điểm (UTC+7): 10:39:06 20/10/2026. Node: v24.21.0.

Đối chứng: Cùng xử lý HTTP/nghiệp vụ; timeout 15s, một lần gọi, không keep-alive. Đây là cấu hình đối chứng được dựng để so sánh, không phải số đo từ mã nguồn cũ. TH1 và xử lý lỗi 4xx dùng chung nên có thể đã đạt ngay từ đối chứng.

LCG seed=7 cho từng lần chạy lỗi; không sửa tỉ lệ lỗi 0.3. Kết quả thực tế dùng Math.random có thể thay đổi giữa các lần chạy.

| Tình huống | Đối chứng | Bản hoàn thiện | Đạt |
| --- | --- | --- | --- |
| 1. Ngân hàng tắt | HTTP 503, 17.31 ms | HTTP 503, 0.8 ms; phục hồi HTTP 201 | true |
| 2. Ngân hàng trễ 5s | HTTP 201, 5004.71 ms | HTTP 504/PENDING, 4000.95 ms | true |
| 2. GET khi 20 lệnh chờ | 3.21 ms | 1.35 ms; 20/20 PENDING; max 4009 ms | true |
| 3. 200 lệnh / 10 đồng thời | 200/200 PAID; 200 TCP; 142.65 ms | 200/200 PAID; 8 TCP; 71.75 ms | true |
| 3. Sau idle 6s | Chỉ đo bản hoàn thiện | 5/5 PAID | true |
| 4a. DROP_RATE=0.3 | 43/60 PAID; 60 charges; 0 duplicates | 60/60 PAID; 60 charges; 0 duplicates | true |
| 4b. FAIL_RATE=0.3 | 43/60 PAID; 43 charges; 0 duplicates | 60/60 PAID; 60 charges; 0 duplicates | true |
| 4c. Từ chối 25 triệu | HTTP 402; 1 request | HTTP 402; 1 request | true |

Số TCP là chênh lệch connections ở /stats trước/sau batch, dùng lại một kết nối riêng để đọc stats. Requests đếm POST /charges; charges đếm lần trừ tiền thật; replay idempotency không tăng charges hoặc duplicates.

Dữ liệu JSON chi tiết: [lab-results.json](lab-results.json). Chạy lại bằng pnpm lab; runner dùng cổng ngẫu nhiên và dữ liệu riêng, không đụng các service bạn đang chạy ở 4001/4002.
