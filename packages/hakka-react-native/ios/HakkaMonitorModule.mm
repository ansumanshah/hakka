//
//  HakkaMonitorModule.mm
//  react-native-hakka
//
//  React Native bridge for the shared Swift Hakka iOS core.
//

#import "HakkaMonitorModule.h"
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

#if __has_include("Hakka-Swift.h")
#import "Hakka-Swift.h"
#elif __has_include(<Hakka/Hakka-Swift.h>)
#import <Hakka/Hakka-Swift.h>
#endif

static NSString *const kHakkaRequestNotification = @"RNHakkaCoreBridgeRequest";

@interface HakkaMonitorModule ()
@property (nonatomic, strong) dispatch_queue_t emitQueue;
@property (nonatomic, assign) BOOL hasListeners;
@end

@implementation HakkaMonitorModule

RCT_EXPORT_MODULE(HakkaMonitor)

- (instancetype)init {
    if (self = [super init]) {
        _emitQueue = dispatch_queue_create("com.noodleapps.hakka.emit", DISPATCH_QUEUE_SERIAL);
        _hasListeners = NO;
    }
    return self;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"onHakkaRequests", @"onHakkaConsole", @"onHakkaStorage"];
}

- (void)startObserving {
    self.hasListeners = YES;
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleHakkaRequest:)
                                                 name:kHakkaRequestNotification
                                               object:nil];
}

- (void)stopObserving {
    self.hasListeners = NO;
    [[NSNotificationCenter defaultCenter] removeObserver:self
                                                    name:kHakkaRequestNotification
                                                  object:nil];
}

- (void)handleHakkaRequest:(NSNotification *)notification {
    if (!self.hasListeners) return;

    NSDictionary *userInfo = notification.userInfo;
    if (!userInfo) return;

    dispatch_async(self.emitQueue, ^{
        [self sendEventWithName:@"onHakkaRequests" body:@[userInfo]];
    });
}

// MARK: - Event Emitter

- (void)addListener:(NSString *)eventName {
    [super addListener:eventName];
}

- (void)removeListeners:(double)count {
    [super removeListeners:count];
}

// MARK: - Core

RCT_EXPORT_METHOD(initialize:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [[RNHakkaCoreBridge shared] start];
    resolve(nil);
}

RCT_EXPORT_METHOD(isReady:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve(@([[RNHakkaCoreBridge shared] isReady]));
}

// MARK: - Logs

RCT_EXPORT_METHOD(addLog:(NSDictionary *)request)
{
    // JS-owned logs stay in the JS ring buffer. Native capture is owned by
    // HakkaInterceptor so native and JS modes can deduplicate in JS.
}

RCT_EXPORT_METHOD(getLogs:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] getLogs]);
}

RCT_EXPORT_METHOD(clearLogs)
{
    [[RNHakkaCoreBridge shared] clearLogs];
}

RCT_EXPORT_METHOD(pause)
{
    [[RNHakkaCoreBridge shared] pause];
}

RCT_EXPORT_METHOD(resume)
{
    [[RNHakkaCoreBridge shared] resume];
}

RCT_EXPORT_METHOD(getLogCount:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve(@([[RNHakkaCoreBridge shared] getLogCount]));
}

// MARK: - Export

RCT_EXPORT_METHOD(exportJson:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] exportJson]);
}

RCT_EXPORT_METHOD(exportHar:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] exportHar]);
}

RCT_EXPORT_METHOD(exportCurl:(NSString *)requestId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] exportCurl:requestId]);
}

// MARK: - Analytics

RCT_EXPORT_METHOD(getPerformanceMetrics:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] getPerformanceMetrics]);
}

RCT_EXPORT_METHOD(getHealthReport:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] getHealthReport]);
}

// MARK: - Privacy

RCT_EXPORT_METHOD(setSensitiveHeaders:(NSArray<NSString *> *)headers)
{
    [[RNHakkaCoreBridge shared] setSensitiveHeaders:headers];
}

RCT_EXPORT_METHOD(getSensitiveHeaders:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] getSensitiveHeaders]);
}

RCT_EXPORT_METHOD(sanitizeLogs:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve(nil);
}

// MARK: - Filtering

RCT_EXPORT_METHOD(setIgnoredHosts:(NSArray<NSString *> *)hosts)
{
    [[RNHakkaCoreBridge shared] setIgnoredHosts:hosts];
}

RCT_EXPORT_METHOD(getIgnoredHosts:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] getIgnoredHosts]);
}

RCT_EXPORT_METHOD(setIgnoredPatterns:(NSArray<NSString *> *)patterns)
{
    [[RNHakkaCoreBridge shared] setIgnoredPatterns:patterns];
}

RCT_EXPORT_METHOD(getIgnoredPatterns:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] getIgnoredPatterns]);
}

// MARK: - Simulation

RCT_EXPORT_METHOD(simulateSlowNetwork:(double)delayMs)
{
    [[RNHakkaCoreBridge shared] simulateSlowNetwork:delayMs];
}

RCT_EXPORT_METHOD(blockRequests:(NSString *)pattern)
{
    [[RNHakkaCoreBridge shared] blockRequests:pattern];
}

RCT_EXPORT_METHOD(unblockRequests:(NSString *)pattern)
{
    [[RNHakkaCoreBridge shared] unblockRequests:pattern];
}

RCT_EXPORT_METHOD(addMockRule:(NSDictionary *)rule)
{
    [[RNHakkaCoreBridge shared] addMockRule:rule];
}

RCT_EXPORT_METHOD(removeMockRule:(NSString *)ruleId)
{
    [[RNHakkaCoreBridge shared] removeMockRule:ruleId];
}

RCT_EXPORT_METHOD(setMockRuleEnabled:(NSString *)ruleId
                  enabled:(BOOL)enabled)
{
    [[RNHakkaCoreBridge shared] setMockRuleEnabled:ruleId enabled:enabled];
}

// MARK: - Native UI

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(isUIAvailable)
{
    return @([[RNHakkaCoreBridge shared] isUIAvailable]);
}

RCT_EXPORT_METHOD(showUI:(NSString *)mode
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [[RNHakkaCoreBridge shared] showUI:mode completion:^(BOOL presented) {
            resolve(@(presented));
        }];
    });
}

RCT_EXPORT_METHOD(hideUI)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [[RNHakkaCoreBridge shared] hideUI];
    });
}

// MARK: - Snapshot

RCT_EXPORT_METHOD(getSnapshot:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] getSnapshot]);
}

// MARK: - Observability: identity & tagging

RCT_EXPORT_METHOD(setUserId:(NSString *)userId)
{
    [[RNHakkaCoreBridge shared] setUserId:userId];
}

RCT_EXPORT_METHOD(setTag:(NSString *)key value:(NSString *)value)
{
    [[RNHakkaCoreBridge shared] setTag:key value:value];
}

RCT_EXPORT_METHOD(addBreadcrumb:(NSString *)name attributes:(NSDictionary *)attributes)
{
    [[RNHakkaCoreBridge shared] addBreadcrumb:name attributes:attributes];
}

// MARK: - Observability: distributed tracing

RCT_EXPORT_METHOD(startTrace:(NSString *)name
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNHakkaCoreBridge shared] startTrace:name]);
}

RCT_EXPORT_METHOD(setTraceAttribute:(NSString *)traceId key:(NSString *)key value:(NSString *)value)
{
    [[RNHakkaCoreBridge shared] setTraceAttribute:traceId key:key value:value];
}

RCT_EXPORT_METHOD(setTraceMetric:(NSString *)traceId key:(NSString *)key value:(NSString *)value)
{
    [[RNHakkaCoreBridge shared] setTraceMetric:traceId key:key value:value];
}

RCT_EXPORT_METHOD(finishTrace:(NSString *)traceId)
{
    [[RNHakkaCoreBridge shared] finishTrace:traceId];
}

RCT_EXPORT_METHOD(setOnNewRequestListener:(id)callback)
{
    // NativeEventEmitter is the canonical event path.
}

// MARK: - Native Capture

RCT_EXPORT_METHOD(enableNativeWebSocket:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [[RNHakkaCoreBridge shared] enableNativeWebSocket];
    resolve(nil);
}

RCT_EXPORT_METHOD(isNativeCapturing:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve(@([[RNHakkaCoreBridge shared] isNativeCapturing]));
}

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end
