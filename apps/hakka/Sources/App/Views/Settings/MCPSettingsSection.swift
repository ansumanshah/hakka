import AppKit
import SwiftUI

/// Controls the opt-in loopback MCP server and explains access to captured data.
struct MCPSettingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var isToggling = false
    @State private var copiedURL = false

    var body: some View {
        Section {
            Toggle("Enable MCP Server", isOn: toggleBinding)
                .disabled(isToggling)
            if model.mcp.isRunning, let port = model.mcp.boundPort {
                LabeledContent("Port") {
                    Text(String(port))
                        .monospaced()
                        .foregroundStyle(.secondary)
                }
                LabeledContent("URL") {
                    urlRow(port: port)
                }
            }
            if let startupError = model.mcp.startupError {
                Text(startupError)
                    .font(.caption)
                    .foregroundStyle(ThemeTokens.Status.error)
            }
        } header: {
            Text("MCP Server")
        } footer: {
            Text(Self.exposureNote)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func urlRow(port: UInt16) -> some View {
        HStack(spacing: Spacing.sm) {
            Text(Self.url(port: port))
                .monospaced()
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Button {
                copy(Self.url(port: port))
            } label: {
                Image(systemName: copiedURL ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.plain)
            .help("Copy URL")
        }
    }

    /// A `Binding` rather than a plain `Toggle(_:isOn:)` over a stored
    /// `Bool`: the toggle has no state of its own, it reflects and drives
    /// `model.mcp.isRunning` directly, so a failed `start()` (which leaves
    /// `isRunning` false) snaps the switch back off on its own instead of
    /// the UI lying about a server that never actually came up.
    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { model.mcp.isRunning },
            set: { shouldRun in
                isToggling = true
                Task {
                    if shouldRun {
                        await model.mcp.start()
                    } else {
                        await model.mcp.stop()
                    }
                    isToggling = false
                }
            },
        )
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        copiedURL = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copiedURL = false
        }
    }

    private static func url(port: UInt16) -> String {
        "http://127.0.0.1:\(port)"
    }

    private static let exposureNote = """
    Starts a local MCP server that an AI coding agent on this Mac can connect to. \
    It only ever listens on this machine, not the network, but while it's on, any \
    process on this Mac that can reach that port, including an AI agent you've \
    given shell or MCP access to, can read your captured traffic (requests, \
    responses, headers, and bodies) and every collection you have open. Off by \
    default. Turn it off when you're done.
    """
}
