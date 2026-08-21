import Foundation
import HakkaCommon

/// The wire command that installs (or, after a toggle, re-installs) a
/// `RuleStore` entry on connected devices. The entry's `isEnabled` wins over
/// the payload's own enabled flag — the store's toggle is the source of
/// truth. Ids ride inside the payload, which is what the device-side
/// replace-by-id add expects.
public func installCommand(for entry: RuleEntry) -> ControlCommand {
    switch entry.payload {
    case let .mock(rule):
        return .mockAdd(
            id: entry.id,
            rule: MockRuleInput(
                pattern: rule.pattern,
                isRegex: rule.isRegex,
                regexFlags: rule.regexFlags,
                method: rule.method,
                response: rule.response,
                enabled: entry.isEnabled,
                redirectTo: rule.redirectTo,
                block: rule.block,
                modify: rule.modify
            )
        )
    case let .breakpoint(breakpoint):
        return .breakpointAdd(
            id: entry.id,
            breakpoint: BreakpointInput(
                pattern: breakpoint.pattern,
                method: breakpoint.method,
                on: breakpoint.on,
                enabled: entry.isEnabled,
                id: entry.id
            )
        )
    }
}

/// The wire command that deletes a `RuleStore` entry from devices.
public func removalCommand(for entry: RuleEntry) -> ControlCommand {
    switch entry.payload {
    case .mock:
        return .mockRemove(id: entry.id)
    case .breakpoint:
        return .breakpointRemove(id: entry.id)
    }
}
