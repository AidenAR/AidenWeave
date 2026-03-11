import type { DirectoryEntry } from '../types'

interface Props {
  directories: DirectoryEntry[]
}

export function DirectoryList({ directories }: Props) {
  if (!directories || directories.length === 0) return null

  const maxCount = Math.max(...directories.map((d) => d.fileCount))

  return (
    <div>
      <h3 className="text-xs font-semibold text-primary mb-2">Codebase Reach</h3>
      <div className="space-y-1">
        {directories.slice(0, 8).map((dir) => (
          <div key={dir.path} className="flex items-center gap-2">
            <span className="text-xs text-muted truncate w-[140px] shrink-0" title={dir.path}>
              {dir.path}
            </span>
            <div className="flex-1 h-2 bg-page rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-secondary"
                style={{ width: `${(dir.fileCount / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted w-6 text-right shrink-0">{dir.fileCount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
