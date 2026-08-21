#if canImport(UIKit)
import HakkaCommon

// MARK: - MocksView: handleAdd()
//
// Split out of MocksView.swift to keep files under 200 lines. See
// MocksView.swift for the split's overview.

extension MocksView {
    /// Called from `addSection` (MocksViewForm.swift) on submit/tap.
    func handleAdd() {
        guard isAddEnabled else { return }
        let p = pattern.trimmingCharacters(in: .whitespaces)
        let method = selectedMethod == "ANY" ? nil : selectedMethod
        let delaySeconds = max(0, (Double(delayMs) ?? 0) / 1000.0)
        // Empty/invalid text parses as "not set" — skipCount defaults to 0
        // (applies immediately), stopAfter defaults to nil (unlimited).
        let skipCount = max(0, Int(skipCountText.trimmingCharacters(in: .whitespaces)) ?? 0)
        let stopAfter = Int(stopAfterText.trimmingCharacters(in: .whitespaces)).map { max(0, $0) }

        switch selectedAction {
        case .mock:
            MockEngine.shared.addRule(MockRuleInput(
                pattern: p,
                method: method,
                response: MockResponse(
                    status: Int(status) ?? 200,
                    body: responseBody.isEmpty ? nil : responseBody,
                    delay: delaySeconds
                ),
                enabled: true,
                skipCount: skipCount,
                stopAfter: stopAfter
            ))
        case .redirect:
            MockEngine.shared.addRule(MockRuleInput(
                pattern: p,
                method: method,
                response: MockResponse(status: 200, delay: delaySeconds),
                enabled: true,
                redirectTo: targetURL.trimmingCharacters(in: .whitespaces),
                skipCount: skipCount,
                stopAfter: stopAfter
            ))
        case .block:
            MockEngine.shared.addRule(MockRuleInput(
                pattern: p,
                method: method,
                response: MockResponse(status: 0),
                enabled: true,
                block: true,
                skipCount: skipCount,
                stopAfter: stopAfter
            ))
        case .failure:
            MockEngine.shared.addRule(MockRuleInput(
                pattern: p,
                method: method,
                response: MockResponse(status: 0),
                enabled: true,
                failure: MockFailure(code: selectedFailureCode),
                skipCount: skipCount,
                stopAfter: stopAfter
            ))
        }

        pattern = ""
        selectedMethod = "ANY"
        selectedAction = .mock
        status = "200"
        responseBody = "{}"
        delayMs = "0"
        targetURL = ""
        selectedFailureCode = .timeout
        skipCountText = ""
        stopAfterText = ""
    }
}
#endif // canImport(UIKit)
