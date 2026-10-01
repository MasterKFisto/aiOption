import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, InputNumber, Row, Segmented, Space, Tag, Typography, message } from 'antd';
import { useState } from 'react';

import { api } from '../api/client';

const QUICK_STAKES = [10, 25, 50, 100];

/** Classic option ticket: CALL/PUT with stake (≤100 USDC) + 1/3/5/10m durations. */
export function ClassicTicket({ currentPrice }: { currentPrice: number }) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const [side, setSide] = useState<'CALL' | 'PUT'>('CALL');
  const [stake, setStake] = useState<number>(10);
  const [duration, setDuration] = useState<number>(300);

  const { data: config } = useQuery({ queryKey: ['options-config'], queryFn: api.optionsConfig });
  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: api.summary });

  const maxStake = config?.maxStakeUsd ?? 100;
  const minStake = config?.minStakeUsd ?? 1;
  const durations = config?.allowedDurationsSeconds ?? [60, 180, 300, 600];
  const available = summary?.account.cashBalance ?? 0;
  const profit = Number((stake * 0.8).toFixed(2));

  const openMutation = useMutation({
    mutationFn: api.openOption,
    onSuccess: (position) => {
      messageApi.success(
        `Classic ${position.side} opened — expires ${new Date(position.expiresAt!).toLocaleTimeString()}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const durationLabel = (seconds: number) =>
    seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`;

  return (
    <Card title="Classic Raise" size="small">
      {contextHolder}
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        BTC/USDC @ ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </Typography.Paragraph>

      <Row gutter={[8, 8]}>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Direction
          </Typography.Text>
          <div>
            <Segmented
              block
              options={[
                { label: '▲ CALL', value: 'CALL' },
                { label: '▼ PUT', value: 'PUT' },
              ]}
              value={side}
              onChange={(value) => setSide(value as 'CALL' | 'PUT')}
            />
          </div>
        </Col>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Duration
          </Typography.Text>
          <div>
            <Segmented
              block
              options={durations.map((d) => ({ label: durationLabel(d), value: String(d) }))}
              value={String(duration)}
              onChange={(value) => setDuration(Number(value))}
            />
          </div>
        </Col>
        <Col span={24}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Stake (USD) — {minStake} to {maxStake}
          </Typography.Text>
          <div>
            <InputNumber
              min={minStake}
              max={maxStake}
              step={1}
              value={stake}
              onChange={(value) => setStake(value ?? 10)}
              style={{ width: '100%' }}
            />
          </div>
        </Col>
        <Col span={24}>
          <Space wrap size={4}>
            {QUICK_STAKES.filter((s) => s <= maxStake).map((s) => (
              <Tag.CheckableTag key={s} checked={stake === s} onChange={() => setStake(s)}>
                ${s}
              </Tag.CheckableTag>
            ))}
          </Space>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Potential profit
          </Typography.Text>
          <div style={{ color: '#3f8600' }}>+${profit.toFixed(2)}</div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Potential loss
          </Typography.Text>
          <div style={{ color: '#cf1322' }}>-${stake.toFixed(2)}</div>
        </Col>
        <Col span={24}>
          <Button
            type="primary"
            block
            loading={openMutation.isPending}
            disabled={stake > available}
            onClick={() =>
              openMutation.mutate({
                asset: 'BTC/USDC',
                side,
                stakeUsd: stake,
                durationSeconds: duration,
              })
            }
          >
            Open {side} ({durationLabel(duration)}) for ${stake}
          </Button>
        </Col>
      </Row>
    </Card>
  );
}
