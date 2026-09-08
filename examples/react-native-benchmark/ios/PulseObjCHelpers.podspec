Pod::Spec.new do |spec|
  spec.name = 'PulseObjCHelpers'
  spec.version = '5.2.3'
  spec.summary = 'Objective-C helpers for Pulse'
  spec.homepage = 'https://github.com/kean/Pulse'
  spec.authors = { 'kean' => 'https://github.com/kean' }
  spec.license = { :type => 'MIT' }
  spec.source = { :git => 'https://github.com/kean/Pulse.git', :tag => '5.2.3' }
  spec.platform = :ios, '15.0'
  spec.source_files = 'Sources/PulseObjCHelpers/**/*.{h,m}'
  spec.public_header_files = 'Sources/PulseObjCHelpers/include/**/*.h'
end
