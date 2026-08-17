Pod::Spec.new do |s|
  s.name         = "Hakka"
  s.version      = "0.1.0"
  s.summary      = "Local-first network inspector SDK for iOS"
  s.description  = "Swift network capture, redaction, performance, and optional UI modules for Hakka."
  s.homepage     = "https://github.com/ansumanshah/hakka"
  s.license      = { :type => "MIT", :file => "LICENSE" }
  s.author       = "Ansuman Shah"
  s.source       = { :git => "https://github.com/ansumanshah/hakka.git", :tag => s.version.to_s }

  s.ios.deployment_target = "16.0"
  s.osx.deployment_target = "14.0"
  s.swift_version = "6.0"

  s.default_subspecs = "Network", "Performance"

  s.subspec "Common" do |ss|
    ss.module_name = "HakkaCommon"
    ss.source_files = "Sources/Common/**/*.swift"
    ss.frameworks = "Foundation"
  end

  s.subspec "Network" do |ss|
    ss.module_name = "HakkaNetwork"
    ss.source_files = "Sources/Network/**/*.swift"
    ss.dependency "Hakka/Common"
    ss.frameworks = "Foundation", "Security"
  end

  s.subspec "NetworkNoop" do |ss|
    ss.module_name = "HakkaNetworkNoop"
    ss.source_files = "Sources/NetworkNoop/**/*.swift"
    ss.dependency "Hakka/Common"
    ss.frameworks = "Foundation"
  end

  s.subspec "Performance" do |ss|
    ss.module_name = "HakkaPerformance"
    ss.source_files = "Sources/Performance/**/*.swift"
    ss.dependency "Hakka/Common"
    ss.frameworks = "Foundation", "QuartzCore", "UIKit"
  end

  s.subspec "PerformanceNoop" do |ss|
    ss.module_name = "HakkaPerformanceNoop"
    ss.source_files = "Sources/PerformanceNoop/**/*.swift"
    ss.dependency "Hakka/Common"
    ss.frameworks = "Foundation"
  end

  s.subspec "UI" do |ss|
    ss.module_name = "HakkaUI"
    ss.source_files = "Sources/UI/**/*.swift"
    ss.dependency "Hakka/Common"
    ss.dependency "Hakka/Network"
    ss.dependency "Hakka/Performance"
    ss.frameworks = "Foundation", "SwiftUI", "UIKit", "CoreMotion", "UserNotifications"
  end
end
