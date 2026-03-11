export interface WeeklyActivity {
  week: string
  mergedPrs: number
  reviewsGiven: number
}

export interface DirectoryEntry {
  path: string
  fileCount: number
}

export interface Dimensions {
  shipping: number
  reach: number
  reviewImpact: number
  collaboration: number
  changeSignificance: number
}

export interface RawMetrics {
  mergedPrCount: number
  activeWeeks: number
  totalWeeks: number
  shippingConsistency: number
  medianMergeHours: number
  p90MergeHours: number
  uniqueTopDirs: number
  uniqueSecondLevelDirs: number
  directoryEntropy: number
  crossAreaPrRatio: number
  reviewsGiven: number
  uniqueAuthorsReviewed: number
  reviewsOnMergedPrs: number
  medianReviewTurnaroundHours: number
  uniqueCollaborators: number
  bidirectionalCollaborators: number
  commentCount: number
  avgFilesChangedPerPr: number
  avgNetLinesPerPr: number
  multiAreaPrCount: number
  nonTrivialPrRatio: number
}

export interface Engineer {
  login: string
  name: string
  avatarUrl: string
  rank: number
  compositeScore: number
  why: string[]
  dimensions: Dimensions
  raw: RawMetrics
  weeklyActivity: WeeklyActivity[]
  topDirectories: DirectoryEntry[]
}

export interface Summary {
  repo: string
  windowStart: string
  windowEnd: string
  prsAnalyzed: number
  reviewsAnalyzed: number
  engineersAnalyzed: number
  botsFiltered: number
}

export interface Methodology {
  description: string
  weights: Record<string, number>
  filters: Record<string, unknown>
}

export interface AnalysisData {
  generatedAt: string
  summary: Summary
  topEngineers: Engineer[]
  methodology: Methodology
}
