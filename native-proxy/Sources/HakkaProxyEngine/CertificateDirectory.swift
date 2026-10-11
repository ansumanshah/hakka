import Foundation
import Darwin

/// Exclusive owner of a private task-local CA directory. It never installs system trust.
internal final class CertificateDirectory: @unchecked Sendable {
    let url: URL
    private var descriptor: Int32 = -1
    private let closeLock = NSLock()

    init(_ requestedURL: URL) throws {
        guard requestedURL.isFileURL else { throw LocalCertificateAuthorityError.unsafeDirectory }
        url = requestedURL.standardizedFileURL
        var path = "/"
        for component in url.pathComponents.dropFirst() {
            path = (path as NSString).appendingPathComponent(component)
            var info = stat()
            if lstat(path, &info) == 0 {
                guard (info.st_mode & S_IFMT) == S_IFDIR else {
                    throw LocalCertificateAuthorityError.unsafeDirectory
                }
            } else {
                guard errno == ENOENT, mkdir(path, 0o700) == 0 else {
                    throw LocalCertificateAuthorityError.unsafeDirectory
                }
            }
        }
        var info = stat()
        guard lstat(url.path, &info) == 0, info.st_uid == getuid(),
              info.st_mode & 0o777 == 0o700 else {
            throw LocalCertificateAuthorityError.unsafeDirectory
        }
        let lockURL = url.appendingPathComponent("owner.lock")
        descriptor = open(lockURL.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw LocalCertificateAuthorityError.unsafeDirectory }
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == getuid(), info.st_nlink == 1, info.st_mode & 0o777 == 0o600 else {
            Darwin.close(descriptor); descriptor = -1
            throw LocalCertificateAuthorityError.unsafeDirectory
        }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor); descriptor = -1
            throw LocalCertificateAuthorityError.directoryInUse
        }
    }

    func exists(_ file: URL, privateKey: Bool = false) throws -> Bool {
        var info = stat()
        if lstat(file.path, &info) != 0 {
            guard errno == ENOENT else { throw LocalCertificateAuthorityError.unsafeDirectory }
            return false
        }
        guard info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(),
              info.st_nlink == 1, (!privateKey || info.st_mode & 0o777 == 0o600) else {
            throw LocalCertificateAuthorityError.unsafeDirectory
        }
        return true
    }

    func temporaryDirectory() throws -> URL {
        let result = url.appendingPathComponent("generation-\(UUID().uuidString)", isDirectory: true)
        guard mkdir(result.path, 0o700) == 0 else { throw LocalCertificateAuthorityError.unsafeDirectory }
        return result
    }

    func close() {
        closeLock.lock(); defer { closeLock.unlock() }
        if descriptor >= 0 { Darwin.close(descriptor); descriptor = -1 }
    }
    deinit { close() }
}
