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
| `extractTiffFromBuffer(buffer)` | 按 JPEG/HEIC 分发，统一返回纯 TIFF（`II`/`MM` 开头） |
| `extractExifApp1FromBuffer(buffer)` | 基于 `extractTiffFromBuffer`，产出可注入 JPEG 的 APP1 段 |
| `buildApp1FromTiff(tiffData)` | TIFF 包装成 JPEG APP1（`FF E1 + 长度 + "Exif\0\0" + TIFF`） |
| `injectExifToJpeg(newJpegBlob, originalBuffer)` | 导出 JPEG 时把 APP1 段注入 SOI 之后 |
| `crc32(bytes)` | PNG 标准 CRC-32（反射多项式 `0xEDB88320`） |
| `buildExifChunk(tiffData)` | 纯 TIFF → PNG eXIf chunk（`length + "eXIf" + TIFF + CRC`） |
| `injectExifToPng(pngBlob, originalBuffer)` | 导出 PNG 时在 IHDR 后、IDAT 前插入 eXIf chunk |

调用链：

- **上传**（`useWatermark.ts` → `addFiles`）：HEIC 时先 `file.arrayBuffer()` 存 `heicOriginalBuffer` → `extractExifFromHeic` 拿 TIFF → `parseExifFromTiff` 解析显示用 → 再 `heicToPng` 转 PNG 加载像素。最后 `finalExif = heicExif ?? exif`、`finalOriginalBuffer = heicOriginalBuffer ?? originalBuffer`。
- **导出**（`HomeView.vue` → `exportWithLut.ts` → `exportComposedBlob`）：按格式写回 EXIF —— JPEG 走 `injectExifToJpeg`（APP1），PNG 走 `injectExifToPng`（eXIf chunk）。`originalBuffer` 是原始文件 buffer（JPEG 或 HEIC），内部统一经 `extractTiffFromBuffer` 拿到纯 TIFF 再包装。

## 已知限制

- libheif 输出 8-bit，10-bit/HDR HEIC 的高动态范围无法无损保留（仅影响像素，不影响 EXIF 提取）。

---

# PNG 导出写回 EXIF 方案（eXIf chunk，已实现）

## 目标

PNG 导出时也把原始 EXIF 写进去，让相机型号、拍摄时间、GPS 等参数在 PNG 里同样可读。

## 原理：PNG 如何存 EXIF

PNG 原生不内置 EXIF 段，但 2017 年 PNG 规范新增了 **`eXIf` 扩展 chunk**，专门完整存放标准 EXIF 二进制数据（相机 / Lightroom / Photoshop / 手机相册导出的 PNG 现在都这么存）。

关键点：**eXIf chunk 的 data 就是纯 TIFF 数据（`II`/`MM` 开头），不带 JPEG APP1 的 `"Exif\0\0"` 前缀**。因为 PNG chunk 靠 4 字节 type 码自识别，不需要那个前缀来消歧。

对比：

| 容器 | EXIF 存放形态 |
|------|--------------|
| JPEG APP1 | `FF E1` + 长度 + `"Exif\0\0"` + TIFF |
| PNG eXIf | chunk 长度 + `"eXIf"` + **纯 TIFF** + CRC |

## 已有能力复用（关键抓手）

我们**已经有纯 TIFF 提取能力**，eXIf 需要的正是它：

- HEIC：`extractExifFromHeic(buffer)` 返回的就是纯 TIFF（`II`/`MM` 开头）——**零改动直接用**。
- JPEG：`extractExifApp1(buffer)` 返回 APP1 段，剥离前 10 字节（`FF E1`(2) + 长度(2) + `"Exif\0\0"`(6)）即得纯 TIFF。

也就是说：**JPEG→PNG 的 EXIF 迁移是「剥一层皮」，HEIC→PNG 是「拿来即用」**，不涉及任何 EXIF 内容重编码。

## 实现清单（已完成）

### 1. `extractTiffFromBuffer(buffer)` —— 统一拿纯 TIFF

按输入源分发：

```
JPEG → extractExifApp1(buffer).slice(10)   // 剥掉 FF E1 + 长度 + "Exif\0\0"
HEIC → extractExifFromHeic(buffer)          // 已经是纯 TIFF
```

### 2. `buildExifChunk(tiffData)` —— 纯 TIFF → eXIf chunk

```
[4字节 length，大端] + "eXIf"(0x65 0x58 0x49 0x66) + tiffData + [4字节 CRC32]
```

### 3. CRC32 实现（PNG 标准）

PNG 用标准 CRC-32（IEEE 802.3，反射多项式 `0xEDB88320`），计算范围是 **type 码 + data**（不含 length，也不含 CRC 自身）。实现为约 20 行的 `crc32(bytes)` 函数。

### 4. `injectExifToPng(pngBlob, originalBuffer)` —— 注入 eXIf chunk

```
校验 PNG 签名(8字节 89 50 4E 47 0D 0A 1A 0A)
→ 解析 chunk 流，定位 IHDR（首个 chunk）的结束位置
→ 在 IHDR 之后、IDAT 之前插入 eXIf chunk
→ 其余字节原样拼接
```

> eXIf 是 ancillary chunk，必须在 **IDAT 之前**（紧跟 IHDR，或 PLTE 之后）。canvas 生成的 PNG 结构是 `签名 + IHDR + IDAT + IEND`，无 PLTE，所以直接插在 IHDR 后即可。

## 调用链改动（已完成）

`src/utils/exportWithLut.ts` → `exportComposedBlob`，JPEG 与 PNG 均写回 EXIF：

```ts
if (originalBuffer) {
  if (format === 'jpeg') {
    const finalBlob = await injectExifToJpeg(blob, originalBuffer)
    return { blob: finalBlob, ext }
  }
  if (format === 'png') {
    const finalBlob = await injectExifToPng(blob, originalBuffer)
    return { blob: finalBlob, ext }
  }
}
return { blob, ext }
```

## 验证

- `pnpm build` 通过（type-check + 打包）。
- CRC-32 实现经标准校验向量 `CRC32("123456789") = 0xCBF43926` 验证，位运算法与查表法结果一致。
- 构造合法 PNG（`签名 + IHDR + IDAT + IEND`）复刻 `injectExifToPng` 插入后回读，chunk 顺序 `IHDR → eXIf → IDAT → IEND`，全部 chunk CRC 校验通过，eXIf 位于 IDAT 之前。

## 兼容性注意

- eXIf 是 ancillary chunk，老软件不识别时会**直接跳过、不报错**，PNG 仍正常打开，只是看不到 EXIF（符合预期）。
- 无 EXIF 源（如网页截图、纯像素图）时 `extractTiffFromBuffer` 返回 null，`injectExifToPng` 直接返回原 PNG，行为与 JPEG 分支一致。
