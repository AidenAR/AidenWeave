export interface RawPR {
  number: number;
  title: string;
  createdAt: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  author: { login: string; name: string | null; avatarUrl: string; type: string };
  reviews: { login: string; type: string; state: string; submittedAt: string }[];
  files: string[];
}

export interface ReviewGiven {
  prNumber: number;
  authorLogin: string;
  state: string;
  submittedAt: string;
  prCreatedAt: string;
  prMerged: boolean;
}

export interface EngineerData {
  login: string;
  name: string;
  avatarUrl: string;
  prs: RawPR[];
  reviewsGivenList: ReviewGiven[];
}

export interface ComputedMetrics {
  login: string;
  name: string;
  avatarUrl: string;
  mergedPrCount: number;
  activeWeeks: number;
  totalWeeks: number;
  shippingConsistency: number;
  medianMergeHours: number;
  p90MergeHours: number;
  uniqueTopDirs: number;
  uniqueSecondLevelDirs: number;
  directoryEntropy: number;
  crossAreaPrRatio: number;
  reviewsGiven: number;
  uniqueAuthorsReviewed: number;
  reviewsOnMergedPrs: number;
  medianReviewTurnaroundHours: number;
  uniqueCollaborators: number;
  bidirectionalCollaborators: number;
  commentCount: number;
  avgFilesChangedPerPr: number;
  avgNetLinesPerPr: number;
  multiAreaPrCount: number;
  nonTrivialPrRatio: number;
  weeklyActivity: { week: string; mergedPrs: number; reviewsGiven: number }[];
  topDirectories: { path: string; fileCount: number }[];
}

export interface Dimensions {
  shipping: number;
  reach: number;
  reviewImpact: number;
  collaboration: number;
  changeSignificance: number;
}

export interface ScoredEngineer extends ComputedMetrics {
  dimensions: Dimensions;
  compositeScore: number;
}

export interface FetchConfig {
  owner: string;
  repo: string;
  days: number;
  token: string;
  windowStart: Date;
  windowEnd: Date;
  full: boolean;
  cachePath: string;
}
