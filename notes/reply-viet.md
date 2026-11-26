# Trả lời Việt — feedback bản demo (26/11/2026)

Cảm ơn Việt test kỹ nha. Mình đã sửa hết và push lên `main`, Render đã deploy lại bản mới
(https://smart-emobility-hub.onrender.com — lần đầu mở có thể mất ~1 phút để server thức dậy).
Mọi người dùng chung một trạng thái demo, nên nếu thấy số liệu lạ thì bấm **Reset demo** trước khi test.

Dưới đây là từng điểm theo thứ tự Việt gửi.

---

## A. Thuê lần 2 không hiện màn hình quét

Lỗi này đã được sửa trong commit `039aafa` (tối 25/11), nhưng Việt test lúc 17:52 cùng ngày,
**trước khi bản đó được deploy**, nên vẫn gặp. Mình đã test lại 3 vòng liên tiếp
thuê → trả → thuê → quét, **không cần Reset**:

- từ vé (ticket) đặt xe → có màn hình quét ✔
- từ banner trên màn Find a Hub → có ✔
- từ tab Trip → có ✔
- tab Bookings dùng cùng một đường dẫn với vé nên cũng chạy.

Nếu Việt vẫn gặp lại thì nhắn mình giờ test + mã xe nhé.

## B. Mô tả sự cố (INC-0194) bị tràn ra ngoài card

Giờ mô tả nằm trong một card riêng có nhãn **"Description"**, tự xuống dòng (giữ cả xuống dòng
của sinh viên), không tràn ngang dù text rất dài, chữ dính liền hay tiếng Việt có dấu. Nếu sinh
viên không ghi gì thì hiện "No description given.".

## C. Điều phối chỉ 1-đối-1

Đã đổi thành **một Hub quá tải → nhiều Hub gần đó**:

- Hub nào vượt ngưỡng an toàn **70 %** (Busy) thì phần dư = số xe cần chuyển đi để về lại 70 %.
- Chuyển tới **Hub gần nhất trước**, mỗi Hub chỉ nhận tới khi chạm 70 % của nó (dock đã hứa cho
  lệnh khác cũng tính là đã đầy), rồi sang Hub gần kế tiếp, cho tới khi hết phần dư.
- Nếu không đủ xe đủ điều kiện (ví dụ H02 chỉ có 4 e-bike đủ pin, còn lại đang chờ sạc) hay không
  còn Hub nào có chỗ thì hệ thống ghi rõ lý do.

Áp dụng ở cả 3 chỗ: gợi ý ở **Redistribution orders** (mỗi chặng một dòng, "leg 1 of 3"…), panel
Hub ở **Network monitor** (danh sách "Redistribution plan" với nút **Create order** cho từng chặng
và "room for N before 70 %" cho từng Hub gần), và đề xuất của **What-if**. UC-14 Apply tạo được
nhiều lệnh chuyển cùng lúc. Có test cho phần này.

## D. Scenario C khó hiểu, Apply xong không khớp

Nguyên nhân: lúc Apply, hệ thống chỉ chạy lại lịch sạc bình thường, **quên mất các trụ bị hỏng**,
nên Smart charging không giống kết quả mô phỏng.

Giờ:

- Kết quả mô phỏng có bảng **Normal vs With failure** (số phiên được sạc, số yêu cầu chưa được
  phục vụ, thời gian chờ, công suất đỉnh so với giới hạn 55 kW).
- Bảng **từng phiên** đang nằm trên trụ hỏng và nó đi đâu: *moved* (sang trụ khác), *shifted*
  (bị dời để nhường chỗ), *stops early* (đang sạc thì trụ hỏng), *unserved* (không xếp được),
  *cancelled, fee refunded* (phiên đã trả tiền mà không dời được trong 15 phút).
- Apply sẽ **giữ trống các trụ đó trong khung giờ** (trụ vẫn In Service, chỉ không xếp phiên nào
  vào) và lưu đúng lịch đã mô phỏng. Bấm **Open charging schedule** → Smart charging mở đúng khung
  giờ đó, trụ bị giữ có dải gạch chéo "Kept free · what-if", các phiên nằm **y như mô phỏng**.
  Generate lại lịch thì khung giờ đó vẫn được giữ tới khi hết.
- Nếu khung giờ mô phỏng nằm ở **tương lai** (ví dụ bây giờ 14:36, mô phỏng 15:00–17:00) thì
  màn kết quả có banner nói rõ: Apply chỉ đổi khung giờ đó, các phiên trước đó giữ nguyên.

**Cách test scenario C:**

1. Operator → What-if simulation → chọn **C · Charging-point failure**, Hub **H02**,
   khung 15:00–17:00, tick **CP-H02-02** và **CP-H02-06** → **Run simulation**.
2. Xem bảng Normal / With failure và bảng các phiên bị ảnh hưởng (với seed hiện tại: 10 → 9 phiên
   được sạc, EM-0104 chuyển từ CP-H02-02 sang CP-H02-03, 2 phiên bị dời, 1 phiên thành unserved, và EB-0260 đang sạc trên CP-H02-02 sẽ dừng sớm).
3. Tick đề xuất "Re-plan charging at H02 without …" → **Apply 1 selected…** → **Confirm**.
4. Bấm **Open charging schedule · H02** và so với bảng ở bước 2: phải khớp từng phiên.

Hướng dẫn này cũng có trong `DEMO-SCRIPT.md`.

## E. Smart charging từ chối vì "vượt 55 kW" trên CP-H02-06

Phần kiểm tra **đúng**, chỉ là thông báo cũ không ghi rõ nên dễ hiểu nhầm. Công thức thực tế:

```
tải(slot) = tổng công suất định mức của mọi trụ đang có phiên sạc trong slot 15 phút đó
            (trụ AC 7 kW tính 7 kW, trụ AC 22 kW tính 22 kW — không chia đều, không theo % pin)
giới hạn  = round(0.76 × tổng công suất lắp đặt của Hub)
H02: 4 trụ × 7 kW + 2 trụ × 22 kW = 72 kW  →  giới hạn = round(0.76 × 72) = 55 kW
```

- Khi kéo một phiên, phiên đó được **bỏ ra khỏi vị trí cũ trước** rồi mới tính, nên không bị tính 2 lần.
- Phiên **đang sạc** (khóa) vẫn được tính vì nó đang thật sự kéo điện.
- Trụ **Out of Service** không có phiên nên không tính.

Trường hợp của Việt: ở slot đó đã có **36 kW** (CP-H02-02 7 + CP-H02-04 7 + CP-H02-05 22), thêm
phiên vào **CP-H02-06 là trụ 22 kW** → 36 + 22 = **58 kW > 55 kW** nên bị từ chối. Con số 48 kW
có lẽ là tính trụ đó như 7 kW hoặc chưa cộng CP-H02-05. Nói cách khác: ở H02, muốn thêm một phiên
vào trụ 22 kW thì slot đó phải đang có tối đa 33 kW; vào trụ 7 kW thì tối đa 48 kW.

Giờ thông báo ghi đủ các con số. Ví dụ với dữ liệu seed, kéo CQ-WJ32 sang CP-H02-06 lúc 15:15:
*"At 15:15 the Hub would draw 65 kW: 43 kW already planned (CP-H02-01 7 + CP-H02-03 7 +
CP-H02-04 7 + CP-H02-05 22) + 22 kW for CP-H02-06. The limit is 55 kW (76% of the 72 kW
installed)."* Biểu đồ tải bên dưới timeline hiện số kW trên từng cột, rê chuột vào cột sẽ
thấy các phiên đang góp vào slot đó. Rê chuột vào block cũng thấy kW của trụ.

---

## 1. Thẻ Hub không đếm theo bộ lọc loại xe

Đã sửa: khi chọn E-bike / E-motorbike (hoặc lọc % pin), số trên thẻ chỉ đếm xe đúng loại đó, và
nhãn đổi thành "E-bikes available" / "E-motorbikes available". Ví dụ H03: 29 xe → 9 e-motorbike.

## 2. Tạo lệnh mới: kiểm tra bị "đứng" (31 ≥ 1)

Do câu trả lời kiểm tra cũ về sau đè lên câu mới. Giờ câu trả lời cũ bị bỏ, kiểm tra cập nhật
ngay khi đổi Hub hay số lượng, nút **Confirm** bị khóa cho tới khi có kết quả kiểm tra của form
hiện tại và nó hợp lệ. Ví dụ H03 → H02, 5 xe: "Destination net free docks · 1 free · 5 needed" và
chặn. Server cũng kiểm tra lại khi lưu nên dù có gọi API trực tiếp cũng không tạo được lệnh sai.

## 3. What-if: đề xuất chuyển xe vào H02 (97 %) và lấy xe từ H04 (đang thiếu)

- Không còn chuyển xe **vào** Hub đã trên 70 %; thay vào đó có ghi chú "No transfer into H02: it is
  at 97 %…" và gợi ý sạc xe yếu pin / hướng sinh viên sang Hub khác.
- Không lấy xe từ Hub đang bị cờ **Vehicle Shortage**.
- Form khi mở lại giờ hiện **đúng tham số** của kết quả đang xem.
- Nhập 500 % thì báo **Invalid** ngay khi gõ (cho phép −90 % đến +300 %), nút Run bị khóa, không
  cần bấm Rerun mới biết.
- Mở mô phỏng từ một Hub khác thì kết quả cũ (của Hub khác) bị bỏ, không lẫn lộn.

## 4. Scenario B: H02 tràn 24 mà không có đề xuất cho H02

Đúng là thiếu — B trước đây chỉ đề xuất cho Hub thiếu xe. Giờ với mỗi Hub bị tràn, B đề xuất
**chuyển xe ra** theo cùng quy tắc ở mục C (gần trước, tối đa 70 %), và gợi ý **hướng sinh viên
đang trả xe** sang Hub khác (ví dụ "Send 20 returning students from H02 to H05 …").

## 5. Bảng Hubs bên Operator bị cắt cột LAST UPDATE ở 1440

Đã sửa, kiểm tra ở cả 1440 và 1280 px: cột cờ tự xuống dòng, cột LAST UPDATE luôn hiện đủ.

## 6. Bên Student

- **Nút ngôi sao** trong Hub detail giờ là **Yêu thích** thật: bấm để thêm/bỏ, lưu theo trình
  duyệt, Hub yêu thích được xếp lên đầu ở Find a Hub và có ngôi sao trên thẻ.
- **H06 (mất kết nối)**: tab Parking và Charging giờ hiện "Last update … — counts may have
  changed" thay vì "Updated" xanh, và nút **Reserve parking / Schedule charging** bị khóa
  (UC-01 E1). Server cũng từ chối nếu ai cố đặt.
- **"Find a space" báo lỗi tận dưới**: lỗi giờ hiện ngay **phía trên nút** và tự cuộn tới.

## 7. Smart charging + /stage

- Nhãn đỏ "now" không còn che nhãn giờ.
- Block ngắn ("CS-7…") giờ bỏ icon khóa để đủ chỗ cho chữ; rê chuột vào thấy đủ thông tin.
- Trên **/stage**, thanh icon bên trái của Operator giờ **dính cố định** khi cuộn (nguyên nhân là
  một thuộc tính CSS `overflow: hidden` làm hỏng sticky).

## 8. Thiếu kịch bản "tăng nhu cầu sạc"

Đúng là đề bài có ("a surge in charging demand"), mình đã thêm **D · Charging demand surge**,
chạy đủ từ đầu tới cuối:

- Nhập số yêu cầu sạc thêm (1–60) trong khung giờ, mỗi yêu cầu cần 1 giờ trên một trụ.
- Hệ thống tìm cách **giữ trống vài trụ** trong khung giờ để phục vụ được nhiều yêu cầu nhất, và
  so sánh trước/sau: số yêu cầu được phục vụ, thời gian chờ, và cái giá cho xe dùng chung
  (ví dụ H02, 8 yêu cầu: phục vụ 4 → 6/12, chờ 75 → 35 phút, giữ trống CP-H02-01, CP-H02-02).
- **Apply** giống scenario C: giữ trống các trụ đó trong khung giờ và lưu lịch; phiên nào đang
  sạc trên trụ đó thì sạc nốt.

---

Tổng cộng có thêm 12 test mới (giờ là 94 test, chạy `npm test`), tài liệu cập nhật trong
`HANDOFF.md` (mục "Teammate feedback round") và `DEMO-SCRIPT.md`. Có gì Việt cứ nhắn tiếp nha!
