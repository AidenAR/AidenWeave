import type { Methodology as MethodologyType, Summary } from '../types'

interface Props {
  methodology: MethodologyType
  summary: Summary
}

export function Methodology({ methodology, summary }: Props) {
  return (
    <footer className="bg-card border-t border-card-border px-6 py-3 shrink-0">
      <div className="flex items-start gap-6">
        <div className="flex-1">
          <h3 className="text-xs font-semibold text-primary mb-1">Methodology</h3>
          <p className="text-xs text-muted leading-relaxed">
            {methodology.description}
          </p>
        </div>
        <div className="shrink-0 text-xs text-muted space-y-0.5">
          <div className="flex gap-3">
            <span>Shipping <strong className="text-primary">30%</strong></span>
            <span>Reach <strong className="text-primary">20%</strong></span>
            <span>Review <strong className="text-primary">20%</strong></span>
            <span>Collab <strong className="text-primary">15%</strong></span>
            <span>Scope <strong className="text-primary">15%</strong></span>
          </div>
          <div>
            {summary.engineersAnalyzed} engineers scored · {summary.botsFiltered} bots excluded · percentile-ranked
          </div>
        </div>
      </div>
    </footer>
  )
}
