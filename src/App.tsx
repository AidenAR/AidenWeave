import { useState, useEffect } from 'react'
import type { AnalysisData, Engineer } from './types'
import { EngineerCard } from './components/EngineerCard'
import { DetailPanel } from './components/DetailPanel'
import { Methodology } from './components/Methodology'

export default function App() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Engineer | null>(null)

  useEffect(() => {
    fetch('/analysis.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load data (${r.status})`)
        return r.json()
      })
      .then((d: AnalysisData) => {
        setData(d)
        if (d.topEngineers.length > 0) setSelected(d.topEngineers[0])
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="bg-card border border-card-border rounded-xl p-8 max-w-md text-center">
          <p className="text-lg font-semibold text-primary">Failed to load dashboard</p>
          <p className="text-muted mt-2">{error}</p>
        </div>
      </div>
    )
  }

  if (!data || !selected) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-page flex flex-col" style={{ maxHeight: '100vh' }}>
      {/* Header */}
      <header className="bg-card border-b border-card-border px-6 py-3 flex items-center justify-between shrink-0">
        <h1 className="font-serif text-2xl text-primary">PostHog Engineering Impact</h1>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span className="font-medium text-primary">{data.summary.repo}</span>
          <span>{data.summary.windowStart} → {data.summary.windowEnd}</span>
          <span className="bg-page px-2 py-0.5 rounded border border-card-border">
            {data.summary.prsAnalyzed} PRs analyzed
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex flex-1 min-h-0 px-4 py-3 gap-4">
        {/* Left column: ranked list */}
        <div className="w-[340px] shrink-0 flex flex-col gap-2 overflow-y-auto pr-1">
          {data.topEngineers.map((eng) => (
            <EngineerCard
              key={eng.login}
              engineer={eng}
              isSelected={eng.login === selected.login}
              onClick={() => setSelected(eng)}
            />
          ))}
        </div>

        {/* Right column: detail */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <DetailPanel engineer={selected} />
        </div>
      </main>

      {/* Footer: methodology */}
      <Methodology methodology={data.methodology} summary={data.summary} />
    </div>
  )
}
