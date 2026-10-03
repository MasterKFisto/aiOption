import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Tooltip, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useState } from 'react';

import type { AiDecision, AiDecisionFeatures, MarketSignal } from '@aioption/shared';

import { api } from '../api/client';
import { DecisionDrawer, decisionOutcome } from '../components/DecisionDetails';

const SIGNAL_COLORS: Record<MarketSignal, string> = {
  BULLISH: 'green',
  BEARISH: 'red',
  NEUTRAL: 'default',
};

export const FINAL_COLORS: Record<AiDecisionFeatures['finalSignal'], string> = {
  CALL: 'green',
  PUT: 'red',
  NEUTRAL: 'default',
};

function RsiTag({ features }: { features: AiDecisionFeatures | null | undefined }) {
  if (!features || features.rsi === null) {
    return <>—</>;
  }
  const color =
    features.regime === 'OVERBOUGHT' ? 'volcano' : features.regime === 'OVERSOLD' ? 'blue' : 'default';
  return (
    <Tooltip
      title={`${features.regime} (oversold < ${features.rsiOversold}, overbought > ${features.rsiOverbought})`}
    >
      <Tag color={color}>{features.rsi.toFixed(1)}</Tag>
    </Tooltip>
  );
}

/**
 * AI Decisions (Phase 6.5.2): every indicator the classic AI used, the final
 * signal, the current direction streak, and exactly why a trade was taken,
 * neutralized (strategy filter) or blocked (risk engine).
 */
export function DecisionsPage() {
  const [selected, setSelected] = useState<AiDecision | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['decisions'],
    queryFn: () => api.decisions(100),
    refetchInterval: 10000,
  });

  const columns: TableProps<AiDecision>['columns'] = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    {
      title: 'Time',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    { title: 'Symbol', dataIndex: 'symbol', width: 100 },
    {
      title: 'Final signal',
      key: 'final',
      width: 110,
      render: (_v, d) =>
        d.features ? (
          <Tag color={FINAL_COLORS[d.features.finalSignal]}>{d.features.finalSignal}</Tag>
        ) : (
          <Tag color={SIGNAL_COLORS[d.signal]}>{d.signal}</Tag>
        ),
    },
    {
      title: 'Price',
      key: 'price',
      width: 110,
      render: (_v, d) => (d.features ? d.features.currentPrice.toFixed(2) : '—'),
    },
    {
      title: 'Momentum',
      key: 'momentum',
      width: 100,
      render: (_v, d) => (d.features ? `${d.features.momentumPercent.toFixed(2)}%` : '—'),
    },
    { title: 'RSI', key: 'rsi', width: 80, render: (_v, d) => <RsiTag features={d.features} /> },
    {
      title: 'Volatility',
      key: 'vol',
      width: 100,
      render: (_v, d) => (d.features ? `${d.features.volatilityPercent.toFixed(1)}%` : '—'),
    },
    {
      title: 'Streak PUT / CALL',
      key: 'streak',
      width: 130,
      render: (_v, d) =>
        d.features ? `${d.features.consecutivePutCount} / ${d.features.consecutiveCallCount}` : '—',
    },
    {
      title: 'Confidence',
      dataIndex: 'confidence',
      width: 100,
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    {
      title: 'Outcome / why',
      key: 'outcome',
      render: (_v, d) => {
        const outcome = decisionOutcome(d);
        return <Tag color={outcome.color}>{outcome.label}</Tag>;
      },
    },
    {
      title: 'Position',
      dataIndex: 'positionId',
      width: 90,
      render: (v: number | null) => (v === null ? '—' : `#${v}`),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        AI Decisions
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Click a row to see every indicator the AI used and exactly why it chose or rejected a direction.
      </Typography.Paragraph>
      {error ? (
        <Typography.Text type="danger">{(error as Error).message}</Typography.Text>
      ) : (
        <Table<AiDecision>
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: true }}
          onRow={(record) => ({ onClick: () => setSelected(record), style: { cursor: 'pointer' } })}
        />
      )}
      <DecisionDrawer decision={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
