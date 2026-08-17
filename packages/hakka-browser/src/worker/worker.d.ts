// Vite resolves `?worker&inline` imports to a Worker constructor that embeds the
// worker source as a blob URL — so the single-file CDN bundle ships one asset.
declare module '*?worker&inline' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}
