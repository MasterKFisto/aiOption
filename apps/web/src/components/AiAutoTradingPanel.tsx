import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';

import type { AiBinaryMode } from '@aioption/shared';

import { api } from '../api/client';

type ModeValue = AiBinaryMode;

const modeOptions: Array<{ label: string; value: ModeValue }> = [
  { label: 'Disabled', value: 'DISABLED' },
  { label: 'Signal Only', value: 'SIGNAL_ONLY' },
  { label: 'Auto Execute', value: 'AUTO_EXECUTE' },
];

const signalTag = (signal: string | null) => {
  if (signal === 'UP') return <Tag color="green">▲ UP</Tag>;
  if (signal === 'DOWN') return <Tag color="red">▼ DOWN</Tag>;
  if (signal === 'NEUTRAL') return <Tag>— NEUTRAL</Tag>;
  return <Tag>—</Tag>;
};

/** AI Auto Trading control panel: status, signal, settings, performance, warnings. */
export function AiAutoTradingPanel() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ['ai-status'],
    queryFn: api.aiBinaryStatus,
    refetchInterval: 2000,
  });
  const { data: binaryConfig } = useQuery({
    queryKey: ['binary-config'],
    queryFn: api.binaryConfig,
  });

  // Local form state seeded from the server status.
  const [mode, setMode] = useState<ModeValue>('SIGNAL_ONLY');
  const [stakeUsd, setStakeUsd] = useState(10);
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [payoutRatio, setPayoutRatio] = useState(0.8);
  const [minConfidence, setMinConfidence] = useState(0.65);
  const [maxOpenContracts, setMaxOpenContracts] = useState(0);
  const [maxSessionLossUsd, setMaxSessionLossUsd] = useState(20);
  const [seeded, setSeeded] = useState(false);
  const [confirmingAuto, setConfirmingAuto] = useState(false);

  useEffect(() => {
    if (status && !seeded) {
      setMode(status.mode);
      setStakeUsd(status.stakeUsd);
      setDurationSeconds(status.durationSeconds);
      setPayoutRatio(status.payoutRatio);
      setMinConfidence(status.minConfidence ?? 0.65);
      setMaxOpenContracts(status.maxOpenContracts ?? 0);
      setMaxSessionLossUsd(status.maxSessionLossUsd ?? 20);
      setSeeded(true);
    }
  }, [status, seeded]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
  };

  const saveSettings = useMutation({
    mutationFn: () =>
      api.aiBinarySettings({
        mode,
        stakeUsd,
        durationSeconds,
        payoutRatio,
        minConfidence,
        maxOpenContracts,
        maxSessionLossUsd,
      }),
    onSuccess: refresh,
  });

  const startAi = useMutation({
    mutationFn: api.aiBinaryStart,
    onSuccess: refresh,
  });

  const stopAi = useMutation({
    mutationFn: api.aiBinaryStop,
    onSuccess: refresh,
  });

  const onSave = () => {
    // Confirm only when switching INTO AUTO_EXECUTE.
    if (mode === 'AUTO_EXECUTE' && status?.mode !== 'AUTO_EXECUTE') {
      setConfirmingAuto(true);
      return;
    }
    saveSettings.mutate();
  };

  const confirmAutoExecute = () => {
    setConfirmingAuto(false);
    saveSettings.mutate();
  };

  const stats = status?.sessionStats;
  const winRate =
    stats && stats.wins + stats.losses > 0
      ? (stats.wins / (stats.wins + stats.losses)) * 100
      : 0;
  const running = status?.running ?? false;
  const error = saveSettings.error ?? startAi.error ?? stopAi.error ?? null;
  const enabled = status?.enabled ?? false;

  return (
    <Card
      title="AI Auto Trading"
      size="small"
      extra={
        running ? (
          <Tag color="green">RUNNING</Tag>
        ) : (
          <Tag color={status?.mode === 'DISABLED' ? 'default' : 'orange'}>STOPPED</Tag>
        )
      }
    >
      <Alert
        type="warning"
        showIcon
        message="Automatic 5-to-10-second binary options trading is extremely high risk. Losses can occur rapidly and repeatedly."
        style={{ marginBottom: 12 }}
      />

      {!enabled && (
        <Alert
          type="info"
          showIcon
          message="AI binary trading is disabled by configuration (AI_BINARY_ENABLED=false)."
          style={{ marginBottom: 12 }}
        />
      )}

      <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Signal">
          <Space>
            {signalTag(status?.currentSignal ?? null)}
            <Typography.Text type="secondary">
              {status?.currentSignal && status.currentSignal !== 'NEUTRAL'
                ? `confidence ${(status?.confidence * 100).toFixed(0)}%`
                : (status?.reason ?? 'waiting for signal')}
            </Typography.Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Mode">
          {modeOptions.find((option) => option.value === status?.mode)?.label ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Open AI contracts">
          {status?.openContracts ?? 0}
        </Descriptions.Item>
      </Descriptions>


      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Mode
          </Typography.Text>
          <div>
            <Segmented
              size="small"
              block
              options={modeOptions}
              value={mode}
              onChange={(value) => setMode(value as ModeValue)}
            />
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Duration
          </Typography.Text>
          <div>
            <Segmented
              size="small"
              block
              options={(binaryConfig?.allowedDurationsSeconds ?? [5, 10]).map(String)}
              value={String(durationSeconds)}
              onChange={(value) => setDurationSeconds(Number(value))}
            />
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Stake (USD)
          </Typography.Text>
          <div>
            <InputNumber
              size="small"
              min={1}
              max={1000}
              step={1}
              value={stakeUsd}
              onChange={(value) => setStakeUsd(value ?? 10)}
              style={{ width: '100%' }}
            />
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Payout ratio
          </Typography.Text>
          <div>
            <Segmented
              size="small"
              block
              options={(binaryConfig?.allowedPayoutRatios ?? [0.5, 0.6, 0.7, 0.8, 0.9]).map(
                (ratio) => ({
                  label: `${Math.round(ratio * 100)}%`,
                  value: String(ratio),
                }),
              )}
              value={String(payoutRatio)}
              onChange={(value) => setPayoutRatio(Number(value))}
            />
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Min confidence
          </Typography.Text>
          <div>
            <InputNumber
              size="small"
              min={0.5}
              max={0.95}
              step={0.05}
              value={minConfidence}
              onChange={(value) => setMinConfidence(value ?? 0.65)}
              style={{ width: '100%' }}
            />
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Max session loss (USD)
          </Typography.Text>
          <div>
            <InputNumber
              size="small"
              min={1}
              max={1000}
              value={maxSessionLossUsd}
              onChange={(value) => setMaxSessionLossUsd(value ?? 20)}
              style={{ width: '100%' }}
            />
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Max open contracts (0 = unlimited)
          </Typography.Text>
          <div>
            <InputNumber
              size="small"
              min={0}
              max={1000}
              precision={0}
              value={maxOpenContracts}
              onChange={(value) => setMaxOpenContracts(value ?? 0)}
              style={{ width: '100%' }}
            />
          </div>
        </Col>
      </Row>

      <Space wrap style={{ marginBottom: 12 }}>
        <Button type="primary" size="small" loading={saveSettings.isPending} onClick={onSave}>
          Save settings
        </Button>
        <Button
          type="primary"
          ghost
          size="small"
          disabled={running || mode === 'DISABLED'}
          loading={startAi.isPending}
          onClick={() => startAi.mutate()}
        >
          Start AI
        </Button>
        <Button
          danger
          size="small"
          disabled={!running}
          loading={stopAi.isPending}
          onClick={() => stopAi.mutate()}
        >
          Stop AI
        </Button>
      </Space>

      {error && (
        <Alert type="error" showIcon message={(error as Error).message} style={{ marginBottom: 12 }} />
      )}

      <Row gutter={8} style={{ marginBottom: 12 }}>
        <Col span={8}>
          <Statistic title="Signals" value={stats?.totalSignals ?? 0} valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col span={8}>
          <Statistic title="Trades" value={stats?.totalTrades ?? 0} valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col span={8}>
          <Statistic
            title="Win rate"
            value={winRate}
            precision={0}
            suffix="%"
            valueStyle={{ fontSize: 16 }}
          />
        </Col>
        <Col span={8}>
          <Statistic title="Wins" value={stats?.wins ?? 0} valueStyle={{ fontSize: 16, color: '#3f8600' }} />
        </Col>
        <Col span={8}>
          <Statistic title="Losses" value={stats?.losses ?? 0} valueStyle={{ fontSize: 16, color: '#cf1322' }} />
        </Col>
        <Col span={8}>
          <Statistic title="Refunds" value={stats?.refunds ?? 0} valueStyle={{ fontSize: 16 }} />
        </Col>
        <Col span={8}>
          <Statistic
            title="Net PnL"
            value={stats?.netPnl ?? 0}
            precision={2}
            prefix="$"
            valueStyle={{ fontSize: 16, color: (stats?.netPnl ?? 0) >= 0 ? '#3f8600' : '#cf1322' }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="Consecutive losses"
            value={stats?.consecutiveLosses ?? 0}
            valueStyle={{
              fontSize: 16,
              color: (stats?.consecutiveLosses ?? 0) > 0 ? '#cf1322' : undefined,
            }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="Session loss left"
            value={Math.max(maxSessionLossUsd - (stats?.sessionLossUsd ?? 0), 0)}
            precision={2}
            prefix="$"
            valueStyle={{ fontSize: 16 }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="Session profit"
            value={stats?.sessionProfitUsd ?? 0}
            precision={2}
            prefix="$"
            valueStyle={{ fontSize: 16, color: (stats?.sessionProfitUsd ?? 0) > 0 ? '#3f8600' : undefined }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="Daily profit"
            value={status?.dailyProfitUsd ?? 0}
            precision={2}
            prefix="$"
            valueStyle={{ fontSize: 16, color: (status?.dailyProfitUsd ?? 0) > 0 ? '#3f8600' : undefined }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="Until profit target"
            value={stats?.remainingProfitUntilTarget ?? 0}
            precision={2}
            prefix="$"
            valueStyle={{ fontSize: 16 }}
          />
        </Col>
      </Row>

      {status?.stoppedByProfitTarget && (
        <Alert
          type="success"
          showIcon
          message="Profit target reached. You may withdraw profit or keep it in the wallet for the next trading session."
          style={{ marginBottom: 8 }}
        />
      )}

      {(status?.warnings ?? []).map((warning) => (
        <Alert key={warning} type="warning" showIcon message={warning} style={{ marginBottom: 8 }} />
      ))}

      <Modal
        title="Confirm automatic execution"
        open={confirmingAuto}
        onOk={confirmAutoExecute}
        onCancel={() => setConfirmingAuto(false)}
        okText="I understand — enable auto execution"
        okButtonProps={{ danger: true }}
      >
        <p>
          Auto Execute mode makes the AI <strong>automatically open binary options contracts</strong>{' '}
          using your account balance.
        </p>
        <p>
          AI binary trading can lose funds quickly and repeatedly. Signal confidence is a
          statistical estimate, not a guarantee of profit. Never trade with funds you cannot
          afford to lose.
        </p>
        <p>
          Risk controls (session loss limit, consecutive-loss stop, global loss floor) remain
          active and may stop the AI automatically.
        </p>
      </Modal>
    </Card>
  );
}

