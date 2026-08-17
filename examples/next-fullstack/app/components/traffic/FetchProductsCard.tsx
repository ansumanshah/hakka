'use client'

import { useState } from 'react'

import { DemoCard } from './DemoCard'
import { RunStatus } from './RunStatus'
import { useTimedRun } from './useTimedRun'

interface Product {
  id: number
  name: string
  email: string
}

/** Client calls this route handler, which makes its own upstream call — the core "one click, two hops" flow. */
export function FetchProductsCard() {
  const [products, setProducts] = useState<Product[]>([])
  const { state, run } = useTimedRun()

  const handleClick = () =>
    run(async () => {
      const res = await fetch('/api/products')
      const data = (await res.json()) as { products: Product[] }
      setProducts(data.products)
      return { ok: res.ok, status: res.status, note: `${data.products.length} users` }
    })

  return (
    <DemoCard
      method="GET"
      path="/api/products"
      title="Fetch products"
      description="Client calls the route handler, which calls an upstream API. One click, two hops."
    >
      <button
        type="button"
        className="demo-btn"
        data-testid="fetch-products"
        onClick={handleClick}
        disabled={state.phase === 'pending'}
      >
        {state.phase === 'pending' ? 'Fetching…' : 'Fetch products'}
      </button>
      <RunStatus state={state} />
      {products.length > 0 && (
        <ul className="demo-list">
          {products.map((p) => (
            <li key={p.id}>{p.name}</li>
          ))}
        </ul>
      )}
    </DemoCard>
  )
}
