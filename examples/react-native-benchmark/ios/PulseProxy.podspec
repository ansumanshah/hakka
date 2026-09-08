Pod::Spec.new do |spec|
  spec.name = 'PulseProxy'
  spec.version = '5.2.3'
  spec.summary = 'URLSession proxy support for Pulse'
  spec.homepage = 'https://github.com/kean/Pulse'
  spec.authors = { 'kean' => 'https://github.com/kean' }
  spec.license = { :type => 'MIT' }
  spec.source = { :git => 'https://github.com/kean/Pulse.git', :tag => '5.2.3' }
  spec.platform = :ios, '15.0'
  spec.swift_version = '5.0'
  spec.source_files = 'Sources/PulseProxy/**/*.swift'
  spec.dependency 'PulseCore'
end
