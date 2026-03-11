import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { WeeklyActivity } from '../types'

interface Props {
  data: WeeklyActivity[]
}

export function WeeklyChart({ data }: Props) {
  if (!data || data.length === 0) return null

  const formatted = data.map((d) => ({
    ...d,
    label: d.week.slice(5),
  }))

  return (
    <div>
      <h3 className="text-xs font-semibold text-primary mb-2">Weekly Activity</h3>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={formatted} barGap={1} barSize={8}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: '#6B6C6A' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              background: '#fff',
              border: '1px solid #D0D1C9',
              borderRadius: 8,
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10 }}
            iconSize={8}
          />
          <Bar dataKey="mergedPrs" name="PRs merged" fill="#F54E00" radius={[2, 2, 0, 0]} />
          <Bar dataKey="reviewsGiven" name="Reviews" fill="#1D4AFF" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
