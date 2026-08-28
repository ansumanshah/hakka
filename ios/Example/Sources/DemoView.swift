import SwiftUI
import HakkaCommon
import HakkaNetwork
import HakkaUI

// MARK: - DemoView
//
// Root screen. Chrome (hero, live strip, feature shelf, scenario tabs) lives
// here; each scenario tab's buttons and the SDK calls behind them live in
// their own file so this one stays readable:
//   DemoTheme.swift              -- background, glass chrome, color tokens
//   DemoComponents.swift         -- reusable button/card view builders
//   DemoCore.swift               -- fire/pushEvent/clearCapture, shared by every tab
//   DemoNetworkScenarios.swift   -- Network + Performance tabs
//   DemoMockScenarios.swift      -- Mocks tab (all five MockRule shapes)
//   DemoAdvancedScenarios.swift  -- Throttle, Breakpoints, Storage, Logs, GraphQL, gzip
//   DemoWebSocket.swift          -- the WebSocket Echo action
//   DemoGzip.swift               -- builds the gzip demo body
//
// None of the `@State` below is `private`: Swift's `private` is file-scoped
// even across extensions of the same type, and the scenario tabs above are
// all `extension DemoView` in other files. `ios/Sources` itself uses the
// identical pattern to keep files under 200 lines -- see `MockEngine.swift`'s
// doc comment on `rules`/`lock` ("`internal`... not `private`: the matching
// logic lives in `MockEngineMatching.swift`... needs to reach these").
struct DemoView: View {
    @State var requestCount = 0
    @State var inFlightCount = 0
    @State var selectedGroup = 0
    @State var lastEvent = "Ready"
    @State var recentEvents: [DemoEvent] = []

    let groups = ["Overview", "Network", "Performance", "Mocks", "Advanced"]

    var body: some View {
        NavigationStack {
            ZStack {
                demoBackground
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        hero
                        featureShelf
                        liveStrip
                        scenarioPicker
                        scenarioContent
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 92)
                    .padding(.bottom, 120)
                }
                .scrollIndicators(.hidden)
            }
            .navigationTitle("Hakka iOS")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    captureBadge
                }
            }
        }
        // Dark is the design default, but light must stay QA-able: honor an
        // explicit override from the scheme picker / UI tests, else system.
        .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("-hakkaLightMode") ? .light : .dark)
    }

    var hero: some View {
        glassGroup(cornerRadius: 30) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: "network")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 54, height: 54)
                        .demoGlass(tint: .cyan.opacity(0.24), cornerRadius: 18, interactive: false)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Network + Performance")
                            .font(.system(.largeTitle, design: .rounded).weight(.bold))
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.82)
                        Text("Test capture, HUD metrics, mocks, and failures")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white.opacity(0.64))
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }

                HStack(spacing: 10) {
                    heroButton("Inspector", "waveform.path.ecg", .blue, prominent: true) {
                        OverlayWindow.shared.show()
                    }
                    heroButton("Dashboard", "chart.bar.xaxis", .mint) {
                        OverlayWindow.shared.showMonitor()
                    }
                }

                HStack(spacing: 10) {
                    heroButton("Send 12", "bolt.fill", .yellow) { rapidFire(12) }
                    heroButton("Clear", "trash", .red) { clearCapture() }
                }
            }
            .padding(18)
        }
    }

    var liveStrip: some View {
        HStack(spacing: 10) {
            statTile("Captured", "\(requestCount)", "tray.full", .green)
            statTile("In Flight", "\(inFlightCount)", "hourglass", .orange)
            statTile("Last Result", lastEvent, "pulse", .cyan, compact: true)
        }
    }

    var featureShelf: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            featureCard("Network", "Methods, headers, bodies", "point.3.connected.trianglepath.dotted", .green)
            featureCard("Performance", "FPS, slow frames, latency", "speedometer", .mint)
            featureCard("Privacy", "Auth and cookie redaction", "lock.shield", .pink)
            featureCard("Mocks", "Rules, throttle, breakpoints", "wand.and.stars", .purple)
        }
    }

    var scenarioPicker: some View {
        Picker("Scenario group", selection: $selectedGroup) {
            ForEach(groups.indices, id: \.self) { index in
                Text(groups[index]).tag(index)
            }
        }
        .pickerStyle(.segmented)
        .padding(4)
        .demoGlass(tint: .white.opacity(0.08), cornerRadius: 16, interactive: false)
    }

    @ViewBuilder
    var scenarioContent: some View {
        switch selectedGroup {
        case 0:
            observeCommands
        case 1:
            networkCommands
        case 2:
            performanceCommands
        case 3:
            mockCommands
        default:
            advancedCommands
        }
    }

    var observeCommands: some View {
        VStack(spacing: 14) {
            commandSection("Monitor Views", subtitle: "Open Hakka's floating HUD and inspector screens") {
                command("Show HUD", "macwindow.badge.plus", .cyan) { BubbleWindow.shared.show() }
                command("Inspector", "list.bullet.rectangle", .blue) { OverlayWindow.shared.show() }
                command("Dashboard", "chart.xyaxis.line", .mint) { OverlayWindow.shared.showMonitor() }
                command("Full Screen", "rectangle.expand.vertical", .purple) { OverlayWindow.shared.showFullscreen() }
            }

            recentActivity
        }
    }

    var recentActivity: some View {
        glassGroup(cornerRadius: 24) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Recent Activity")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                    Spacer()
                    Text("\(recentEvents.count)")
                        .font(.caption.monospacedDigit().weight(.bold))
                        .foregroundStyle(.white.opacity(0.58))
                }

                if recentEvents.isEmpty {
                    Text("Run a scenario to populate the monitor.")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white.opacity(0.55))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 6)
                } else {
                    ForEach(recentEvents) { event in
                        HStack(spacing: 10) {
                            Circle()
                                .fill(event.tint)
                                .frame(width: 8, height: 8)
                            Text(event.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Spacer()
                            Text(event.time)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.white.opacity(0.58))
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .padding(16)
        }
    }

    var captureBadge: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(inFlightCount > 0 ? Color.orange : (requestCount == 0 ? Color.secondary : Color.green))
                .frame(width: 7, height: 7)
            Text("\(requestCount)")
                .font(.caption.monospacedDigit().weight(.heavy))
                .foregroundStyle(.white)
                Text("req")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.66))
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .demoGlass(tint: .white.opacity(0.12), cornerRadius: 20, interactive: false)
        .accessibilityLabel("\(requestCount) requests captured")
    }
}
