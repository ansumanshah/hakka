import Foundation

/// Decompresses gzip-encoded bodies (`Content-Encoding: gzip`/`x-gzip`,
/// base64-encoded bytes). Port of `decoders.ts`'s `gzipDecoder`.
struct GzipBodyDecoder: HakkaBodyDecoder {
    let id = "gzip"

    func decode(_ body: String, contentType: String?, contentEncoding: String?) -> String? {
        guard hakkaHasEncoding(contentEncoding, token: "gzip") || hakkaHasEncoding(contentEncoding, token: "x-gzip") else {
            return nil
        }
        guard looksLikeGzipBase64(body) else { return nil }
        guard let bytes = hakkaBase64Decode(body) else { return nil }
        guard let decompressed = InflateSupport.gunzip(bytes) else { return nil }
        return String(decoding: decompressed, as: UTF8.self)
    }
}

/// Decompresses deflate/zlib-encoded bodies (`Content-Encoding: deflate`).
/// Port of `decoders.ts`'s `deflateDecoder`.
struct DeflateBodyDecoder: HakkaBodyDecoder {
    let id = "deflate"

    func decode(_ body: String, contentType: String?, contentEncoding: String?) -> String? {
        guard hakkaHasEncoding(contentEncoding, token: "deflate") else { return nil }
        guard looksLikeDeflateBase64(body) else { return nil }
        guard let bytes = hakkaBase64Decode(body) else { return nil }
        guard let decompressed = InflateSupport.inflate(bytes) else { return nil }
        return String(decoding: decompressed, as: UTF8.self)
    }
}

/// True when `body` is base64-encoded bytes starting with the gzip magic
/// (0x1f 0x8b). Only called after Content-Encoding already signals gzip — a
/// cheap guard against re-decoding already-decoded text. Port of
/// `decoders.ts`'s `looksLikeGzipBase64`.
private func looksLikeGzipBase64(_ body: String) -> Bool {
    guard body.count >= 4 else { return false }
    guard let prefix = hakkaBase64Decode(String(body.prefix(4))), prefix.count >= 2 else { return false }
    return prefix[0] == 0x1f && prefix[1] == 0x8b
}

/// True when `body` looks like base64-encoded compressed deflate bytes:
/// zlib-wrapped (CMF byte 0x78 with a recognized FLG) or a raw-deflate
/// candidate (any valid base64 — decompression itself validates raw deflate).
/// Port of `decoders.ts`'s `looksLikeDeflateBase64`.
private func looksLikeDeflateBase64(_ body: String) -> Bool {
    guard body.count >= 4 else { return false }
    guard let prefix = hakkaBase64Decode(String(body.prefix(4))), prefix.count >= 2 else { return false }
    if prefix[0] == 0x78 {
        let flg = prefix[1]
        return flg == 0x01 || flg == 0x5e || flg == 0x9c || flg == 0xda
    }
    return true
}
