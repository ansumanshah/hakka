import AppKit
import SwiftUI

/// Controls the opt-in loopback MCP server and explains access to captured data.
struct MCPSettingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var copiedItem: String?
    @State private var copyTask: Task<Void, Never>?

    var body: some View {
        Section {
            Toggle("Enable MCP Server", isOn: toggleBinding)
                .disabled(model.mcp.isChangingState)
            LabeledContent("Status") {
                Text(status)
                    .foregroundStyle(.secondary)
            }
            if model.mcp.isRunning, let port = model.mcp.boundPort {
                LabeledContent("Endpoint") {
                    urlRow(port: port)
                }
                Button {
                    copy(Self.configuration(port: port), item: "configuration")
                } label: {
                    Label(copiedItem == "configuration" ? "Configuration copied" : "Copy MCP configuration",
                          systemImage: copiedItem == "configuration" ? "checkmark" : "doc.on.doc")
                }
                Text("Add this configuration to your AI tool’s MCP settings, then connect while Hakka is open.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
        .onDisappear { copyTask?.cancel() }
    }

    private var status: String {
        if model.mcp.isStarting {
            return "Starting…"
        }
        if model.mcp.isStopping {
            return "Stopping…"
        }
        return model.mcp.isRunning ? "Ready · local access" : "Off"
    }

    private func urlRow(port: UInt16) -> some View {
        HStack(spacing: Spacing.sm) {
            Text(Self.url(port: port))
                .monospaced()
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Button {
                copy(Self.url(port: port), item: "endpoint")
            } label: {
                Image(systemName: copiedItem == "endpoint" ? "checkmark" : "doc.on.doc")
                    .frame(minWidth: ControlHeight.chip, minHeight: ControlHeight.chip)
            }
            .buttonStyle(.plain)
            .help("Copy endpoint URL")
            .accessibilityLabel(copiedItem == "endpoint" ? "Endpoint copied" : "Copy endpoint URL")
        }
    }

    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { model.mcp.isRunning },
            set: { shouldRun in
                Task {
                    if shouldRun {
                        await model.mcp.start()
                    } else {
                        await model.mcp.stop()
                    }
                }
            }
        )
    }

    private func copy(_ text: String, item: String) {
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(text, forType: .string) else { return }
        copyTask?.cancel()
        copiedItem = item
        copyTask = Task {
            do { try await Task.sleep(for: .seconds(1.5)) } catch { return }
            copiedItem = nil
        }
    }

    static func configuration(port: UInt16) -> String {
        """
        {
          "mcpServers": {
            "hakka-desktop": {
              "url": "\(url(port: port))"
            }
          }
        }
        """
    }

    private static func url(port: UInt16) -> String {
        "http://127.0.0.1:\(port)"
    }

    private static let exposureNote = """
    Let AI tools on this Mac read captured requests, responses, headers, bodies, \
    and open collections. While enabled, other local processes can also access \
    this server. Remote connections are blocked. Proxy control requires \
    Allow agents in Proxy → Automation. Off by default.
    """
}
