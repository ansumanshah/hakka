import AppKit
import CoreImage.CIFilterBuiltins
import HakkaServer

/// A setup capability URL can be transferred to a phone without typing it.
enum ProxyDeviceSetupQRCode {
    @MainActor static func append(to result: MCPToolResult, link: String) -> MCPToolResult {
        guard link.utf8.count <= 1024 else { return result }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(link.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return result }
        let padded = output.composited(over: CIImage(color: .white).cropped(to: output.extent.insetBy(dx: -4, dy: -4)))
        let scaled = padded.transformed(by: CGAffineTransform(scaleX: 6, y: 6))
        guard let image = CIContext().createCGImage(scaled, from: scaled.extent),
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
              png.count <= 65536 else { return result }
        return MCPToolResult(content: result.content + [.object([
            "type": .string("image"), "mimeType": .string("image/png"), "data": .string(png.base64EncodedString()),
        ])], isError: result.isError)
    }
}
