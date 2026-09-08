Pod::Spec.new do |spec|
  spec.name = 'PulseCore'
  spec.module_name = 'Pulse'
  spec.version = '5.2.3'
  spec.summary = 'Logging system for Apple platforms'
  spec.homepage = 'https://github.com/kean/Pulse'
  spec.authors = { 'kean' => 'https://github.com/kean' }
  spec.license = { :type => 'MIT' }
  spec.source = { :git => 'https://github.com/kean/Pulse.git', :tag => '5.2.3' }
  spec.platform = :ios, '15.0'
  spec.swift_version = '5.0'
  spec.source_files = 'Sources/Pulse/**/*.swift'
  spec.dependency 'PulseObjCHelpers'
end
