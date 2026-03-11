import type { Engineer } from '../types'

const DIMENSIONS = [
  { key: 'shipping', label: 'Shipping', color: '#F54E00' },
  { key: 'reach', label: 'Reach', color: '#FFBE2E' },
  { key: 'reviewImpact', label: 'Review Impact', color: '#1D4AFF' },
  { key: 'collaboration', label: 'Collaboration', color: '#30A46C' },
  { key: 'changeSignificance', label: 'Change Scope', color: '#8B5CF6' },
] as const

function getRawContext(eng: Engineer, dim: string): string {
  const r = eng.raw
  switch (dim) {
    case 'shipping':
      return `${r.mergedPrCount} PRs, ${r.activeWeeks}/${r.totalWeeks} active weeks, ${r.medianMergeHours}h median merge`
    case 'reach':
      return `${r.uniqueSecondLevelDirs} areas, ${Math.round(r.crossAreaPrRatio * 100)}% cross-area PRs`
    case 'reviewImpact':
      return `${r.reviewsGiven} reviews, ${r.uniqueAuthorsReviewed} authors`
    case 'collaboration':
      return `${r.uniqueCollaborators} collaborators, ${r.bidirectionalCollaborators} bidirectional`
    case 'changeSignificance':
      return `${r.avgFilesChangedPerPr} files/PR avg, ${Math.round(r.nonTrivialPrRatio * 100)}% non-trivial`
    default:
      return ''
  }
}

interface Props {
  engineer: Engineer
}

export function DimensionBars({ engineer }: Props) {
  return (
    <div className="space-y-2">
      {DIMENSIONS.map(({ key, label, color }) => {
        const value = engineer.dimensions[key as keyof typeof engineer.dimensions]
        const context = getRawContext(engineer, key)
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs font-medium text-primary w-[90px] shrink-0 text-right">
              {label}
            </span>
            <div className="flex-1 h-4 bg-page rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${value}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-xs font-bold text-primary w-8 shrink-0">
              {Math.round(value)}
            </span>
            <span className="text-xs text-muted truncate max-w-[250px]" title={context}>
              {context}
            </span>
          </div>
        )
      })}
    </div>
  )
}
