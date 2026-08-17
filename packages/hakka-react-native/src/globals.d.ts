/* eslint-disable @typescript-eslint/no-explicit-any */

declare const __DEV__: boolean

declare class XMLHttpRequest extends EventTarget {
  static readonly UNSENT: 0
  static readonly OPENED: 1
  static readonly HEADERS_RECEIVED: 2
  static readonly LOADING: 3
  static readonly DONE: 4

  readonly UNSENT: 0
  readonly OPENED: 1
  readonly HEADERS_RECEIVED: 2
  readonly LOADING: 3
  readonly DONE: 4

  readonly readyState: number
  readonly response: any
  readonly responseText: string
  readonly responseType: string
  readonly status: number
  readonly statusText: string

  open(method: string, url: string | URL, async?: boolean, user?: string | null, password?: string | null): void
  send(data?: any): void
  setRequestHeader(header: string, value: string): void
  getResponseHeader(name: string): string | null
  getAllResponseHeaders(): string
  abort(): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void
}

declare type RequestInfo = string | URL | Request

declare module 'react-native/Libraries/TurboModule/RCTExport' {
  export interface TurboModule {
    getConstants?(): Record<string, unknown>
  }
}

declare module 'react-native' {
  export interface TurboModule {
    getConstants?(): Record<string, unknown>
  }
  export const Platform: {
    OS: 'ios' | 'android' | 'web'
    Version: number
    select: <T>(obj: { ios?: T; android?: T; web?: T; default?: T }) => T
  }
  export const NativeModules: Record<string, any>
  export class NativeEventEmitter {
    constructor(nativeModule?: any)
    addListener(eventType: string, listener: (...args: any[]) => void): { remove(): void }
    removeAllListeners(eventType: string): void
  }
  export namespace StyleSheet {
    function create<T extends Record<string, any>>(styles: T): T
    function flatten(...styles: any[]): any
    const hairlineWidth: number
    const absoluteFill: any
    const absoluteFillObject: any
    type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle }
  }
  export const Dimensions: {
    get: (dim: 'window' | 'screen') => { width: number; height: number }
    addEventListener: (type: string, handler: any) => { remove(): void }
  }
  export const DeviceEventEmitter: {
    addListener(eventType: string, listener: (...args: any[]) => void): { remove(): void }
  }
  export const Appearance: {
    getColorScheme: () => 'light' | 'dark' | null
    addChangeListener: (listener: any) => { remove(): void }
  }
  export const Share: {
    share(content: any, options?: any): Promise<any>
    sharedAction: string
    dismissedAction: string
  }
  export const Alert: { alert(title: string, message?: string, buttons?: any[]): void }
  export const ActivityIndicator: any
  export const RefreshControl: any
  export const PanResponder: any
  export type PanResponderGestureState = any
  export namespace Animated {
    class Value {
      constructor(value: number)
      setValue(value: number): void
      setOffset(offset: number): void
      flattenOffset(): void
      extractOffset(): void
      addListener(callback: (state: { value: number }) => void): string
      removeListener(id: string): void
      removeAllListeners(): void
      stopAnimation(callback?: (value: number) => void): void
      interpolate(config: any): any
    }
    class ValueXY {
      x: Value
      y: Value
      constructor(valueIn?: { x: number | Value; y: number | Value })
      setValue(value: { x: number; y: number }): void
      setOffset(offset: { x: number; y: number }): void
      flattenOffset(): void
      extractOffset(): void
      stopAnimation(callback?: (value: { x: number; y: number }) => void): void
      addListener(callback: (value: { x: number; y: number }) => void): string
      removeListener(id: string): void
      getLayout(): { left: Value; top: Value }
      getTranslateTransform(): [{ translateX: Value }, { translateY: Value }]
    }
    const View: any
    const Text: any
    const Image: any
    const ScrollView: any
    function timing(value: Value | ValueXY, config: any): any
    function spring(value: Value | ValueXY, config: any): any
    function decay(value: Value | ValueXY, config: any): any
    function event(argMapping: any[], config?: any): (...args: any[]) => void
    function parallel(animations: any[], config?: any): any
    function sequence(...animations: any[]): any
    function loop(animation: any, config?: any): any
  }
  export const Pressable: any
  export const View: any
  export const Text: any
  export const ScrollView: any
  export const FlatList: any
  export const TextInput: any
  export const TouchableOpacity: any
  export const Image: any
  export const Modal: any
  export const StatusBar: any
  export const useColorScheme: () => 'light' | 'dark' | null
  export const useWindowDimensions: () => { width: number; height: number }
  export const PixelRatio: { get(): number; roundToNearestPixel(px: number): number }
  export const Accelerometer: any
  export type ViewStyle = Record<string, any>
  export type TextStyle = Record<string, any>
  export type ImageStyle = Record<string, any>
  export type StyleProp<T> = T | T[] | null | undefined
  export type ColorSchemeName = 'light' | 'dark' | null
  export type LayoutChangeEvent = any
  export type GestureResponderEvent = any
  export type NativeSyntheticEvent<T> = any
  export type NativeScrollEvent = any
  export const TurboModuleRegistry: {
    get<T>(name: string): T | null
    getEnforcing<T>(name: string): T
  }
}

declare module 'react-native/Libraries/TurboModule/TurboModuleRegistry' {
  export function get<T>(name: string): T | null
  export function getEnforcing<T>(name: string): T
}

declare module 'react-native-svg' {
  import type { ComponentType } from 'react'
  export const Svg: ComponentType<any>
  export const Path: ComponentType<any>
  export const Circle: ComponentType<any>
  export const Rect: ComponentType<any>
  export const Line: ComponentType<any>
  export const G: ComponentType<any>
  export const Defs: ComponentType<any>
  export const ClipPath: ComponentType<any>
  export default Svg
}

declare module 'react-native-reanimated' {
  const _default: any
  export default _default
  export const useAnimatedStyle: any
  export const useSharedValue: any
  export const cancelAnimation: any
  export const withDelay: any
  export const withRepeat: any
  export const withSpring: any
  export const withTiming: any
  export const withSequence: any
  export const runOnJS: any
  export const interpolate: any
  export const Extrapolate: any
}

declare module 'react-native-gesture-handler' {
  import type { ComponentType } from 'react'
  export const GestureDetector: ComponentType<any>
  export const Gesture: any
  export const GestureHandlerRootView: ComponentType<any>
}

declare module 'react-native-mmkv' {
  export class MMKV {
    constructor(config?: { id?: string })
    set(key: string, value: string | number | boolean): void
    getString(key: string): string | undefined
    getNumber(key: string): number | undefined
    getBoolean(key: string): boolean | undefined
    delete(key: string): void
    getAllKeys(): string[]
    clearAll(): void
    contains(key: string): boolean
  }
}
