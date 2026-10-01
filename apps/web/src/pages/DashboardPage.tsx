import { useQuery } from '@tanstack/react-query';
import { Button, Col, Row, Space } from 'antd';
import { useState } from 'react';

import { AccountSummaryBar } from '../components/AccountSummaryBar';
import { ClassicTicket } from '../components/ClassicTicket';
import {
  OpenPositionsPanel,
  RecentDecisionsPanel,
  RiskEventsPanel,
} from '../components/DashboardPanels';
import { DepositModal } from '../components/DepositModal';
import { MarketPricePanel } from '../components/MarketPricePanel';
import { PriceChart } from '../components/PriceChart';
import { WithdrawModal } from '../components/WithdrawModal';
import { api } from '../api/client';

type Interval = '1m' | '5m' | '1h';

/** Main dashboard: account summary, live market + chart, and activity panels. */
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
        <Col xs={24} xl={14}>
          <MarketPricePanel />
        </Col>
        <Col xs={24} xl={10}>
          <ClassicTicket currentPrice={currentPrice} />
        </Col>
        <Col span={24}>
          <PriceChart interval={interval} onIntervalChange={setInterval} />
        </Col>
        <Col xs={24} lg={12}>
          <OpenPositionsPanel />
        </Col>
        <Col xs={24} lg={6}>
          <RecentDecisionsPanel />
        </Col>
        <Col xs={24} lg={6}>
          <RiskEventsPanel />
        </Col>
      </Row>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <WithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </div>
  );
}
