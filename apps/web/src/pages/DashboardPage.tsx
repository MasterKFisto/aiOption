import { useQuery } from '@tanstack/react-query';
import { Button, Col, Row, Space } from 'antd';
import { useState } from 'react';

import { AccountSummaryBar } from '../components/AccountSummaryBar';
import { ClassicTicket } from '../components/ClassicTicket';
import { ClassicTradingPanel } from '../components/ClassicTradingPanel';
import {
  OpenPositionsPanel,
  RecentDecisionsPanel,
  RiskEventsPanel,
} from '../components/DashboardPanels';
import { DepositModal } from '../components/DepositModal';
import { MarketPricePanel } from '../components/MarketPricePanel';
import { PriceChart } from '../components/PriceChart';
import { SettledPositionsPanel } from '../components/SettledPositionsPanel';
import { TradeAddressPanel } from '../components/TradeAddressPanel';
import { WithdrawModal } from '../components/WithdrawModal';
import { api } from '../api/client';

type Interval = '1m' | '5m' | '1h';

/**
 * Classic Options page (Phase 6.5.1 layout):
 *   AccountSummaryBar → [Trade ticket | Trading control panel]
 *   → Open positions → Settled history → market/chart → address & activity.
 */
export function DashboardPage() {
  const [interval, setInterval] = useState<Interval>('1m');
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const { data: tickerData } = useQuery({ queryKey: ['ticker'], queryFn: api.ticker, refetchInterval: 1000 });
  const currentPrice = tickerData?.ticker?.lastPrice ?? 0;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setDepositOpen(true)}>
          Deposit
        </Button>
        <Button onClick={() => setWithdrawOpen(true)}>Withdraw</Button>
      </Space>

      <AccountSummaryBar />

      <Row gutter={[16, 16]}>
        {/* Row 1: trade ticket + trading control panel */}
        <Col xs={24} lg={10} xl={8}>
          <ClassicTicket currentPrice={currentPrice} />
        </Col>
        <Col xs={24} lg={14} xl={16}>
          <ClassicTradingPanel />
        </Col>
        {/* Row 2: open positions (expiry + live countdown) */}
        <Col span={24}>
          <OpenPositionsPanel />
        </Col>
        {/* Row 3: settled history */}
        <Col span={24}>
          <SettledPositionsPanel />
        </Col>
        <Col xs={24} xl={14}>
          <MarketPricePanel />
        </Col>
        <Col xs={24} xl={10}>
          <TradeAddressPanel />
        </Col>
        <Col span={24}>
          <PriceChart interval={interval} onIntervalChange={setInterval} />
        </Col>
        <Col xs={24} lg={12}>
          <RecentDecisionsPanel />
        </Col>
        <Col xs={24} lg={12}>
          <RiskEventsPanel />
        </Col>
      </Row>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </div>
  );
}
