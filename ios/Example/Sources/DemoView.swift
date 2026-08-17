import SwiftUI
import HakkaCommon
import HakkaNetwork
import HakkaUI

// MARK: - DemoView

struct DemoView: View {
    @State private var requestCount = 0
    @State private var inFlightCount = 0
    @State private var selectedGroup = 0
    @State private var lastEvent = "Ready"
    @State private var recentEvents: [DemoEvent] = []

    private let groups = ["Overview", "Network", "Performance", "Mocks"]

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

    private var demoBackground: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.07, blue: 0.11),
                    Color(red: 0.02, green: 0.05, blue: 0.08),
                    Color(red: 0.09, green: 0.06, blue: 0.10),
                    Color(red: 0.02, green: 0.08, blue: 0.08),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [.cyan.opacity(0.18), .clear],
                center: .topLeading,
                startRadius: 24,
                endRadius: 360
            )
            RadialGradient(
                colors: [.pink.opacity(0.14), .clear],
                center: .bottomTrailing,
                startRadius: 10,
                endRadius: 330
            )
        }
        .ignoresSafeArea()
    }

    private var hero: some View {
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

    private var liveStrip: some View {
        HStack(spacing: 10) {
            statTile("Captured", "\(requestCount)", "tray.full", .green)
            statTile("In Flight", "\(inFlightCount)", "hourglass", .orange)
            statTile("Last Result", lastEvent, "pulse", .cyan, compact: true)
        }
    }

    private var featureShelf: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            featureCard("Network", "Methods, headers, bodies", "point.3.connected.trianglepath.dotted", .green)
            featureCard("Performance", "FPS, slow frames, latency", "speedometer", .mint)
            featureCard("Privacy", "Auth and cookie redaction", "lock.shield", .pink)
            featureCard("Mocks", "Local rules and responses", "wand.and.stars", .purple)
        }
    }

    private var scenarioPicker: some View {
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
    private var scenarioContent: some View {
        switch selectedGroup {
        case 0:
            observeCommands
        case 1:
            networkCommands
        case 2:
            performanceCommands
        default:
            mockCommands
        }
    }

    private var observeCommands: some View {
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

    private var networkCommands: some View {
        VStack(spacing: 14) {
            commandSection("Methods", subtitle: "Exercise verbs and JSON bodies") {
                command("GET", "arrow.down.circle", .green) { fire("GET", "https://httpbin.org/get") }
                command("POST", "arrow.up.doc", .blue) { fire("POST", "https://httpbin.org/post") }
                command("PUT", "square.and.pencil", .purple) { fire("PUT", "https://httpbin.org/put") }
                command("PATCH", "bandage", .indigo) { fire("PATCH", "https://httpbin.org/patch") }
                command("DELETE", "trash", .red) { fire("DELETE", "https://httpbin.org/delete") }
                command("HEAD", "arrow.down.to.line", .teal) { fire("HEAD", "https://httpbin.org/get") }
            }

            commandSection("Payloads", subtitle: "Headers, bodies, bytes, and media") {
                command("JSON", "curlybraces", .indigo) { fire("GET", "https://httpbin.org/json") }
                command("Auth Headers", "key.horizontal", .pink) { fireAuth() }
                command("Image", "photo", .mint) { fire("GET", "https://httpbin.org/image/png") }
                command("Large Body", "shippingbox", .cyan) { fire("GET", "https://httpbin.org/bytes/100000") }
            }

            commandSection("Status Codes", subtitle: "Success, client, and server responses") {
                command("200", "checkmark.circle", .green) { fire("GET", "https://httpstat.us/200") }
                command("204", "circle.dashed", .teal) { fire("GET", "https://httpstat.us/204") }
                command("302", "arrow.triangle.turn.up.right.circle", .yellow) { fire("GET", "https://httpbin.org/redirect/3") }
                command("404", "exclamationmark.triangle", .orange) { fire("GET", "https://httpstat.us/404") }
                command("429", "timer", .orange) { fire("GET", "https://httpstat.us/429") }
                command("500", "xmark.octagon", .red) { fire("GET", "https://httpstat.us/500") }
            }

            commandSection("Failures + Timing", subtitle: "Slow paths and network errors") {
                command("Fast", "speedometer", .mint) { fire("GET", "https://httpbin.org/get") }
                command("1s Delay", "clock", .teal) { fire("GET", "https://httpbin.org/delay/1") }
                command("DNS", "wifi.slash", .red) { fire("GET", "https://nonexistent.invalid/api") }
                command("SSL", "lock.trianglebadge.exclamationmark", .red) { fire("GET", "https://expired.badssl.com/") }
            }
        }
        .animation(.snappy(duration: 0.24), value: selectedGroup)
    }

    private var performanceCommands: some View {
        VStack(spacing: 14) {
            commandSection("Performance Monitor", subtitle: "Validate HUD, frame metrics, and latency summaries") {
                command("Show HUD", "macwindow.badge.plus", .cyan) { BubbleWindow.shared.show() }
                command("Dashboard", "chart.xyaxis.line", .mint) { OverlayWindow.shared.showMonitor() }
                command("Send 20", "bolt.badge.clock", .yellow) { rapidFire(20) }
                command("Large x4", "shippingbox.and.arrow.backward", .orange) {
                    for _ in 0..<4 { fire("GET", "https://httpbin.org/bytes/100000", label: "Large Body") }
                }
            }

            commandSection("Stress Mix", subtitle: "Combine network volume with slow and failed requests") {
                command("Latency Mix", "timer", .teal) {
                    fire("GET", "https://httpbin.org/get", label: "Fast")
                    fire("GET", "https://httpbin.org/delay/1", label: "Delay")
                    fire("GET", "https://httpstat.us/500", label: "Server Error")
                }
                command("Burst 50", "flame", .red) { rapidFire(50) }
                command("Failures", "wifi.exclamationmark", .red) {
                    fire("GET", "https://nonexistent.invalid/api", label: "DNS")
                    fire("GET", "https://expired.badssl.com/", label: "SSL")
                }
                command("Clear Logs", "trash.slash", .gray) { clearCapture() }
            }
        }
        .animation(.snappy(duration: 0.24), value: selectedGroup)
    }

    private var mockCommands: some View {
        VStack(spacing: 14) {
            commandSection("Mock Engine", subtitle: "Verify local rules and captured mock responses") {
                command("Add mock", "plus.circle", .mint) { addMock() }
                command("Test mock", "play.circle", .green) { fire("GET", "https://api.example.com/mocked") }
                command("Clear mocks", "xmark.circle", .gray) {
                    MockEngine.shared.clearRules()
                    pushEvent("Mocks cleared", tint: .gray)
                }
            }

            commandSection("Suites", subtitle: "Batch coverage for release checks") {
                command("All Methods", "square.grid.2x2", .blue) { allMethods() }
                command("All States", "gauge.with.dots.needle.67percent", .orange) { allStates() }
                command("Mixed 20", "bolt.badge.clock", .yellow) { rapidFire(20) }
                command("Clear Logs", "trash.slash", .red) { clearCapture() }
            }
        }
        .animation(.snappy(duration: 0.24), value: selectedGroup)
    }

    private var recentActivity: some View {
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

    private var captureBadge: some View {
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

    private func statTile(_ title: String, _ value: String, _ icon: String, _ tint: Color, compact: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(tint)
                Text(title)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white.opacity(0.66))
                    .lineLimit(1)
            }
            Text(value)
                .font((compact ? Font.caption : Font.title3).monospacedDigit().weight(.heavy))
                .foregroundStyle(.white)
                .lineLimit(compact ? 2 : 1)
                .minimumScaleFactor(0.68)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 70)
        .padding(.horizontal, 12)
        .demoGlass(tint: tint.opacity(0.13), cornerRadius: 18, interactive: false)
    }

    private func featureCard(_ title: String, _ subtitle: String, _ icon: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .demoGlass(tint: tint.opacity(0.16), cornerRadius: 9, interactive: false)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.white.opacity(0.68))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 96, alignment: .topLeading)
        .padding(12)
        .demoGlass(tint: tint.opacity(0.10), cornerRadius: 18, interactive: false)
    }

    private func heroButton(
        _ title: String,
        _ icon: String,
        _ tint: Color,
        prominent: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
        }
        .demoGlassButton(tint: tint, prominent: prominent)
    }

    private func commandSection<Content: View>(
        _ title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        glassGroup(cornerRadius: 22) {
            VStack(alignment: .leading, spacing: 11) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                    Text(subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.68))
                        .lineLimit(2)
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 124), spacing: 8)], spacing: 8) {
                    content()
                }
            }
            .padding(14)
        }
    }

    private func command(_ title: String, _ icon: String, _ tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 20)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 42)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .demoGlassButton(tint: tint)
    }

    @ViewBuilder
    private func glassGroup<Content: View>(
        cornerRadius: CGFloat,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 22) {
                content()
                    .glassEffect(.regular.tint(.white.opacity(0.08)), in: .rect(cornerRadius: cornerRadius))
            }
        } else {
            content()
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(.white.opacity(0.10), lineWidth: 0.5)
                )
        }
    }

    // MARK: - Network

    private func fire(_ method: String, _ urlString: String, label: String? = nil) {
        guard let url = URL(string: urlString) else { return }
        let title = label ?? method
        inFlightCount += 1
        lastEvent = "\(title) started"

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 8
        if ["POST", "PUT", "PATCH"].contains(method) {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(
                withJSONObject: [
                    "name": "Hakka",
                    "scenario": title,
                    "timestamp": Date().timeIntervalSince1970,
                ]
            )
        }

        URLSession.shared.dataTask(with: req) { _, response, error in
            DispatchQueue.main.async {
                inFlightCount = max(0, inFlightCount - 1)
                requestCount += 1

                let status = (response as? HTTPURLResponse)?.statusCode
                if let error {
                    pushEvent("\(title) failed", tint: .red)
                    lastEvent = error.localizedDescription
                } else if let status {
                    pushEvent("\(title) \(status)", tint: status < 400 ? .green : .orange)
                    lastEvent = "\(title) \(status)"
                } else {
                    pushEvent("\(title) captured", tint: .cyan)
                    lastEvent = "\(title) captured"
                }
            }
        }.resume()
    }

    private func fireAuth() {
        guard let url = URL(string: "https://httpbin.org/bearer") else { return }
        inFlightCount += 1
        lastEvent = "Auth started"
        var req = URLRequest(url: url)
        req.setValue("Bearer eyJhbGciOiJIUzI1NiJ9.test", forHTTPHeaderField: "Authorization")
        req.setValue("session=abc123", forHTTPHeaderField: "Cookie")
        URLSession.shared.dataTask(with: req) { _, response, error in
            DispatchQueue.main.async {
                inFlightCount = max(0, inFlightCount - 1)
                requestCount += 1
                if error != nil {
                    pushEvent("Auth failed", tint: .red)
                    lastEvent = "Auth failed"
                } else {
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    pushEvent("Auth \(status)", tint: status < 400 ? .pink : .orange)
                    lastEvent = "Auth \(status)"
                }
            }
        }.resume()
    }

    private func rapidFire(_ count: Int) {
        let urls = [
            "https://httpbin.org/get",
            "https://jsonplaceholder.typicode.com/posts/1",
            "https://httpbin.org/json",
            "https://catfact.ninja/fact",
            "https://httpbin.org/status/204",
        ]
        for i in 0..<count {
            fire("GET", urls[i % urls.count], label: "Burst \(i + 1)")
        }
    }

    private func allMethods() {
        fire("GET", "https://httpbin.org/get")
        fire("POST", "https://httpbin.org/post")
        fire("PUT", "https://httpbin.org/put")
        fire("PATCH", "https://httpbin.org/patch")
        fire("DELETE", "https://httpbin.org/delete")
    }

    private func allStates() {
        fire("GET", "https://httpstat.us/200", label: "Status 200")
        fire("GET", "https://httpstat.us/204", label: "Status 204")
        fire("GET", "https://httpbin.org/redirect/3", label: "Redirect")
        fire("GET", "https://httpstat.us/404", label: "Status 404")
        fire("GET", "https://httpstat.us/500", label: "Status 500")
        fire("GET", "https://nonexistent.invalid/api", label: "DNS")
    }

    private func addMock() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern: "api.example.com/mocked",
            response: MockResponse(
                status: 200,
                headers: ["Content-Type": "application/json"],
                body: "{\"message\": \"Mocked by Hakka\", \"mocked\": true}",
                delay: 0.3
            )
        ))
        pushEvent("Mock added", tint: .mint)
        lastEvent = "Mock added"
    }

    private func clearCapture() {
        HakkaInterceptor.shared.clear()
        requestCount = 0
        inFlightCount = 0
        recentEvents.removeAll()
        lastEvent = "Cleared"
    }

    private func pushEvent(_ title: String, tint: Color) {
        recentEvents.insert(DemoEvent(title: title, tint: tint), at: 0)
        if recentEvents.count > 5 {
            recentEvents.removeLast(recentEvents.count - 5)
        }
    }
}

private struct DemoEvent: Identifiable {
    let id = UUID()
    let title: String
    let tint: Color
    let date = Date()

    var time: String {
        Self.formatter.string(from: date)
    }

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
}

private extension View {
    @ViewBuilder
    func demoGlass(tint: Color, cornerRadius: CGFloat, interactive: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26.0, *) {
            if interactive {
                self.glassEffect(.regular.tint(tint).interactive(), in: shape)
            } else {
                self.glassEffect(.regular.tint(tint), in: shape)
            }
        } else {
            self
                .background(.ultraThinMaterial, in: shape)
                .overlay(shape.stroke(.white.opacity(0.10), lineWidth: 0.5))
        }
    }

    @ViewBuilder
    func demoGlassButton(tint: Color = .white, prominent: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            if prominent {
                self.buttonStyle(.glassProminent)
            } else {
                self.buttonStyle(.glass(.regular.tint(tint.opacity(0.18))))
            }
        } else {
            self
                .buttonStyle(.plain)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(tint.opacity(0.32), lineWidth: 0.5)
                )
        }
    }
}
