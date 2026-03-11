import type { Engineer } from '../types'
import { DimensionBars } from './DimensionBars'
import { WeeklyChart } from './WeeklyChart'
import { DirectoryList } from './DirectoryList'

function getArchetype(eng: Engineer): string {
  const dims = eng.dimensions
  const entries = Object.entries(dims) as [string, number][]
  entries.sort((a, b) => b[1] - a[1])
  const top2 = entries.slice(0, 2).map(([k]) => k)

  const labels: Record<string, string> = {
    shipping: 'Consistent Shipper',
    reach: 'Broad-Reach Builder',
    reviewImpact: 'Review Backbone',
    collaboration: 'Team Connector',
    changeSignificance: 'High-Impact Contributor',
  }

  return top2.map((k) => labels[k]).join(' & ')
}

interface Props {
  engineer: Engineer
}

export function DetailPanel({ engineer }: Props) {
  const archetype = getArchetype(engineer)

  return (
    <div className="bg-card border border-card-border rounded-lg p-5 h-full flex flex-col gap-4">
      {/* Profile header */}
      <div className="flex items-start gap-4">
        <img
          src={engineer.avatarUrl}
          alt={engineer.name}
          className="w-16 h-16 rounded-full shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-xl text-primary">{engineer.name}</h2>
            <span className="bg-accent text-white text-xs font-bold px-2 py-0.5 rounded-full">
              #{engineer.rank}
            </span>
          </div>
          <p className="text-sm text-muted mt-0.5">@{engineer.login}</p>
          <p className="text-sm font-medium text-accent mt-1">{archetype}</p>
        </div>
      </div>

      {/* Why bullets — prominent */}
      <div className="bg-page rounded-lg px-4 py-3 border border-card-border">
        <ul className="space-y-1.5">
          {engineer.why.map((bullet, i) => (
            <li key={i} className="text-sm text-primary flex gap-2 leading-snug">
              <span className="text-accent font-bold shrink-0">→</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Dimension breakdown */}
      <DimensionBars engineer={engineer} />

      {/* Bottom row: chart + directories */}
      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <WeeklyChart data={engineer.weeklyActivity} />
        </div>
        <div className="w-[260px] shrink-0">
          <DirectoryList directories={engineer.topDirectories} />
        </div>
      </div>
    </div>
  )
}
