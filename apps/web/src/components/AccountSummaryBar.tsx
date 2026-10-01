import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Tag } from 'antd';

import { api } from '../api/client';

const usd = (value: number): number => Math.round(value * 100) / 100;

/**
 * The single unified account block used at the top of the Classic Options,
 * Binary Options and Wallet Records pages. Identical layout, labels and
 * colors everywhere; updates via SSE + 2s polling.
 */
export function AccountSummaryBar() {
  const { data } = useQuery({
    queryKey: ['summary'],
    queryFn: api.summary,
    refetchInterval: 2000,
  });

  if (!data) {
    return null;
  }

  const account = data.account;
  const trading = account.tradingEnabled;
  const gainLimitEnabled = data.binarySessionGainLimitUsd > 0;

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Row gutter={[12, 8]} align="middle">
        <Col>
          <Tag color={account.mode === 'PAPER' ? 'default' : account.mode === 'LIVE' ? 'red' : 'blue'}>
            {account.mode}
          </Tag>
          <Tag color={trading ? 'green' : 'default'}>{trading ? 'Trading enabled' : 'Trading disabled'}</Tag>
        </Col>
        <Col flex="auto" />
      </Row>
      <Row gutter={[16, 8]}>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Total equity" value={usd(account.equity)} precision={2} prefix="$" />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Available balance" value={usd(account.cashBalance)} precision={2} prefix="$" />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Locked balance" value={usd(account.lockedBalance)} precision={2} prefix="$" />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title="Unrealized PnL"
            value={usd(data.unrealizedPnl)}
            precision={2}
            prefix="$"
            valueStyle={{ color: data.unrealizedPnl >= 0 ? '#3f8600' : '#cf1322' }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title="Realized PnL"
            value={usd(data.realizedPnl + data.binaryNetPnl)}
            precision={2}
            prefix="$"
            valueStyle={{ color: data.realizedPnl + data.binaryNetPnl >= 0 ? '#3f8600' : '#cf1322' }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title={`Daily loss limit (${data.dailyLossLimitPercent}%)`}
            value={usd(data.dailyLossRemainingUsd)}
            precision={2}
            prefix="$"
            suffix=" left"
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Loss limit floor" value={usd(data.lossLimitFloorUsd)} precision={2} prefix="$" />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title="Binary session gain"
            value={usd(data.binarySessionGainUsd)}
            precision={2}
            prefix="$"
            valueStyle={{ color: data.binarySessionGainUsd >= 0 ? '#3f8600' : '#cf1322' }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title="Binary gain limit"
            value={gainLimitEnabled ? usd(data.binarySessionGainLimitUsd) : 0}
            precision={2}
            prefix="$"
            suffix={gainLimitEnabled ? ` (${usd(data.binarySessionGainRemainingUsd)} left)` : ' (off)'}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title="AI binary session profit"
            value={usd(data.aiBinarySessionProfitUsd)}
            precision={2}
            prefix="$"
            valueStyle={{ color: data.aiBinarySessionProfitUsd >= 0 ? '#3f8600' : '#cf1322' }}
          />
        </Col>
      </Row>
    </Card>
  );
}
