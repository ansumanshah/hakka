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
/// Bumped to 2 when `AuthSpec.oauth2`'s payload grew from a bare pasted
/// token into a full `OAuth2Config` (grant type, endpoints, token
/// variables) — a real shape change to what a `.hakka` file can contain,
/// even though `OAuth2Config`'s own decode still reads a version-1 file's
/// `{"accessToken": "..."}` shape without complaint.
///
/// Bumped to 3 when `BodySpec.graphql` grew an `operationName` field for the
/// multi-operation picker. `operationName` is a trailing `Optional` on the
/// case, so Swift's synthesized decode reads a version-2 file (no such key)
/// as nil without any custom decode logic — the version bump exists purely
/// so a *future* Hakka build with a real breaking `BodySpec` change gets to
/// refuse an old file cleanly, not because this particular change needed it.
public let collectionFormatVersion = 3

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
