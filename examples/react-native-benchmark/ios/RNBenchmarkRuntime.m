#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(RNBenchmarkRuntime, NSObject)
RCT_EXTERN_METHOD(getCapturedCount:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getEnvironment:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(writeResult:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
