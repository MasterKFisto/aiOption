import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Card,
  Col,
  List,
  message,
  Progress,
  Row,
  Segmented,
  Statistic,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';

import type { BinaryContract } from '@aioption/shared';

import { api } from '../api/client';
import { subscribeUiEvents } from '../api/events';
import { AccountSummaryBar } from '../components/AccountSummaryBar';
import { AiAutoTradingPanel } from '../components/AiAutoTradingPanel';
import { AiBinaryChart } from '../components/AiBinaryChart';
import { AiDecisionHistoryTable } from '../components/AiDecisionHistoryTable';
import { BinarySessionGainPanel } from '../components/BinarySessionGainPanel';
import { BinaryTicket } from '../components/BinaryTicket';

/** Server-time-based clock: offset from GET /api/server-time, ticked locally. */
function useServerNow(): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    let offset = 0;
    let cancelled = false;
    void api.serverTime().then((time) => {
      if (!cancelled) {
        offset = time.epochMs - Date.now();
      }
    });
    const timer = setInterval(() => {
      if (!cancelled) {
        setNow(Date.now() + offset);
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return now;
}

function resultTag(contract: BinaryContract) {
  if (contract.result === 'WIN') return <Tag color="green">WIN</Tag>;
  if (contract.result === 'LOSE') return <Tag color="red">LOSE</Tag>;
  if (contract.result === 'REFUND') return <Tag color="blue">REFUND</Tag>;
  return <Tag>SETTLED</Tag>;
}

function BinaryContractCard({
  contract,
  nowMs,
  currentPrice,
}: {
  contract: BinaryContract;
  nowMs: number;
  currentPrice: number;
}) {
  const totalMs = new Date(contract.expiresAt).getTime() - new Date(contract.openedAt).getTime();
  const remainingMs = Math.max(new Date(contract.expiresAt).getTime() - nowMs, 0);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const progress = Math.min(((totalMs - remainingMs) / totalMs) * 100, 100);
  const winning = contract.direction === 'UP' ? currentPrice > contract.entryPrice : currentPrice < contract.entryPrice;
  const color = currentPrice === contract.entryPrice ? 'default' : winning ? 'green' : 'red';

  return (
    <Card size="small">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {contract.direction === 'UP' ? '▲ UP' : '▼ DOWN'}{' '}
          {contract.source === 'AI_BINARY' ? <Tag color="purple">AI</Tag> : <Tag>Manual</Tag>}
        </Typography.Title>
        <Tag color={color}>{remainingSec > 0 ? `${remainingSec}s left` : 'settling…'}</Tag>
      </div>
      <Progress percent={Number(progress.toFixed(0))} showInfo={false} strokeColor={color} size="small" />
      <Row gutter={8}>
        <Col span={8}>
          <Typography.Text type="secondary">Entry</Typography.Text>
          <div>{contract.entryPrice.toFixed(2)}</div>
        </Col>
        <Col span={8}>
          <Typography.Text type="secondary">Current</Typography.Text>
          <div>{currentPrice.toFixed(2)}</div>
        </Col>
        <Col span={8}>
          <Typography.Text type="secondary">Settlement</Typography.Text>
          <div>{contract.settlementPrice?.toFixed(2) ?? '—'}</div>
        </Col>
        <Col span={8} style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">Stake</Typography.Text>
          <div>${contract.stakeUsd.toFixed(2)}</div>
        </Col>
        <Col span={8} style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">Payout</Typography.Text>
          <div>{Math.round(contract.payoutRatio * 100)}%</div>
        </Col>
        <Col span={8} style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">Potential profit</Typography.Text>
          <div style={{ color: '#3f8600' }}>+${contract.potentialProfitUsd.toFixed(2)}</div>
        </Col>
      </Row>
      <div style={{ marginTop: 8 }}>{resultTag(contract)}</div>
    </Card>
  );
}

/** Binary Options page: live chart, AI auto trading, ticket, contracts, results. */
export function BinaryOptionsPage() {
  const nowMs = useServerNow();
  const [sounds, setSounds] = useState(() => window.localStorage.getItem('aioption-binary-sounds') === 'true');
  const [requireConfirm, setRequireConfirm] = useState(
    () => window.localStorage.getItem('aioption-binary-confirm') !== 'false',
  );
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'MANUAL_BINARY' | 'AI_BINARY'>('ALL');

  const { data: tickerData } = useQuery({ queryKey: ['ticker'], queryFn: api.ticker, refetchInterval: 1000 });
  const { data: openContracts } = useQuery({
    queryKey: ['binary-open'],
    queryFn: api.binaryOpen,
    refetchInterval: 1000,
  });
  const { data: history } = useQuery({
    queryKey: ['binary-history', 10],
    queryFn: () => api.binaryHistory(10),
    refetchInterval: 2000,
  });
  const { data: summary } = useQuery({
    queryKey: ['binary-summary'],
    queryFn: api.binarySummary,
    refetchInterval: 2000,
  });

  // Small notification when an AI contract settles (never a full modal).
  useEffect(() => {
    const unsubscribe = subscribeUiEvents((event) => {
      if (event.type !== 'ai-binary') {
        return;
      }
      const payload = event.payload as { action?: string; contract?: BinaryContract } | undefined;
      if (payload?.action === 'TRADE_SETTLED' && payload.contract) {
        const contract = payload.contract;
        const label =
          contract.result === 'WIN' ? 'won' : contract.result === 'LOSE' ? 'lost' : 'refunded';
        const amount =
          contract.result === 'WIN'
            ? `+$${contract.totalReturnIfWinUsd.toFixed(2)}`
            : contract.result === 'LOSE'
              ? `-$${contract.stakeUsd.toFixed(2)}`
              : `$${contract.stakeUsd.toFixed(2)} refunded`;
        message.info(`AI binary ${contract.direction} ${label} (${amount})`);
      }
    });
    return unsubscribe;
  }, []);

  const currentPrice = tickerData?.ticker?.lastPrice ?? 0;

  const toggleSounds = (checked: boolean) => {
    setSounds(checked);
    window.localStorage.setItem('aioption-binary-sounds', String(checked));
  };
  const toggleConfirm = (checked: boolean) => {
    setRequireConfirm(checked);
    window.localStorage.setItem('aioption-binary-confirm', String(checked));
  };

  const filteredHistory = (history ?? []).filter(
    (contract) => sourceFilter === 'ALL' || contract.source === sourceFilter,
  );

  return (
    <div>
      <Alert
        type="warning"
        showIcon
        banner
        message="Short-duration binary options are extremely high risk and may result in rapid losses."
        style={{ marginBottom: 16 }}
      />
      <AccountSummaryBar />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <AiBinaryChart />
        </Col>
        <Col xs={24} xl={8}>
          <AiAutoTradingPanel />
        </Col>
        <Col xs={24} xl={8}>
          <BinarySessionGainPanel />
        </Col>
        <Col xs={24} lg={10}>
          <BinaryTicket currentPrice={currentPrice} />
        </Col>
        <Col xs={24} lg={14}>
          <Card
            title={`Open binary contracts (${openContracts?.length ?? 0})`}
            size="small"
            extra={
              <span style={{ display: 'inline-flex', gap: 12 }}>
                <span>
                  Sounds{' '}
                  <Switch size="small" checked={sounds} onChange={toggleSounds} />
                </span>
                <span>
                  Confirm{' '}
                  <Switch size="small" checked={requireConfirm} onChange={toggleConfirm} />
                </span>
              </span>
            }
          >
            {!openContracts || openContracts.length === 0 ? (
              <Typography.Text type="secondary">No open binary contracts.</Typography.Text>
            ) : (
              <Row gutter={[8, 8]}>
                {openContracts.map((contract) => (
                  <Col key={contract.id} xs={24} md={12} xl={8}>
                    <BinaryContractCard contract={contract} nowMs={nowMs} currentPrice={currentPrice} />
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </Col>
        <Col xs={24}>
          <AiDecisionHistoryTable />
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Binary performance" size="small">
            <Row gutter={8}>
              <Col span={6}>
                <Statistic title="Wins" value={summary?.wins ?? 0} valueStyle={{ color: '#3f8600' }} />
              </Col>
              <Col span={6}>
                <Statistic title="Losses" value={summary?.losses ?? 0} valueStyle={{ color: '#cf1322' }} />
              </Col>
              <Col span={6}>
                <Statistic title="Refunds" value={summary?.refunds ?? 0} valueStyle={{ color: '#1677ff' }} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Net PnL"
                  value={summary?.netPnlUsd ?? 0}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: (summary?.netPnlUsd ?? 0) >= 0 ? '#3f8600' : '#cf1322' }}
                />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card
            title="Recent results"
            size="small"
            extra={
              <Segmented
                size="small"
                options={[
                  { label: 'All', value: 'ALL' },
                  { label: 'Manual', value: 'MANUAL_BINARY' },
                  { label: 'AI', value: 'AI_BINARY' },
                ]}
                value={sourceFilter}
                onChange={(value) => setSourceFilter(value as 'ALL' | 'MANUAL_BINARY' | 'AI_BINARY')}
              />
            }
          >
            {!filteredHistory || filteredHistory.length === 0 ? (
              <Typography.Text type="secondary">No settled contracts yet.</Typography.Text>
            ) : (
              <List
                size="small"
                dataSource={filteredHistory}
                renderItem={(contract: BinaryContract) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <>
                          {resultTag(contract)} {contract.direction} · ${contract.stakeUsd.toFixed(2)} ·{' '}
                          {Math.round(contract.payoutRatio * 100)}%{' '}
                          {contract.source === 'AI_BINARY' ? <Tag color="purple">AI</Tag> : <Tag>Manual</Tag>}
                        </>
                      }
                      description={`${contract.entryPrice.toFixed(2)} → ${(contract.settlementPrice ?? 0).toFixed(2)} · ${new Date(contract.settledAt ?? contract.expiresAt).toLocaleTimeString()}`}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
