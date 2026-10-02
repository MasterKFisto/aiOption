import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, InputNumber, Row, Select, Space, Segmented, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';

import { api } from '../api/client';
import { durationLabel } from './ClassicTradingPanel';

const QUICK_STAKES = [10, 25, 50, 100];
const DEFAULT_DURATIONS = [60, 180, 300, 600, 900, 1800, 3600];

/**
 * Classic option ticket: CALL/PUT, stake (≤ max stake) and a fixed duration
 * (1–60 minutes, default 10). Opening locks ONLY the chosen stake.
 */
export function ClassicTicket({ currentPrice }: { currentPrice: number }) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const { data: config } = useQuery({ queryKey: ['options-config'], queryFn: api.optionsConfig });
  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: api.summary });
  const { data: status } = useQuery({ queryKey: ['classic-status'], queryFn: api.classicStatus });

  const [side, setSide] = useState<'CALL' | 'PUT'>('CALL');
  const [stake, setStake] = useState<number>(10);
  const [duration, setDuration] = useState<number>(600);
  const [initialized, setInitialized] = useState(false);

  // Adopt the saved defaults (stake + 10-minute duration) once loaded.
  useEffect(() => {
    if (config && !initialized) {
      setStake(config.defaultStakeUsd);
      setDuration(config.defaultDurationSeconds);
      setInitialized(true);
    }
  }, [config, initialized]);

  const maxStake = config?.maxStakeUsd ?? 100;
  const minStake = config?.minStakeUsd ?? 1;
  const durations = config?.allowedDurationsSeconds ?? DEFAULT_DURATIONS;
  const available = summary?.account.cashBalance ?? 0;
  const profit = Number((stake * 0.8).toFixed(2));
  const tradingEnabled = status?.tradingEnabled ?? summary?.account.tradingEnabled ?? false;
  const ticketError =
    stake > maxStake
      ? `Maximum option stake is ${maxStake} USDC.`
      : stake > available
        ? 'Insufficient available balance.'
        : null;

  const openMutation = useMutation({
    mutationFn: api.openOption,
    onSuccess: (position) => {
      messageApi.success(
        `Classic ${position.side} opened — expires ${new Date(position.expiresAt!).toLocaleTimeString()}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
      void queryClient.invalidateQueries({ queryKey: ['classic-status'] });
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

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
            <Select
              aria-label="Option duration"
              style={{ width: '100%' }}
              options={durations.map((d) => ({ label: durationLabel(d), value: d }))}
              value={duration}
              onChange={(value: number) => setDuration(value)}
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
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Available ${available.toFixed(2)} · only the stake is locked
          </Typography.Text>
        </Col>
        {ticketError && (
          <Col span={24}>
            <Alert type="error" showIcon message={ticketError} />
          </Col>
        )}
        {!tradingEnabled && (
          <Col span={24}>
            <Alert type="info" showIcon message="Press Start Trading in the panel to enable Classic Options." />
          </Col>
        )}
        <Col span={24}>
          <Button
            type="primary"
            block
            loading={openMutation.isPending}
            disabled={ticketError !== null || !tradingEnabled}
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
