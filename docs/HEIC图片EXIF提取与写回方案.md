# HEIC 图片 EXIF 提取与写回方案

## 背景

HEIC/HEIF 是 iPhone 等设备默认的拍摄格式，基于 ISO BMFF（Base Media File Format）容器，与 JPEG 的 EXIF 存储方式完全不同。本工具在上传图片时会把 HEIC 无损转成 PNG 用于像素加载（`heic-to` / libheif 只转像素、**不保留 EXIF**），导致：

1. **显示环节**：信息栏读不到相机型号、拍摄时间、GPS 等 EXIF。
2. **导出环节**：导出 JPEG 时无法写回原始 EXIF，拍摄时间/机型信息丢失。

因此需要在转换前，**直接从原始 HEIC 二进制中手动解析并提取 EXIF TIFF 数据**，用于显示与导出写回。

## 底层逻辑：HEIC 里的 EXIF 存在哪

HEIC 的 EXIF 不直接暴露为一段连续字节，而是藏在 `meta` box 的两个子 box 里：

- **`iinf`（Item Info box）**：列出所有 item 的元信息，其中某个 item 的 `item_type` 是 `"Exif"`（4 字节），对应一个 `item_ID`。
- **`iloc`（Item Location box）**：记录每个 `item_ID` 的数据在文件中的 `offset`（偏移）和 `length`（长度）。

提取链路：

```
meta box → iinf（找 item_type="Exif" 的 item_ID）→ iloc（按 item_ID 找 offset/length）
         → 读出 ExifDataBlock → 剥离头部 → 得到纯 TIFF 数据
```

## ExifDataBlock 布局（关键，勿改）

`iloc` 定位到的 Exif item 数据块结构如下（本工具已验证 iPhone 16 Pro 的 HEIC）：

| 偏移 | 长度 | 内容 | 说明 |
|------|------|------|------|
| 0 | 4 | `exif_tiff_header_offset` | 指向 TIFF 头相对「本字段之后」的偏移，通常 = 6 |
| 4 | 6 | `"Exif\0\0"` | 固定签名 |
| 10 | N | TIFF 数据 | 以 `II`（小端）或 `MM`（大端）开头 |

所以 TIFF 起始位置：

```
tiffStart   = extentOffset + 4 + exif_tiff_header_offset   // 4 是 offset 字段本身
tiffLength  = extentLength - 4 - exif_tiff_header_offset
```

> 之前踩过的坑：误写成 `tiffStart = extentOffset + tiffOffset`，漏了 4 字节 offset 字段本身，导致落到 `"if\0\0"` 而不是 TIFF 头 `"MM\0*"`，exifr 报 `Unknown file format`。

## iloc item entry 结构（关键，勿改）

`iloc` 是 FullBox，头部：`version(1) + flags(3)`，随后两个 size 字节：

```
byte 0: offset_size(4bit) | length_size(4bit)
byte 1: base_offset_size(4bit) | (version==2 ? index_size : reserved)(4bit)
item_count: version 0/1 用 2 字节，version 2 用 4 字节
```

每个 item entry 按 version 不同：

| 字段 | version 0 | version 1 | version 2 |
|------|-----------|-----------|-----------|
| item_ID | 2 字节 | 2 字节 | 4 字节 |
| construction_method（reserved 12bit + method 4bit） | ❌ 无 | ✅ 2 字节 | ✅ 2 字节 |
| data_reference_index | 2 字节 | 2 字节 | 2 字节 |
| base_offset | `base_offset_size` 字节 | 同左 | 同左 |
| extent_count | 2 字节 | 2 字节 | 2 字节 |
| extent[] | 每个 `index_size + offset_size + length_size` 字节 | 同左 | 同左 |

> 之前踩过的坑：v1 的 `construction_method`（2 字节）被漏跳，导致后续 item_ID/extent_count 全部错位乱码（item_ID 读出 21063、extent_count 读出 13945 之类的垃圾值）。iPhone 生成的是 version 1，`offset_size=4, length_size=4, base_offset_size=0`。

## 代码结构

实现全部在 `src/utils/index.ts`：

| 函数 | 职责 |
|------|------|
| `extractExifFromHeic(buffer)` | 手动解析 HEIC ISO BMFF，返回纯 TIFF `Uint8Array` |
| `parseExifFromTiff(tiffBuffer)` | 用 exifr 解析 TIFF → `ExifInfo`（exifr 对 TIFF 支持成熟） |
| `extractExifApp1FromBuffer(buffer)` | 按 JPEG/HEIC 分发，产出可注入 JPEG 的 APP1 段 |
| `buildApp1FromTiff(tiffData)` | TIFF 包装成 JPEG APP1（`FF E1 + 长度 + "Exif\0\0" + TIFF`） |
| `injectExifToJpeg(newJpegBlob, originalBuffer)` | 导出 JPEG 时把 APP1 段注入 SOI 之后 |

调用链：

- **上传**（`useWatermark.ts` → `addFiles`）：HEIC 时先 `file.arrayBuffer()` 存 `heicOriginalBuffer` → `extractExifFromHeic` 拿 TIFF → `parseExifFromTiff` 解析显示用 → 再 `heicToPng` 转 PNG 加载像素。最后 `finalExif = heicExif ?? exif`、`finalOriginalBuffer = heicOriginalBuffer ?? originalBuffer`。
- **导出**（`useWatermark.ts` → `exportImageBlob`）：JPEG 导出时 `injectExifToJpeg(blob, originalBuffer)`，`originalBuffer` 是原始 HEIC buffer，`extractExifApp1FromBuffer` 检测到 HEIC 就走 `extractExifFromHeic` + `buildApp1FromTiff` 重建 APP1 段注入。

## 已知限制

- libheif 输出 8-bit，10-bit/HDR HEIC 的高动态范围无法无损保留（仅影响像素，不影响 EXIF 提取）。
- EXIF 写回只对 JPEG 导出有效；PNG 导出不写 EXIF（PNG 标准不承载 EXIF，需走 eXIf 私有 chunk，暂未实现）。
