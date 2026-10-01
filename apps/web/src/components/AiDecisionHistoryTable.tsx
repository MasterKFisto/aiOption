import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Typography } from 'antd';
import { useMemo } from 'react';

import type { AiBinaryDecision, BinaryContract } from '@aioption/shared';

import { api } from '../api/client';

interface Row extends AiBinaryDecision {
  result: string | null;
  pnl: number | null;
}

/** Recent AI binary decisions with linked contract results and PnL. */
export function AiDecisionHistoryTable() {
  const { data: decisions } = useQuery({
    queryKey: ['ai-decisions', 50],
    queryFn: () => api.aiBinaryDecisions(50),
    refetchInterval: 5000,
  });
  const { data: contracts } = useQuery({
    queryKey: ['binary-history', 100],
    queryFn: () => api.binaryHistory(100),
    refetchInterval: 5000,
  });

  const rows = useMemo(() => {
    const byId = new Map<number, BinaryContract>();
    for (const contract of contracts ?? []) {
      byId.set(contract.id, contract);
    }
    return (decisions ?? []).map((decision) => {
      const contract = decision.binaryContractId ? byId.get(decision.binaryContractId) : undefined;
      let pnl: number | null = null;
      if (contract?.result === 'WIN') {
        pnl = contract.potentialProfitUsd;
      } else if (contract?.result === 'LOSE') {
        pnl = -contract.stakeUsd;
      } else if (contract?.result === 'REFUND') {
        pnl = 0;
      }
      return { ...decision, result: contract?.result ?? null, pnl };
    });
  }, [decisions, contracts]);

  const signalTag = (signal: string) => {
    if (signal === 'UP') return <Tag color="green">UP</Tag>;
    if (signal === 'DOWN') return <Tag color="red">DOWN</Tag>;
    return <Tag>NEUTRAL</Tag>;
  };

  const resultTag = (result: string | null) => {
    if (result === 'WIN') return <Tag color="green">WIN</Tag>;
    if (result === 'LOSE') return <Tag color="red">LOSE</Tag>;
    if (result === 'REFUND') return <Tag color="blue">REFUND</Tag>;
    return <Typography.Text type="secondary">—</Typography.Text>;
  };

  return (
    <Card title="AI decision history" size="small">
      <Table<Row>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        scroll={{ x: true }}
        columns={[
          {
            title: 'Time',
            dataIndex: 'createdAt',
            width: 90,
            render: (value: string) => new Date(value).toLocaleTimeString(),
          },
          { title: 'Signal', dataIndex: 'signal', width: 90, render: signalTag },
          {
            title: 'Confidence',
            dataIndex: 'confidence',
            width: 100,
            render: (value: number) => `${(value * 100).toFixed(0)}%`,
          },
          {
            title: 'Reason',
            dataIndex: 'reason',
            ellipsis: true,
            render: (value: string | null) => value ?? '—',
          },
          {
            title: 'Mode',
            dataIndex: 'mode',
            width: 110,
            render: (value: string) =>
              value === 'AUTO_EXECUTE' ? <Tag color="purple">AUTO</Tag> : <Tag>SIGNAL</Tag>,
          },
          {
            title: 'Executed',
            dataIndex: 'autoExecuted',
            width: 90,
            render: (value: boolean) => (value ? 'Yes' : 'No'),
          },
          {
            title: 'Contract',
            dataIndex: 'binaryContractId',
            width: 90,
            render: (value: number | null) => value ?? '—',
          },
          { title: 'Result', dataIndex: 'result', width: 90, render: resultTag },
          {
            title: 'PnL',
            dataIndex: 'pnl',
            width: 90,
            render: (value: number | null) =>
              value === null ? (
                '—'
              ) : (
                <span style={{ color: value >= 0 ? '#3f8600' : '#cf1322' }}>
                  {value >= 0 ? '+' : ''}
                  {value.toFixed(2)}
                </span>
              ),
          },
        ]}
      />
    </Card>
  );
}
