# Đối chiếu yêu cầu và chuẩn bị trình bày Lab 3

Đối chiếu với file gốc [đề bài](../lab-ket-noi-noi-dung-PTIT-de-bai.docx). Số liệu thực nghiệm ở [báo cáo đo](lab-results.md) và [JSON chi tiết](lab-results.json); chạy lại bằng `pnpm lab`.

## Yêu cầu bắt buộc

| Nhóm          | Yêu cầu trong đề                                                                                                        | Nơi triển khai và bằng chứng                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kiến trúc     | Hai service Node.js/Express độc lập, dữ liệu trong bộ nhớ; mặc định cổng 4001 và 4002                                   | [Fee entrypoint](../src/fee/server.ts), [Bank entrypoint](../src/bank/server.ts), [cấu hình](../src/shared/config.ts), [launcher hai tiến trình](../scripts/start.ts) |
| Công nợ       | Sinh viên 1: 50.000.000đ; 2: 0đ; 3: 3.200.000đ; GET xem công nợ                                                         | [FeeStore](../src/fee/store.ts), test dữ liệu sinh viên và validation                                                                                                 |
| Tạo lệnh      | POST amount hợp lệ, không vượt nợ; ID P1, P2…; gọi ngân hàng                                                            | [FeeStore](../src/fee/store.ts), [PaymentService](../src/fee/service.ts), test thanh toán thành công và thanh toán đồng thời                                          |
| Ngân hàng     | POST charges: 201 + chargeId, 400 khi amount không hợp lệ, 402 nếu vượt 20 triệu                                        | [validation](../src/bank/validation.ts), [ChargeService](../src/bank/service.ts), test hợp đồng ngân hàng và TH4c                                                     |
| Idempotency   | Cùng khóa và nội dung trả charge cũ; không trừ thêm                                                                     | [ChargeService](../src/bank/service.ts), [BankStore](../src/bank/store.ts), test 10 request cùng khóa đồng thời và retry PENDING                                      |
| Thống kê      | connections đếm TCP mới, requests đếm POST charges, charges đếm trừ tiền thật, duplicates phát hiện trừ trùng reference | [Bank app](../src/bank/app.ts), [BankStore](../src/bank/store.ts); test bộ đếm requests và kiểm soát âm dùng sai khóa                                                 |
| Giả lập lỗi   | DELAY_MS, FAIL_RATE, DROP_RATE lấy từ môi trường khi khởi động                                                          | [cấu hình](../src/shared/config.ts), [ChargeService](../src/bank/service.ts); test TH2, TH4a, TH4b                                                                    |
| Kết nối bank  | Idle tối đa 5 giây, log mỗi TCP mới                                                                                     | [HTTP server](../src/shared/server.ts), [Bank app](../src/bank/app.ts); test sau idle 6 giây                                                                          |
| Nghiệp vụ     | Chỉ giảm nợ khi ngân hàng xác nhận; mỗi lệnh chỉ trừ một lần; GET không phụ thuộc ngân hàng                             | [PaymentService](../src/fee/service.ts), [FeeStore](../src/fee/store.ts); test PENDING, retry đồng thời, ngân hàng tắt và phản hồi sai reference                      |
| Kết quả HTTP  | 201/PAID; 4xx/FAILED giữ mã bank; 503/FAILED khi chắc chưa trừ; 504/PENDING khi chưa rõ                                 | [BankClient](../src/fee/bank-client.ts), [kiểu trạng thái](../src/fee/types.ts); test thành công, từ chối, tắt bank, timeout và mất phản hồi                          |
| JSON lỗi      | Có error, paymentId, status                                                                                             | [error middleware](../src/shared/errors.ts), [controller Fee](../src/fee/controller.ts), test lỗi đầu vào và lỗi thanh toán                                           |
| TH1           | Bank tắt: 503 dưới 1,5s; GET vẫn 200; bank lên lại: 201 không restart Fee; BANK_URL cấu hình được                       | Test TH1 và test cấu hình; phần outage trong báo cáo; [hướng dẫn demo BANK_URL=4999](../README.md#1-ngân-hàng-chưa-chạy-sau-đó-hoạt-động-lại)                         |
| TH2           | DELAY_MS=5000: 504/PENDING trong tối đa 4,5s; khi 20 lệnh chờ, GET dưới 300ms                                           | Test TH2; phần slow trong báo cáo                                                                                                                                     |
| TH3           | 200 lệnh, 10 đồng thời, mỗi lệnh 1.000đ; tất cả thành công; TCP tối đa 20; sau idle 6s vẫn thành công                   | Test TH3; phần keepAlive trong báo cáo; kiểm tra cả TCP mới và TCP tổng gồm kết nối đọc stats                                                                         |
| TH4a          | DROP_RATE=0.3: ít nhất 54/60 PAID; còn lại 504/PENDING; duplicates=0; nợ giảm theo PAID                                 | Test TH4a; phần drop trong báo cáo; test riêng PENDING rồi truy lại charge đã trừ                                                                                     |
| TH4b          | FAIL_RATE=0.3: ít nhất 54/60 PAID, không trừ hai lần                                                                    | Test TH4b; phần fail trong báo cáo; test 500 liên tục hết số lần retry                                                                                                |
| TH4c          | Thanh toán 25 triệu: 402, bank chỉ nhận đúng một POST charges                                                           | Test TH4c; phần declined trong báo cáo                                                                                                                                |
| Giới hạn tổng | Retry vẫn giữ thời gian tối đa 4,5s                                                                                     | [BankClient](../src/fee/bank-client.ts), [BankTransport](../src/fee/bank-transport.ts); test và báo cáo slow/drop/fail                                                |
| Số liệu       | Ghi trước/sau: thời gian, kết nối, thành công, charges, duplicates và công nợ                                           | [runner](../scripts/lab-report.ts), [báo cáo Markdown](lab-results.md), [JSON](lab-results.json)                                                                      |

Các test nằm trong [services.test.ts](../test/services.test.ts). `pnpm check` kiểm tra TypeScript strict, ESLint và Prettier; `pnpm build` kiểm tra bản biên dịch. TypeScript và pnpm là các yêu cầu bổ sung của dự án này.

## Đọc số liệu đúng

- `requests` tăng cả khi retry, replay hoặc request charges bị từ chối. `charges` chỉ tăng khi thực sự tạo giao dịch trừ tiền mới.
- Lệnh PENDING có thể đã bị trừ tiền ở bank; vì vậy charges có thể lớn hơn số PAID. Fee vẫn giữ công nợ cho tới khi nhận được xác nhận và chỉ giảm đúng tổng amount của các lệnh PAID.
- TCP mới là chênh lệch trước/sau; TCP tổng bao gồm cả kết nối dùng để đọc stats. Báo cáo hiển thị cả hai, và kiểm tra TCP tổng không quá 20 trong TH3.
- `duplicates` là bộ đếm thật. Test dùng sai hai khóa cho cùng reference cố tình tạo duplicates=1 để chứng minh bộ đếm hoạt động; các luồng thanh toán Fee đúng yêu cầu phải luôn có duplicates=0.
- Đối chứng trong báo cáo là cùng nghiệp vụ với timeout 15s, không retry, không keep-alive. Không trình bày nó như một phiên bản mã nguồn cũ. TH1 và lỗi 4xx có thể đã đạt ở đối chứng.
- Test và runner dùng seed 7 để tái lập lỗi ngẫu nhiên. Hai service chạy bình thường dùng Math.random theo đúng FAIL_RATE/DROP_RATE; số thành công có thể thay đổi giữa các lần chạy.

## Dàn ý demo ngắn

Chuẩn bị `pnpm build`. Dùng các terminal riêng cho Fee, bank và client; các lệnh curl/Postman chi tiết có trong [README](../README.md). Reset cả hai service khi bắt đầu mỗi phép đo độc lập; riêng TH1 phải giữ nguyên tiến trình Fee khi bật bank lại.

1. Giới thiệu sơ đồ hai service, trách nhiệm sở hữu dữ liệu và hợp đồng HTTP. Chỉ ra ba quy tắc nghiệp vụ ở đầu đề.
2. TH1: chạy Fee khi bank tắt, lấy 503 và GET 200; bật bank rồi thanh toán thành công với chính tiến trình Fee đó. Có thể lặp lại bằng BANK_URL trỏ cổng 4999 và BANK_PORT=4999.
3. TH2: bank trễ 5 giây, gửi một lệnh rồi 20 lệnh đồng thời. Cho xem 504/PENDING khoảng 4 giây và GET nhanh khi các lệnh còn đang chờ.
4. TH3: chạy `pnpm bench 200 10 --idle`. Cho xem 200/200, số TCP ở stats và các lệnh thành công sau nhàn rỗi 6 giây. Đối chiếu số liệu keep-alive bật/tắt trong báo cáo.
5. TH4: mỗi cấu hình DROP_RATE=0.3 và FAIL_RATE=0.3 chạy riêng `pnpm bench 60 1`. So PAID, charges, duplicates và công nợ. Với case 25 triệu, dùng bank mới để chứng minh requests đúng bằng 1.
6. Trình bày bảng trước/sau và giải thích tại sao từng cơ chế làm thay đổi số liệu. Chỉ vào test hoặc đoạn code tương ứng khi được hỏi.

## Những ý cần giải thích khi trình bày

- **503 và 504:** 503 là trường hợp chắc chắn chưa trừ; 504 là kết quả chưa rõ. Lệnh từng PENDING vẫn giữ PENDING nếu lần truy lại không kết nối được.
- **Retry an toàn:** giữ nguyên reference, amount và Idempotency-Key. Bank lưu charge trước khi cố tình cắt kết nối và replay charge cũ trước khi áp dụng lỗi ngẫu nhiên.
- **Lỗi 4xx:** ngân hàng đã từ chối rõ ràng, nên dừng ngay. Lỗi 5xx được retry vì hợp đồng ngân hàng lab cam kết chúng xảy ra trước khi trừ tiền.
- **Deadline:** mốc 4 giây bao gồm chờ socket, DNS, kết nối, đọc body, các lần thử và backoff; không tính lại một mốc 4 giây mới cho mỗi lần retry.
- **Keep-alive:** giảm số lần mở TCP; idempotency bảo vệ số lần trừ tiền. Hai cơ chế giải quyết hai vấn đề khác nhau.
- **Giữ chỗ công nợ:** reserved ngăn các lệnh đang chờ cùng tiêu một phần công nợ; outstanding chỉ giảm khi PAID. Retry đồng thời cùng lệnh được gộp để chỉ cập nhật một lần.
- **Bộ nhớ và reset:** đây là yêu cầu lưu trong bộ nhớ của đề. Restart làm mất trạng thái của service tương ứng; cần reset cả hai trước các phép đo độc lập để không trộn reference và số liệu giữa các phiên.

Để nhắm điểm cao, nhóm cần tự chạy lại demo và giải thích được các quyết định trên. Các kiểm thử và số liệu là bằng chứng kỹ thuật; điểm cụ thể do giảng viên đánh giá.
