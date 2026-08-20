import HakkaCommon

/// On-disk envelopes. These wrap the domain model (`Collection`/`Folder`/
/// `RequestSpec`, defined in `Collection.swift`) with store-only bookkeeping
/// that has no business living in the domain model itself:
///
/// - `seq` preserves display order without baking order into filenames, so
///   reordering never renames a file (Bruno's approach — order lives in the
///   file content, not the path).
/// - `Folder.children` and `Collection.nodes` are never serialized here; a
///   directory's own listing IS that data, re-derived on every `load`.

/// The format version stamped into every collection's metadata file.
///
/// These files are committed to other people's repositories and outlive any
/// one build of this app, so a reader needs to know what it is looking at
/// before it decodes. Bumping this is how a future incompatible layout change
/// becomes a clear "this collection needs a newer Hakka" message instead of a
/// `DecodingError` about a missing key.
///
/// Decoding is deliberately tolerant of a MISSING version (files written by
/// the pre-versioning build read as version 1) and of a LOWER version, and
/// refuses a HIGHER one — forward compatibility is a promise this format does
/// not make.
public let collectionFormatVersion = 1

struct CollectionMetadataFile: Codable, Equatable, Sendable {
    var version: Int?
    var id: String
    var name: String
    var defaultHeaders: [HeaderPair]
    var auth: AuthSpec
    var notes: String?

    /// The version this file claims, treating absence as the original format.
    var effectiveVersion: Int { version ?? 1 }
}

struct FolderFile: Codable, Equatable, Sendable {
    var seq: Int
    var id: String
    var name: String
    var headers: [HeaderPair]
    var auth: AuthSpec
}

struct RequestFile: Codable, Equatable, Sendable {
    var seq: Int
    var spec: RequestSpec
}
