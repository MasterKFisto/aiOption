import { InfoCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Tag, Tooltip, Typography } from 'antd';

import { api } from '../api/client';

const usd = (value: number): number => Math.round(value * 100) / 100;
const pnlColor = (value: number): string => (value > 0 ? '#3f8600' : value < 0 ? '#cf1322' : 'inherit');

export const UNREALIZED_TOOLTIP =
  'Unrealized PnL reflects open positions. Short binary options may settle quickly and move to Realized PnL.';

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
  const estimatedEnabled = data.binaryUnrealizedMode === 'ESTIMATED';

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
          <Statistic
            title={
              <span>
                Total equity{' '}
                <Tooltip title="Settled funds: available + locked. Excludes unrealized (open-position) PnL until trades settle.">
                  <InfoCircleOutlined aria-label="About Total equity" />
                </Tooltip>
              </span>
            }
            value={usd(account.equity)}
            precision={2}
            prefix="$"
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Available balance" value={usd(account.cashBalance)} precision={2} prefix="$" />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic title="Locked balance" value={usd(account.lockedBalance)} precision={2} prefix="$" />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title="Realized PnL (settled)"
            value={usd(data.realizedPnl + data.binaryNetPnl)}
            precision={2}
            prefix="$"
            valueStyle={{ color: data.realizedPnl + data.binaryNetPnl >= 0 ? '#3f8600' : '#cf1322' }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title={
              <span data-testid="unrealized-title">
                Unrealized PnL{' '}
                <Tooltip title={UNREALIZED_TOOLTIP}>
                  <InfoCircleOutlined aria-label="About Unrealized PnL" />
                </Tooltip>
              </span>
            }
            value={usd(data.unrealizedPnl)}
            precision={2}
            prefix="$"
            valueStyle={{ color: pnlColor(data.unrealizedPnl) }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title="Open Classic Options PnL"
            value={usd(data.openClassicUnrealizedPnl ?? data.unrealizedPnl)}
            precision={2}
            prefix="$"
            suffix={<Typography.Text type="secondary" style={{ fontSize: 12 }}> est.</Typography.Text>}
            valueStyle={{ color: pnlColor(data.openClassicUnrealizedPnl ?? data.unrealizedPnl) }}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Statistic
            title={
              <span>
                Open Binary Exposure{' '}
                <Tooltip title="Stake locked in open binary contracts. Binary options settle at expiry; their result is not counted until then.">
                  <InfoCircleOutlined aria-label="About Open Binary Exposure" />
                </Tooltip>
              </span>
            }
            value={usd(data.openBinaryExposure ?? 0)}
            precision={2}
            suffix={` USDC (${data.openBinaryCount ?? 0} open)`}
          />
        </Col>
        {estimatedEnabled && (
          <Col xs={12} sm={8} lg={4}>
            <Statistic
              title={
                <span data-testid="estimated-binary-title">
                  Estimated Binary PnL{' '}
                  <Tooltip title="Estimated only. Binary options settle at expiry.">
                    <InfoCircleOutlined aria-label="About Estimated Binary PnL" />
                  </Tooltip>
                </span>
              }
              value={usd(data.estimatedBinaryUnrealizedPnl ?? 0)}
              precision={2}
              prefix="≈ $"
              valueStyle={{ color: pnlColor(data.estimatedBinaryUnrealizedPnl ?? 0), fontStyle: 'italic' }}
            />
          </Col>
        )}
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
