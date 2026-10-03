import { useQuery } from '@tanstack/react-query';
import { Card, Tag, Typography } from 'antd';
import {
  AreaSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';

import type { BinaryContract, PriceTick } from '@aioption/shared';

import { api } from '../api/client';

const SIGNAL_COLORS = { UP: '#16a34a', DOWN: '#dc2626', NEUTRAL: '#9ca3af' };

/**
 * Real-time 1-second tick chart for binary options (rolling ~120s window)
 * with AI signal markers and AI trade entry/settlement markers.
 * The chart stays mounted while AI trading is active.
 */
export function AiBinaryChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const { data: tickData } = useQuery({
    queryKey: ['market-ticks'],
    queryFn: () => api.ticks(120),
    refetchInterval: 1000,
  });
  const { data: tickerData } = useQuery({
    queryKey: ['ticker'],
    queryFn: api.ticker,
    refetchInterval: 1000,
  });
  const { data: decisions } = useQuery({
    queryKey: ['ai-decisions', 40],
    queryFn: () => api.aiBinaryDecisions(40),
    refetchInterval: 5000,
  });
  const { data: openContracts } = useQuery({
    queryKey: ['binary-open'],
    queryFn: api.binaryOpen,
    refetchInterval: 2000,
  });
  const { data: history } = useQuery({
    queryKey: ['binary-history', 20],
    queryFn: () => api.binaryHistory(20),
    refetchInterval: 5000,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const chart = createChart(container, {
      autoSize: true,
      height: 340,
      layout: { background: { color: '#ffffff' }, textColor: '#333' },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      timeScale: { timeVisible: true, secondsVisible: true, rightOffset: 4 },
      rightPriceScale: { borderVisible: false },
    });
    chartRef.current = chart;
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#1677ff',
      topColor: 'rgba(22, 119, 255, 0.25)',
      bottomColor: 'rgba(22, 119, 255, 0.02)',
      lineWidth: 2,
      priceLineVisible: false,
    });
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !tickData || tickData.ticks.length === 0) {
      return;
    }
    const points = tickData.ticks.map((tick: PriceTick) => ({
      time: (new Date(tick.timestamp).getTime() / 1000) as UTCTimestamp,
      value: tick.price,
    }));
    series.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [tickData]);

  const markers = useMemo(() => {
    const list: SeriesMarker<Time>[] = [];
    for (const decision of (decisions ?? []).slice(0, 30)) {
      if (decision.signal === 'NEUTRAL') {
        continue;
      }
      const time = new Date(decision.createdAt).getTime() / 1000;
      list.push({
        time: time as UTCTimestamp,
        position: decision.signal === 'UP' ? 'belowBar' : 'aboveBar',
        color: SIGNAL_COLORS[decision.signal],
        shape: decision.signal === 'UP' ? 'arrowUp' : 'arrowDown',
        text: decision.signal,
      });
    }
    const aiContracts = [
      ...(openContracts ?? []),
      ...(history ?? []),
    ].filter((contract: BinaryContract) => contract.source === 'AI_BINARY');
    for (const contract of aiContracts.slice(0, 20)) {
      const opened = new Date(contract.openedAt).getTime() / 1000;
      list.push({
        time: opened as UTCTimestamp,
        position: contract.direction === 'UP' ? 'belowBar' : 'aboveBar',
        color: '#1677ff',
        shape: 'circle',
        text: `AI ${contract.direction}`,
      });
      if (contract.settledAt && contract.result) {
        const settled = new Date(contract.settledAt).getTime() / 1000;
        const color =
          contract.result === 'WIN' ? '#16a34a' : contract.result === 'LOSE' ? '#dc2626' : '#9ca3af';
        list.push({
          time: settled as UTCTimestamp,
          position: contract.result === 'WIN' ? 'belowBar' : 'aboveBar',
          color,
          shape: 'square',
          text: contract.result,
        });
      }
    }
    return list;
  }, [decisions, openContracts, history]);

  useEffect(() => {
    markersRef.current?.setMarkers(markers);
  }, [markers]);

  const ticker = tickerData?.ticker;
  const statusColors: Record<string, string> = {
    connected: 'green',
    polling: 'orange',
    disconnected: 'default',
    error: 'red',
  };
  const current = ticker?.lastPrice ?? tickData?.ticks.at(-1)?.price ?? 0;
  const connectionStatus = tickerData?.status ?? 'disconnected';

  return (
    <Card
      title={
        <span>
          Live {ticker?.symbol ?? 'BTC/USDT'} chart{' '}
          <Tag color="blue">{current > 0 ? current.toFixed(2) : '—'}</Tag>
          <Tag color={statusColors[connectionStatus] ?? 'default'}>{connectionStatus}</Tag>
        </span>
      }
      size="small"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          last 120s · 1s ticks
        </Typography.Text>
      }
    >
      <div ref={containerRef} style={{ height: 340 }} />
    </Card>
  );
}
