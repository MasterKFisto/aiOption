import {
  BarChartOutlined,
  BulbOutlined,
  SettingOutlined,
  TableOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Layout, Menu, Tag, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type { Position, RiskEvent } from '@aioption/shared';

import { api } from './api/client';
import { subscribeUiEvents, useApiEvents } from './api/events';
import { PostTradeActionModal } from './components/PostTradeActionModal';
import type { PostTradePrompt } from './components/PostTradeActionModal';
import { TronStatusModal } from './components/TronStatusModal';
import { WithdrawModal } from './components/WithdrawModal';
import { BinaryOptionsPage } from './pages/BinaryOptionsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DecisionsPage } from './pages/DecisionsPage';
import { PositionsPage } from './pages/PositionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { WalletRecordsPage } from './pages/WalletRecordsPage';

const { Sider, Content } = Layout;

type View = 'classic' | 'binary' | 'positions' | 'decisions' | 'wallet' | 'settings';

const VIEWS: Array<{ key: View; label: string; icon: ReactNode }> = [
  { key: 'classic', label: 'Classic Options', icon: <BarChartOutlined /> },
  { key: 'binary', label: 'Binary Options', icon: <ThunderboltOutlined /> },
  { key: 'positions', label: 'Positions', icon: <TableOutlined /> },
  { key: 'decisions', label: 'AI Decisions', icon: <BulbOutlined /> },
  { key: 'wallet', label: 'Wallet Records', icon: <WalletOutlined /> },
  { key: 'settings', label: 'Settings', icon: <SettingOutlined /> },
];

const SEEN_KEY = 'aioption-post-trade-seen';

function loadSeen(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function rememberSeen(fingerprint: string): void {
  const seen = loadSeen().slice(-50);
  seen.push(fingerprint);
  window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

export default function App() {
  const [view, setView] = useState<View>('classic');
  const [prompt, setPrompt] = useState<PostTradePrompt | null>(null);
  const [withdrawPrefill, setWithdrawPrefill] = useState<number | undefined>(undefined);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [tronOpen, setTronOpen] = useState(false);

  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: api.summary });
  const { data: tronStatus } = useQuery({
    queryKey: ['tron-status'],
    queryFn: api.tronStatus,
    refetchInterval: 15000,
  });

  useApiEvents();

  // Post-trade / post-stop prompt. Deduplicated via localStorage so the same
  // event never re-prompts after a page refresh.
  useEffect(() => {
    return subscribeUiEvents((event) => {
      if (!(summary?.account.postTradePromptEnabled ?? true)) {
        return;
      }
      let next: PostTradePrompt | null = null;
      if (event.type === 'risk') {
        const payload = event.payload as RiskEvent;
        next = {
          fingerprint: `risk-${payload.id}`,
          title: 'Trading stopped by risk engine',
          message: `Trading stopped because the loss limit was reached. ${payload.message}`,
        };
      } else if (
        event.type === 'trade' &&
        (event.payload as { action: string }).action === 'CLOSED'
      ) {
        const position = (event.payload as { position: Position }).position;
        next = {
          fingerprint: `trade-closed-${position.id}`,
          title: 'Position closed',
          message: `Position ${position.symbol} was closed.`,
        };
      } else if (event.type === 'trading-stopped') {
        next = {
          fingerprint: `user-stop-${Date.now()}`,
          title: 'Trading stopped by user',
          message: 'Trading was stopped manually.',
        };
      } else if (
        event.type === 'ai-binary' &&
        (event.payload as { action?: string }).action === 'PROFIT_TARGET_REACHED'
      ) {
        next = {
          fingerprint: `ai-profit-${Date.now()}`,
          title: 'AI profit target reached',
          message:
            'Profit target reached. You may withdraw profit or keep it in the wallet for the next trading session.',
        };
      } else if (event.type === 'request-withdraw') {
        setWithdrawPrefill(summary?.account.cashBalance);
        setWithdrawOpen(true);
      } else if (event.type === 'request-tron-status') {
        setTronOpen(true);
      }
      if (next && !loadSeen().includes(next.fingerprint)) {
        setPrompt(next);
      }
    });
  }, [summary]);

  const handleKeep = () => {
    if (prompt) {
      rememberSeen(prompt.fingerprint);
    }
    setPrompt(null);
  };

  const handleWithdraw = () => {
    if (prompt) {
      rememberSeen(prompt.fingerprint);
    }
    setPrompt(null);
    setWithdrawPrefill(summary?.account.cashBalance);
    setWithdrawOpen(true);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={64} style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            padding: '20px 16px',
            whiteSpace: 'nowrap',
          }}
        >
          AI Option
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[view]}
          items={VIEWS.map((v) => ({ key: v.key, icon: v.icon, label: v.label }))}
          onClick={({ key }) => setView(key as View)}
          style={{ flex: 1 }}
        />
        <Tooltip
          title={`Tron Network: ${tronStatus?.networkName ?? '…'} - ${tronStatus?.connectionStatus ?? '…'}`}
          placement="right"
        >
          <div
            onClick={() => setTronOpen(true)}
            style={{
              color: '#fff',
              padding: '14px 16px',
              cursor: 'pointer',
              borderTop: '1px solid rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background:
                  tronStatus?.connectionStatus === 'CONNECTED'
                    ? tronStatus.mode === 'SIMULATED'
                      ? '#8c8c8c'
                      : '#52c41a'
                    : tronStatus?.connectionStatus === 'DEGRADED'
                      ? '#faad14'
                      : '#ff4d4f',
              }}
            />
            <span style={{ fontSize: 12 }}>{tronStatus?.networkName ?? 'Tron'}</span>
            <Tag
              color={
                tronStatus?.readiness === 'READY_TO_TRADE'
                  ? 'green'
                  : tronStatus?.readiness === 'FEE_RESOURCE_LOW'
                    ? 'orange'
                    : 'red'
              }
              style={{ marginLeft: 'auto', fontSize: 10 }}
            >
              {tronStatus?.readiness === 'READY_TO_TRADE' ? 'Ready' : tronStatus?.readiness?.replaceAll('_', ' ') ?? '…'}
            </Tag>
          </div>
        </Tooltip>
      </Sider>
      <Layout>
        <Content style={{ padding: 24 }}>
          {view === 'classic' && <DashboardPage />}
          {view === 'binary' && <BinaryOptionsPage />}
          {view === 'positions' && <PositionsPage />}
          {view === 'decisions' && <DecisionsPage />}
          {view === 'wallet' && <WalletRecordsPage />}
          {view === 'settings' && <SettingsPage />}
        </Content>
      </Layout>

      <PostTradeActionModal
        prompt={prompt}
        availableBalance={summary?.account.cashBalance ?? 0}
        onKeep={handleKeep}
        onWithdraw={handleWithdraw}
        onClose={handleKeep}
      />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        prefillAmount={withdrawPrefill}
      />
      <TronStatusModal open={tronOpen} onClose={() => setTronOpen(false)} />
    </Layout>
  );
}
