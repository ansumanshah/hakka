import type { ReactNode } from 'react'

interface DemoCardProps {
  /** Displayed as a colored mono label: GET, POST, DELETE, or a stand-in like ACTION/PARALLEL/CONSOLE. */
  method: string
  /** The path or call this card exercises, shown as plain mono text next to the method. */
  path: string
  title: string
  description: string
  children: ReactNode
}

/** Shared shell for a traffic-generator card: method + path, title, one-line description, then the button/status. */
export function DemoCard({ method, path, title, description, children }: DemoCardProps) {
  return (
    <article className="demo-card">
      <div className="demo-card-meta">
        <span className={`demo-method demo-method-${method.toLowerCase()}`}>{method}</span>
        <span className="demo-path">{path}</span>
      </div>
      <h3 className="demo-card-title">{title}</h3>
      <p className="demo-card-desc">{description}</p>
      <div className="demo-card-action">{children}</div>
    </article>
  )
}
