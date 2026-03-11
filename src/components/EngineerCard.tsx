import type { Engineer } from '../types'

const DIMENSION_COLORS: Record<string, string> = {
  shipping: '#F54E00',
  reach: '#FFBE2E',
  reviewImpact: '#1D4AFF',
  collaboration: '#30A46C',
  changeSignificance: '#8B5CF6',
}

const DIMENSION_SHORT: Record<string, string> = {
  shipping: 'Ship',
  reach: 'Reach',
  reviewImpact: 'Review',
  collaboration: 'Collab',
  changeSignificance: 'Scope',
}

interface Props {
  engineer: Engineer
  isSelected: boolean
  onClick: () => void
}

export function EngineerCard({ engineer, isSelected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-card border rounded-lg p-3 transition-all cursor-pointer ${
        isSelected
          ? 'border-accent shadow-sm ring-1 ring-accent/20'
          : 'border-card-border hover:border-muted'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Rank */}
        <span className="text-2xl font-serif font-bold text-accent leading-none mt-0.5">
          {engineer.rank}
        </span>

        {/* Avatar */}
        <img
          src={engineer.avatarUrl}
          alt={engineer.name}
          className="w-9 h-9 rounded-full shrink-0 mt-0.5"
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-sm text-primary truncate">
              {engineer.name}
            </span>
            <span className="text-xs text-muted truncate">@{engineer.login}</span>
          </div>

          {/* Why bullets */}
          <ul className="mt-1.5 space-y-0.5">
            {engineer.why.slice(0, 3).map((bullet, i) => (
              <li key={i} className="text-xs text-muted leading-snug flex gap-1">
                <span className="text-accent shrink-0">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>

          {/* Mini dimension bars */}
          <div className="flex gap-1 mt-2">
            {(Object.entries(engineer.dimensions) as [string, number][]).map(
              ([key, value]) => (
                <div key={key} className="flex-1" title={`${DIMENSION_SHORT[key]}: ${value}`}>
                  <div className="h-1.5 rounded-full bg-page overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${value}%`,
                        backgroundColor: DIMENSION_COLORS[key],
                      }}
                    />
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
