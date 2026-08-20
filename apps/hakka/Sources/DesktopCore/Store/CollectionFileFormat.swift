import Foundation

/// The byte-level contract for every file the collection store writes.
///
/// `.sortedKeys` is load-bearing, not cosmetic: it is what makes
/// `load(save(x))` produce the *same bytes* as `save(x)` for a given `x`,
/// independent of Swift's (unspecified) synthesized-Codable property order.
/// Pretty-printing plus a trailing newline is what makes the result a
/// reviewable, line-oriented git diff instead of a one-line blob.
enum CollectionFileFormat {
    static let requestExtension = "hakka"
    static let collectionMetadataFilename = "collection.hakka"
    static let folderMetadataFilename = "folder.hakka"
    static let environmentsDirectoryName = "environments"

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    static func makeDecoder() -> JSONDecoder {
        JSONDecoder()
    }

    /// Canonical bytes for `value`: sorted-key, 2-space-indented JSON with exactly
    /// one trailing newline. The same `value` always yields the same `Data`.
    static func encode(_ value: some Encodable) throws -> Data {
        var data = try makeEncoder().encode(value)
        data.append(0x0A)
        return data
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try makeDecoder().decode(type, from: data)
    }

    /// Reserved filenames that name a *container* (collection root or folder),
    /// never a child request, when listing a directory's entries.
    static func isContainerMetadataFilename(_ name: String) -> Bool {
        name == collectionMetadataFilename || name == folderMetadataFilename
    }
}
