# -*- coding: utf-8 -*-
import json
import os

base_path = "data/universities_vietnam.json"
with open(base_path, "r", encoding="utf-8") as f:
    existing = json.load(f)

existing_codes = {s["code"] for s in existing}

additional_schools = [
    # --- KHỐI FPT EDUCATION BỔ SUNG (Greenwich, Swinburne, BTEC, Poly mở rộng) ---
    {
        "code": "FPT-GW-HN",
        "name": "Trường Đại học Greenwich Việt Nam (FPT Greenwich) - Hà Nội",
        "shortName": "Greenwich-HN",
        "provinceCode": "01",
        "wardCode": "001",
        "address": "Tòa nhà FPT, Phố Dịch Vọng Hậu, Quận Cầu Giấy, Hà Nội",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Cầu Giấy", "provinceCode": "01", "wardCode": "001", "address": "Số 2 Phạm Văn Bạch, Yên Hòa, Cầu Giấy, Hà Nội"}
        ],
        "emailDomains": ["fe.edu.vn", "fpt.edu.vn"],
        "dorms": ["Khu trọ Cầu Giấy", "Khu trọ Dịch Vọng Hậu"]
    },
    {
        "code": "FPT-GW-DN",
        "name": "Trường Đại học Greenwich Việt Nam (FPT Greenwich) - Đà Nẵng",
        "shortName": "Greenwich-DN",
        "provinceCode": "48",
        "wardCode": "20215",
        "address": "658 Ngô Quyền, Phường An Hải Bắc, Quận Sơn Trà, Đà Nẵng",
        "campuses": [
            {"id": "c1", "name": "Campus Ngô Quyền", "provinceCode": "48", "wardCode": "20215", "address": "658 Ngô Quyền, Sơn Trà, Đà Nẵng"}
        ],
        "emailDomains": ["fe.edu.vn", "fpt.edu.vn"],
        "dorms": ["Khu trọ An Hải Bắc", "Khu trọ Ngô Quyền"]
    },
    {
        "code": "FPT-GW-HCM",
        "name": "Trường Đại học Greenwich Việt Nam (FPT Greenwich) - TP.HCM",
        "shortName": "Greenwich-HCM",
        "provinceCode": "79",
        "wardCode": "26830",
        "address": "20 Cộng Hòa, Phường 12, Quận Tân Bình, TP.HCM",
        "campuses": [
            {"id": "c1", "name": "Campus Cộng Hòa", "provinceCode": "79", "wardCode": "26830", "address": "20 Cộng Hòa, Q. Tân Bình, TP.HCM"}
        ],
        "emailDomains": ["fe.edu.vn", "fpt.edu.vn"],
        "dorms": ["Khu trọ Cộng Hòa", "Khu trọ Hoàng Hoa Thám"]
    },
    {
        "code": "FPT-GW-CT",
        "name": "Trường Đại học Greenwich Việt Nam (FPT Greenwich) - Cần Thơ",
        "shortName": "Greenwich-CT",
        "provinceCode": "92",
        "wardCode": "31147",
        "address": "Số 160 đường 30/4, Phường An Phú, Quận Ninh Kiều, Cần Thơ",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Ninh Kiều", "provinceCode": "92", "wardCode": "31147", "address": "Số 160 đường 30/4, Q. Ninh Kiều, Cần Thơ"}
        ],
        "emailDomains": ["fe.edu.vn", "fpt.edu.vn"],
        "dorms": ["Khu trọ 30/4 Ninh Kiều"]
    },
    {
        "code": "FPT-SWIN-HN",
        "name": "Swinburne Việt Nam (FPT Swinburne) - Cơ sở Hà Nội",
        "shortName": "Swinburne-HN",
        "provinceCode": "01",
        "wardCode": "001",
        "address": "Số 2 Dương Khuê, Phường Mai Dịch, Quận Cầu Giấy, Hà Nội",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Mai Dịch", "provinceCode": "01", "wardCode": "001", "address": "Số 2 Dương Khuê, Mai Dịch, Cầu Giấy, Hà Nội"}
        ],
        "emailDomains": ["fe.edu.vn", "swin.edu.vn"],
        "dorms": ["Khu trọ Mai Dịch", "Khu trọ Hồ Tùng Mậu"]
    },
    {
        "code": "FPT-SWIN-DN",
        "name": "Swinburne Việt Nam (FPT Swinburne) - Cơ sở Đà Nẵng",
        "shortName": "Swinburne-DN",
        "provinceCode": "48",
        "wardCode": "20215",
        "address": "Số 51 Phan Đăng Lưu, Phường Hòa Cường Bắc, Quận Hải Châu, Đà Nẵng",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Phan Đăng Lưu", "provinceCode": "48", "wardCode": "20215", "address": "51 Phan Đăng Lưu, Hải Châu, Đà Nẵng"}
        ],
        "emailDomains": ["fe.edu.vn", "swin.edu.vn"],
        "dorms": ["Khu trọ Hòa Cường Bắc"]
    },
    {
        "code": "FPT-SWIN-HCM",
        "name": "Swinburne Việt Nam (FPT Swinburne) - Cơ sở TP.HCM",
        "shortName": "Swinburne-HCM",
        "provinceCode": "79",
        "wardCode": "26830",
        "address": "A35 Bạch Đằng, Phường 2, Quận Tân Bình, TP.HCM",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Bạch Đằng", "provinceCode": "79", "wardCode": "26830", "address": "A35 Bạch Đằng, P. 2, Q. Tân Bình, TP.HCM"}
        ],
        "emailDomains": ["fe.edu.vn", "swin.edu.vn"],
        "dorms": ["Khu trọ Tân Bình", "Khu trọ Sân bay"]
    },
    {
        "code": "FPT-BTEC-HN",
        "name": "Cao đẳng Anh Quốc BTEC FPT - Hà Nội",
        "shortName": "BTEC-HN",
        "provinceCode": "01",
        "wardCode": "001",
        "address": "Tòa nhà BTEC FPT, Trịnh Văn Bô, Nam Từ Liêm, Hà Nội",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Trịnh Văn Bô", "provinceCode": "01", "wardCode": "001", "address": "Phố Trịnh Văn Bô, Nam Từ Liêm, Hà Nội"}
        ],
        "emailDomains": ["fpt.edu.vn"],
        "dorms": ["Khu trọ Nam Từ Liêm"]
    },
    {
        "code": "FPT-BTEC-DN",
        "name": "Cao đẳng Anh Quốc BTEC FPT - Đà Nẵng",
        "shortName": "BTEC-DN",
        "provinceCode": "48",
        "wardCode": "20215",
        "address": "66 Võ Văn Tần, Phường Chính Gián, Quận Thanh Khê, Đà Nẵng",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Võ Văn Tần", "provinceCode": "48", "wardCode": "20215", "address": "66 Võ Văn Tần, Thanh Khê, Đà Nẵng"}
        ],
        "emailDomains": ["fpt.edu.vn"],
        "dorms": ["Khu trọ Chính Gián"]
    },
    {
        "code": "FPT-BTEC-HCM",
        "name": "Cao đẳng Anh Quốc BTEC FPT - TP.HCM",
        "shortName": "BTEC-HCM",
        "provinceCode": "79",
        "wardCode": "26830",
        "address": "275 Nguyễn Văn Đậu, Phường 11, Quận Bình Thạnh, TP.HCM",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Nguyễn Văn Đậu", "provinceCode": "79", "wardCode": "26830", "address": "275 Nguyễn Văn Đậu, Bình Thạnh, TP.HCM"}
        ],
        "emailDomains": ["fpt.edu.vn"],
        "dorms": ["Khu trọ Bình Thạnh"]
    },
    {
        "code": "FPTPOLY-HP",
        "name": "Trường Cao đẳng FPT Polytechnic - Hải Phòng",
        "shortName": "FPTPOLY-HP",
        "provinceCode": "31",
        "wardCode": "11575",
        "address": "271 Lê Thánh Tông, Phường Máy Chai, Quận Ngô Quyền, Hải Phòng",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Lê Thánh Tông", "provinceCode": "31", "wardCode": "11575", "address": "271 Lê Thánh Tông, Ngô Quyền, Hải Phòng"}
        ],
        "emailDomains": ["fpt.edu.vn"],
        "dorms": ["Khu trọ Máy Chai"]
    },
    {
        "code": "FPTPOLY-DON",
        "name": "Trường Cao đẳng FPT Polytechnic - Đồng Nai",
        "shortName": "FPTPOLY-ĐNai",
        "provinceCode": "75",
        "wardCode": "25990",
        "address": "Tòa nhà FPT Polytechnic, TP. Biên Hòa, Đồng Nai",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Biên Hòa", "provinceCode": "75", "wardCode": "25990", "address": "TP. Biên Hòa, Đồng Nai"}
        ],
        "emailDomains": ["fpt.edu.vn"],
        "dorms": ["Khu trọ Biên Hòa"]
    },
    {
        "code": "FPTPOLY-TH",
        "name": "Trường Cao đẳng FPT Polytechnic - Thanh Hóa",
        "shortName": "FPTPOLY-TH",
        "provinceCode": "38",
        "wardCode": "16360",
        "address": "Lô 2, Khu đô thị Nam TP. Thanh Hóa, Thanh Hóa",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Thanh Hóa", "provinceCode": "38", "wardCode": "16360", "address": "TP. Thanh Hóa, Thanh Hóa"}
        ],
        "emailDomains": ["fpt.edu.vn"],
        "dorms": ["Khu trọ TP Thanh Hóa"]
    },
    {
        "code": "FPTPOLY-QN",
        "name": "Trường Cao đẳng FPT Polytechnic - Quy Nhơn",
        "shortName": "FPTPOLY-QN",
        "provinceCode": "52",
        "wardCode": "21517",
        "address": "Khu đô thị An Phú Thịnh, Phường Nhơn Bình, TP. Quy Nhơn, Bình Định",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Quy Nhơn", "provinceCode": "52", "wardCode": "21517", "address": "An Phú Thịnh, Quy Nhơn"}
        ],
        "emailDomains": ["fpt.edu.vn"],
        "dorms": ["Khu trọ An Phú Thịnh"]
    },

    # --- KHỐI ĐẠI HỌC TP. HỒ CHÍ MINH BỔ SUNG ---
    {
        "code": "FLI",
        "name": "Trường Đại học Ngoại ngữ - Tin học TP.HCM",
        "shortName": "HUFLIT",
        "provinceCode": "79",
        "wardCode": "27139",
        "address": "828 Sư Vạn Hạnh, Phường 13, Quận 10, TP.HCM",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Sư Vạn Hạnh", "provinceCode": "79", "wardCode": "27139", "address": "828 Sư Vạn Hạnh, Q. 10, TP.HCM"},
            {"id": "c2", "name": "Cơ sở Hóc Môn", "provinceCode": "79", "wardCode": "26830", "address": "Tân Hiệp, Hóc Môn, TP.HCM"}
        ],
        "emailDomains": ["huflit.edu.vn"],
        "dorms": ["Khu trọ Sư Vạn Hạnh", "Khu trọ Tô Hiến Thành"]
    },
    {
        "code": "STU",
        "name": "Trường Đại học Công nghệ Sài Gòn",
        "shortName": "STU",
        "provinceCode": "79",
        "wardCode": "27196",
        "address": "180 Cao Lỗ, Phường 4, Quận 8, TP.HCM",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Cao Lỗ", "provinceCode": "79", "wardCode": "27196", "address": "180 Cao Lỗ, Q. 8, TP.HCM"}
        ],
        "emailDomains": ["stu.edu.vn"],
        "dorms": ["Khu trọ Cao Lỗ", "Khu trọ Tạ Quang Bửu Q8"]
    },
    {
        "code": "SIU",
        "name": "Trường Đại học Quốc tế Sài Gòn",
        "shortName": "SIU",
        "provinceCode": "79",
        "wardCode": "26830",
        "address": "8C Tống Hữu Định, Phường Thảo Điền, TP. Thủ Đức, TP.HCM",
        "campuses": [
            {"id": "c1", "name": "Campus Thảo Điền", "provinceCode": "79", "wardCode": "26830", "address": "8C Tống Hữu Định, Thảo Điền, TP. Thủ Đức"}
        ],
        "emailDomains": ["siu.edu.vn"],
        "dorms": ["Khu trọ Thảo Điền", "Khu trọ Trần Não"]
    },
    {
        "code": "VAA",
        "name": "Học viện Hàng không Việt Nam",
        "shortName": "VAA",
        "provinceCode": "79",
        "wardCode": "26830",
        "address": "104 Nguyễn Văn Trỗi, Phường 8, Quận Phú Nhuận, TP.HCM",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Nguyễn Văn Trỗi", "provinceCode": "79", "wardCode": "26830", "address": "104 Nguyễn Văn Trỗi, Phú Nhuận, TP.HCM"}
        ],
        "emailDomains": ["vaa.edu.vn"],
        "dorms": ["KTX Học viện Hàng không"]
    },

    # --- KHỐI ĐẠI HỌC HÀ NỘI BỔ SUNG ---
    {
        "code": "DKD",
        "name": "Trường Đại học Kinh doanh và Công nghệ Hà Nội",
        "shortName": "HUBT",
        "provinceCode": "01",
        "wardCode": "001",
        "address": "Số 29A, Ngõ 124 Phố Vĩnh Tuy, Quận Hai Bà Trưng, Hà Nội",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Vĩnh Tuy", "provinceCode": "01", "wardCode": "001", "address": "29A Ngõ 124 Vĩnh Tuy, Hai Bà Trưng, Hà Nội"}
        ],
        "emailDomains": ["hubt.edu.vn"],
        "dorms": ["Khu trọ Vĩnh Tuy", "Khu trọ Minh Khai"]
    },
    {
        "code": "MHN",
        "name": "Trường Đại học Mở Hà Nội",
        "shortName": "HOU",
        "provinceCode": "01",
        "wardCode": "001",
        "address": "Nhà B101, Đường Nguyễn Hiền, Quận Hai Bà Trưng, Hà Nội",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Nguyễn Hiền", "provinceCode": "01", "wardCode": "001", "address": "Đường Nguyễn Hiền, Bách Khoa, Hai Bà Trưng, Hà Nội"}
        ],
        "emailDomains": ["hou.edu.vn"],
        "dorms": ["Khu trọ Bách Khoa", "Khu trọ Nguyễn Hiền"]
    },
    {
        "code": "DMT",
        "name": "Trường Đại học Tài nguyên và Môi trường Hà Nội",
        "shortName": "HUNRE",
        "provinceCode": "01",
        "wardCode": "001",
        "address": "Số 41A, Đường Phú Diễn, Phường Phú Diễn, Quận Bắc Từ Liêm, Hà Nội",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Phú Diễn", "provinceCode": "01", "wardCode": "001", "address": "41A Phú Diễn, Bắc Từ Liêm, Hà Nội"}
        ],
        "emailDomains": ["hunre.edu.vn"],
        "dorms": ["KTX Tài nguyên Môi trường", "Khu trọ Phú Diễn"]
    },
    {
        "code": "LDA",
        "name": "Trường Đại học Công đoàn",
        "shortName": "TUU",
        "provinceCode": "01",
        "wardCode": "001",
        "address": "169 Tây Sơn, Phường Quang Trung, Quận Đống Đa, Hà Nội",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Tây Sơn", "provinceCode": "01", "wardCode": "001", "address": "169 Tây Sơn, Đống Đa, Hà Nội"}
        ],
        "emailDomains": ["dhcd.edu.vn"],
        "dorms": ["KTX Đại học Công đoàn", "Khu trọ Tây Sơn"]
    },
    {
        "code": "SP2",
        "name": "Trường Đại học Sư phạm Hà Nội 2",
        "shortName": "HPU2",
        "provinceCode": "26",
        "wardCode": "09985",
        "address": "Số 32 Đường Nguyễn Văn Linh, Phường Xuân Hòa, TP. Phúc Yên, Vĩnh Phúc",
        "campuses": [
            {"id": "c1", "name": "Campus Xuân Hòa", "provinceCode": "26", "wardCode": "09985", "address": "32 Nguyễn Văn Linh, Xuân Hòa, Phúc Yên, Vĩnh Phúc"}
        ],
        "emailDomains": ["hpu2.edu.vn"],
        "dorms": ["KTX Sư phạm Hà Nội 2", "Khu trọ Xuân Hòa"]
    },
    {
        "code": "SKH",
        "name": "Trường Đại học Sư phạm Kỹ thuật Hưng Yên",
        "shortName": "UTEHY",
        "provinceCode": "33",
        "wardCode": "12685",
        "address": "Xã Dân Tiến, Huyện Khoái Châu, Hưng Yên",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Dân Tiến (Khoái Châu)", "provinceCode": "33", "wardCode": "12685", "address": "Dân Tiến, Khoái Châu, Hưng Yên"}
        ],
        "emailDomains": ["utehy.edu.vn"],
        "dorms": ["KTX UTEHY", "Khu trọ Khoái Châu"]
    },
    {
        "code": "SKN",
        "name": "Trường Đại học Sư phạm Kỹ thuật Nam Định",
        "shortName": "NUTE",
        "provinceCode": "36",
        "wardCode": "14140",
        "address": "Phù Nghĩa, Lộc Hạ, TP. Nam Định, Nam Định",
        "campuses": [
            {"id": "c1", "name": "Cơ sở TP. Nam Định", "provinceCode": "36", "wardCode": "14140", "address": "Phù Nghĩa, Lộc Hạ, Nam Định"}
        ],
        "emailDomains": ["nute.edu.vn"],
        "dorms": ["KTX NUTE"]
    },
    {
        "code": "HLU-QN",
        "name": "Trường Đại học Hạ Long",
        "shortName": "HLU-QN",
        "provinceCode": "22",
        "wardCode": "08005",
        "address": "Số 258 Đường Bạch Đằng, Phường Nam Khê, TP. Uông Bí, Quảng Ninh",
        "campuses": [
            {"id": "c1", "name": "Cơ sở 1 (Uông Bí)", "provinceCode": "22", "wardCode": "08005", "address": "258 Bạch Đằng, Nam Khê, Uông Bí, Quảng Ninh"}
        ],
        "emailDomains": ["daihochalong.edu.vn"],
        "dorms": ["KTX Đại học Hạ Long"]
    },

    # --- KHỐI ĐẠI HỌC MIỀN TRUNG BỔ SUNG ---
    {
        "code": "SKV",
        "name": "Trường Đại học Sư phạm Kỹ thuật Vinh",
        "shortName": "VUTED",
        "provinceCode": "40",
        "wardCode": "18025",
        "address": "Đường Nguyễn Viết Xuân, Phường Hưng Dũng, TP. Vinh, Nghệ An",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Nguyễn Viết Xuân", "provinceCode": "40", "wardCode": "18025", "address": "Nguyễn Viết Xuân, Hưng Dũng, TP. Vinh"}
        ],
        "emailDomains": ["vuted.edu.vn"],
        "dorms": ["KTX VUTED", "Khu trọ Hưng Dũng"]
    },
    {
        "code": "YKV",
        "name": "Trường Đại học Y khoa Vinh",
        "shortName": "VMU-Vinh",
        "provinceCode": "40",
        "wardCode": "18025",
        "address": "161 Lê Viết Thuật, Xã Hưng Lộc, TP. Vinh, Nghệ An",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Lê Viết Thuật", "provinceCode": "40", "wardCode": "18025", "address": "161 Lê Viết Thuật, TP. Vinh"}
        ],
        "emailDomains": ["vmu.edu.vn"],
        "dorms": ["KTX Y khoa Vinh"]
    },
    {
        "code": "HDT",
        "name": "Trường Đại học Hồng Đức (Thanh Hóa)",
        "shortName": "HDU",
        "provinceCode": "38",
        "wardCode": "16360",
        "address": "565 Quang Trung, Phường Đông Vệ, TP. Thanh Hóa, Thanh Hóa",
        "campuses": [
            {"id": "c1", "name": "Cơ sở chính Quang Trung", "provinceCode": "38", "wardCode": "16360", "address": "565 Quang Trung, Đông Vệ, TP. Thanh Hóa"}
        ],
        "emailDomains": ["hdu.edu.vn"],
        "dorms": ["KTX Hồng Đức"]
    },
    {
        "code": "DHT-TH",
        "name": "Trường Đại học Văn hóa, Thể thao và Du lịch Thanh Hóa",
        "shortName": "DVHTTDL",
        "provinceCode": "38",
        "wardCode": "16360",
        "address": "Số 561 Quang Trung, Phường Đông Vệ, TP. Thanh Hóa",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Đông Vệ", "provinceCode": "38", "wardCode": "16360", "address": "561 Quang Trung, TP. Thanh Hóa"}
        ],
        "emailDomains": ["dvhttdl.edu.vn"],
        "dorms": ["KTX trường"]
    },
    {
        "code": "DHT-HT",
        "name": "Trường Đại học Hà Tĩnh",
        "shortName": "HTU-HT",
        "provinceCode": "42",
        "wardCode": "18565",
        "address": "Xã Cẩm Vịnh, Huyện Cẩm Xuyên, Hà Tĩnh",
        "campuses": [
            {"id": "c1", "name": "Campus Cẩm Vịnh", "provinceCode": "42", "wardCode": "18565", "address": "Cẩm Vịnh, Cẩm Xuyên, Hà Tĩnh"}
        ],
        "emailDomains": ["htu.edu.vn"],
        "dorms": ["KTX Đại học Hà Tĩnh"]
    },
    {
        "code": "DQB",
        "name": "Trường Đại học Quảng Bình",
        "shortName": "QBU",
        "provinceCode": "44",
        "wardCode": "19100",
        "address": "312 Lý Thường Kiệt, Phường Đồng Phú, TP. Đồng Hới, Quảng Bình",
        "campuses": [
            {"id": "c1", "name": "Campus Đồng Hới", "provinceCode": "44", "wardCode": "19100", "address": "312 Lý Thường Kiệt, TP. Đồng Hới"}
        ],
        "emailDomains": ["qbu.edu.vn"],
        "dorms": ["KTX Đại học Quảng Bình"]
    },
    {
        "code": "DQN-QNA",
        "name": "Trường Đại học Quảng Nam",
        "shortName": "QNU-QN",
        "provinceCode": "49",
        "wardCode": "20500",
        "address": "102 Hùng Vương, TP. Tam Kỳ, Quảng Nam",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Hùng Vương", "provinceCode": "49", "wardCode": "20500", "address": "102 Hùng Vương, Tam Kỳ, Quảng Nam"}
        ],
        "emailDomains": ["qnamuni.edu.vn"],
        "dorms": ["KTX Đại học Quảng Nam"]
    },
    {
        "code": "DPT",
        "name": "Trường Đại học Phan Thiết",
        "shortName": "UPT",
        "provinceCode": "60",
        "wardCode": "23230",
        "address": "225 Nguyễn Thông, Phường Phú Hài, TP. Phan Thiết, Bình Thuận",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Phú Hài", "provinceCode": "60", "wardCode": "23230", "address": "225 Nguyễn Thông, Phan Thiết"}
        ],
        "emailDomains": ["upt.edu.vn"],
        "dorms": ["KTX Đại học Phan Thiết"]
    },
    {
        "code": "BMTU",
        "name": "Trường Đại học Y Dược Buôn Ma Thuột",
        "shortName": "BMTU",
        "provinceCode": "66",
        "wardCode": "24220",
        "address": "298 Hà Huy Tập, Phường Tân An, TP. Buôn Ma Thuột, Đắk Lắk",
        "campuses": [
            {"id": "c1", "name": "Campus Hà Huy Tập", "provinceCode": "66", "wardCode": "24220", "address": "298 Hà Huy Tập, Buôn Ma Thuột"}
        ],
        "emailDomains": ["bmtu.edu.vn"],
        "dorms": ["KTX BMTU"]
    },

    # --- KHỐI ĐẠI HỌC MIỀN TÂY BỔ SUNG ---
    {
        "code": "DTG",
        "name": "Trường Đại học Tiền Giang",
        "shortName": "TGU",
        "provinceCode": "82",
        "wardCode": "29140",
        "address": "119 Ấp Bắc, Phường 5, TP. Mỹ Tho, Tiền Giang",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Thân Cửu Nghĩa", "provinceCode": "82", "wardCode": "29140", "address": "Thân Cửu Nghĩa, Châu Thành, Tiền Giang"}
        ],
        "emailDomains": ["tgu.edu.vn"],
        "dorms": ["KTX Đại học Tiền Giang"]
    },
    {
        "code": "DBL",
        "name": "Trường Đại học Bạc Liêu",
        "shortName": "BLU",
        "provinceCode": "95",
        "wardCode": "31720",
        "address": "178 Võ Thị Sáu, Phường 8, TP. Bạc Liêu, Bạc Liêu",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Võ Thị Sáu", "provinceCode": "95", "wardCode": "31720", "address": "178 Võ Thị Sáu, TP. Bạc Liêu"}
        ],
        "emailDomains": ["blu.edu.vn"],
        "dorms": ["KTX Đại học Bạc Liêu"]
    },
    {
        "code": "DCL",
        "name": "Trường Đại học Cửu Long",
        "shortName": "MKU",
        "provinceCode": "86",
        "wardCode": "29900",
        "address": "Quốc lộ 1A, Xã Phú Quới, Huyện Long Hồ, Vĩnh Long",
        "campuses": [
            {"id": "c1", "name": "Campus Phú Quới", "provinceCode": "86", "wardCode": "29900", "address": "QL1A, Phú Quới, Long Hồ, Vĩnh Long"}
        ],
        "emailDomains": ["mku.edu.vn"],
        "dorms": ["KTX Cửu Long"]
    },
    {
        "code": "SKL",
        "name": "Trường Đại học Sư phạm Kỹ thuật Vĩnh Long",
        "shortName": "VLUTE",
        "provinceCode": "86",
        "wardCode": "29900",
        "address": "73 Nguyễn Huệ, Phường 2, TP. Vĩnh Long, Vĩnh Long",
        "campuses": [
            {"id": "c1", "name": "Cơ sở Nguyễn Huệ", "provinceCode": "86", "wardCode": "29900", "address": "73 Nguyễn Huệ, TP. Vĩnh Long"}
        ],
        "emailDomains": ["vlute.edu.vn"],
        "dorms": ["KTX VLUTE"]
    }
]

added_count = 0
for school in additional_schools:
    if school["code"] not in existing_codes:
        existing.append(school)
        existing_codes.add(school["code"])
        added_count += 1

with open(base_path, "w", encoding="utf-8") as f:
    json.dump(existing, f, ensure_ascii=False, indent=2)

print(f"Added {added_count} new schools. Total now: {len(existing)} universities across Vietnam.")
