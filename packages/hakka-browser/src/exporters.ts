/**
 * Lazy barrel for the heavy report serializers (HAR / Postman / OpenTelemetry).
 * These are only reached on an explicit Export click, so the export handlers
 * dynamic-import this module — keeping har.ts / postman.ts / the OTel serializer
 * out of the initial UI chunk the inspector loads on open.
 */
export { exportHarString, exportPostmanString, recordsToOtelJson, networkRequestToRecord } from 'hakka-core'
