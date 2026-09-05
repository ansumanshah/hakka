require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "Hakka"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # The canonical inspector uses iOS 16 SwiftUI APIs. Keep the RN pod aligned
  # with ios/Package.swift without lowering a newer React Native requirement.
  rn_min_ios = defined?(min_ios_version_supported) ? min_ios_version_supported : '16.0'
  min_ios = [Gem::Version.new(rn_min_ios), Gem::Version.new('16.0')].max.to_s
  s.platforms    = { :ios => min_ios, :visionos => '1.0' }
  s.source       = { :git => "https://github.com/ansumanshah/hakka.git", :tag => "#{s.version}" }

  s.swift_version = "6.0"
  s.frameworks = ["Foundation", "UIKit", "SwiftUI", "CoreMotion", "Network", "Security", "SystemConfiguration", "UserNotifications"]
  s.source_files = [
    "ios/**/*.{h,m,mm,cpp,swift}",
  ]
  s.private_header_files = "ios/**/*.h"
  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => "$(inherited) \"$(PODS_ROOT)/Headers/Public/React-Core\" \"$(PODS_ROOT)/Headers/Public/React-Core-prebuilt/React_Core\""
  }

  install_modules_dependencies(s) if defined?(install_modules_dependencies)
end
