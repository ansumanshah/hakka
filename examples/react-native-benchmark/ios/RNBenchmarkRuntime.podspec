Pod::Spec.new do |spec|
  spec.name = 'RNBenchmarkRuntime'
  spec.version = '0.0.1'
  spec.summary = 'Local React Native benchmark result bridge'
  spec.homepage = 'https://github.com/ansumanshah/hakka'
  spec.authors = { 'Hakka' => 'opensource@hakka.dev' }
  spec.license = { :type => 'MIT' }
  spec.source = { :git => 'https://github.com/ansumanshah/hakka.git', :tag => '0.0.1' }
  spec.platform = :ios, '16.0'
  spec.source_files = '*.{h,m,swift}'
  spec.dependency 'React-Core'
  case ENV['HAKKA_RN_BENCHMARK_VARIANT']
  when 'pulse'
    spec.dependency 'PulseCore'
    spec.dependency 'PulseProxy'
    spec.dependency 'PulseUI'
  when 'wormholy'
    spec.dependency 'Wormholy', '2.4.0'
  end
end
