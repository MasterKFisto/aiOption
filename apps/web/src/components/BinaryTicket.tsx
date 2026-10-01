import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, InputNumber, Modal, Row, Segmented, Space, Tag, Typography, message } from 'antd';
import { useState } from 'react';

import { api } from '../api/client';

/** "Binary Raise" quick ticket: UP/DOWN with quick stake/duration/ratio. */
export function BinaryTicket({ currentPrice }: { currentPrice: number }) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP');
  const [stake, setStake] = useState<number>(10);
  const [duration, setDuration] = useState<number>(5);
  const [payoutRatio, setPayoutRatio] = useState<number>(0.8);
  const [confirming, setConfirming] = useState(false);

  const { data: config } = useQuery({ queryKey: ['binary-config'], queryFn: api.binaryConfig });
  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: api.summary });

  const profit = Number((stake * payoutRatio).toFixed(2));
  const totalReturn = Number((stake + profit).toFixed(2));
  const available = summary?.account.cashBalance ?? 0;

  const openMutation = useMutation({
    mutationFn: api.openBinary,
    onSuccess: (contract) => {
      messageApi.success(`Binary ${contract.direction} opened — expires in ${duration}s`);
      void queryClient.invalidateQueries({ queryKey: ['binary-open'] });
      void queryClient.invalidateQueries({ queryKey: ['binary-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
    onError: (err) => messageApi.error((err as Error).message),
  });

  const confirmOpen = () => {
    setConfirming(false);
    openMutation.mutate({
      asset: 'BTC/USDC',
      direction,
      stakeUsd: stake,
      durationSeconds: duration,
      payoutRatio,
    });
  };

  const requestOpen = () => {
    const requireConfirm = window.localStorage.getItem('aioption-binary-confirm') !== 'false';
    if (requireConfirm) {
      setConfirming(true);
    } else {
      confirmOpen();
    }
  };

  const ratios = config?.allowedPayoutRatios ?? [0.5, 0.7, 0.8, 0.9];
  const durations = config?.allowedDurationsSeconds ?? [5, 10];

  return (
    <Card title="Binary Raise" size="small">
      {contextHolder}
      <Alert
        type="warning"
        showIcon
        message="Short-duration binary options are extremely high risk and may result in rapid losses."
        style={{ marginBottom: 12 }}
      />
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        BTC/USDC @ ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </Typography.Paragraph>

      <Space direction="vertical" style={{ width: '100%' }}>
        <Row gutter={8}>
          <Col span={12}>
            <Button
              type={direction === 'UP' ? 'primary' : 'default'}
              style={{ width: '100%', background: direction === 'UP' ? '#3f8600' : undefined }}
              onClick={() => setDirection('UP')}
            >
              ▲ UP
            </Button>
          </Col>
          <Col span={12}>
            <Button
              danger={direction === 'DOWN'}
              style={{ width: '100%', background: direction === 'DOWN' ? '#cf1322' : undefined }}
              onClick={() => setDirection('DOWN')}
            >
              ▼ DOWN
            </Button>
          </Col>
        </Row>

        <div>
          <Typography.Text type="secondary">Stake (USDC): </Typography.Text>
          <Space wrap style={{ marginTop: 4 }}>
            {[5, 10, 20].map((value) => (
              <Button key={value} size="small" type={stake === value ? 'primary' : 'default'} onClick={() => setStake(value)}>
                {value}
              </Button>
            ))}
            <InputNumber min={config?.minStakeUsd ?? 1} max={config?.maxStakeUsd ?? 50} value={stake} onChange={(v) => setStake(Number(v))} />
          </Space>
        </div>

        <div>
          <Typography.Text type="secondary">Duration: </Typography.Text>
          <Segmented options={durations.map((d) => `${d}s`)} value={`${duration}s`} onChange={(v) => setDuration(Number(String(v).replace('s', '')))} style={{ marginLeft: 8 }} />
        </div>

        <div>
          <Typography.Text type="secondary">Payout ratio: </Typography.Text>
          <Space wrap style={{ marginTop: 4 }}>
            {ratios.map((ratio) => (
              <Button
                key={ratio}
                size="small"
                type={payoutRatio === ratio ? 'primary' : 'default'}
                onClick={() => setPayoutRatio(ratio)}
              >
                {Math.round(ratio * 100)}%
              </Button>
            ))}
          </Space>
        </div>

        <Card size="small">
          <Row gutter={8}>
            <Col span={8}>
              <Typography.Text type="secondary">Stake</Typography.Text>
              <div>${stake.toFixed(2)}</div>
            </Col>
            <Col span={8}>
              <Typography.Text type="secondary">Payout</Typography.Text>
              <div>{Math.round(payoutRatio * 100)}%</div>
            </Col>
            <Col span={8}>
              <Typography.Text type="secondary">Potential profit</Typography.Text>
              <div style={{ color: '#3f8600' }}>+${profit.toFixed(2)}</div>
            </Col>
            <Col span={8} style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">Return if win</Typography.Text>
              <div>${totalReturn.toFixed(2)}</div>
            </Col>
            <Col span={8} style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">Loss if lose</Typography.Text>
              <div style={{ color: '#cf1322' }}>-${stake.toFixed(2)}</div>
            </Col>
            <Col span={8} style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">Available</Typography.Text>
              <div>${available.toFixed(2)}</div>
            </Col>
          </Row>
        </Card>

        <Button
          type="primary"
          block
          loading={openMutation.isPending}
          disabled={!config?.enabled || stake > available}
          onClick={requestOpen}
        >
          Open {direction} · ${stake.toFixed(2)} · {duration}s · {Math.round(payoutRatio * 100)}%
        </Button>
        <Typography.Text type="secondary">
          <Tag color="red">High risk</Tag> Not investment advice. Potential profit shown is not guaranteed.
        </Typography.Text>
      </Space>

      <Modal
        title="Confirm binary contract"
        open={confirming}
        onCancel={() => setConfirming(false)}
        onOk={confirmOpen}
        okText="Open contract"
        okButtonProps={{ danger: true }}
      >
        <Typography.Paragraph>
          Open <b>{direction}</b> on BTC/USDC for <b>${stake.toFixed(2)}</b> with a{' '}
          <b>{Math.round(payoutRatio * 100)}%</b> payout ({duration}s).
        </Typography.Paragraph>
        <Typography.Paragraph>
          If you win: <b style={{ color: '#3f8600' }}>+${profit.toFixed(2)}</b> · If you lose:{' '}
          <b style={{ color: '#cf1322' }}>-${stake.toFixed(2)}</b>
        </Typography.Paragraph>
        <Typography.Paragraph type="danger">
          Short-duration binary options are extremely high risk.
        </Typography.Paragraph>
      </Modal>
    </Card>
  );
}
