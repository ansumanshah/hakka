import SwiftUI

struct ProxyBandwidthSection: View {
    @Binding var configuration: ProxyBandwidthConfiguration

    var body: some View {
        Section("Network conditions") {
            Picker("Profile", selection: $configuration.profile) {
                ForEach(ProxyBandwidthProfile.allCases) { profile in
                    Text(profile.title).tag(profile)
                }
            }
            if configuration.profile == .custom {
                TextField("Latency (ms)", value: customLatency, format: .number.grouping(.never))
                TextField("Upload (B/s)", value: customUpload, format: .number.grouping(.never))
                TextField("Download (B/s)", value: customDownload, format: .number.grouping(.never))
            } else if configuration.profile == .offline {
                Text("New requests fail while this capture runs.").foregroundStyle(.secondary)
            } else if configuration.profile != .none {
                Text("\(configuration.effectiveLatencyMs) ms latency · \(configuration.effectiveUploadBytesPerSecond ?? 0) B/s up · \(configuration.effectiveDownloadBytesPerSecond ?? 0) B/s down")
                    .foregroundStyle(.secondary)
            }
            Text("Applies when capture starts. Stop capture before changing this setting.")
                .font(.callout).foregroundStyle(.secondary)
        }
    }

    private var customLatency: Binding<Int> {
        Binding(get: { configuration.latencyMs ?? 0 }, set: { configuration.latencyMs = $0 })
    }

    private var customUpload: Binding<Int> {
        Binding(get: { configuration.uploadBytesPerSecond ?? 0 }, set: { configuration.uploadBytesPerSecond = $0 })
    }

    private var customDownload: Binding<Int> {
        Binding(get: { configuration.downloadBytesPerSecond ?? 0 }, set: { configuration.downloadBytesPerSecond = $0 })
    }
}
