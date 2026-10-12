import React, { useId } from 'react';
import { Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { Budget } from '@fitmind/contracts';
import { colors, ui } from '../theme';
import { Surface } from './Surface';

export function BudgetCard({
  label,
  unit,
  budget,
  large = false,
  icon,
}: {
  label: string;
  unit: string;
  budget?: Budget;
  large?: boolean;
  icon?: React.ReactNode;
}) {
  const id = 'budget' + useId().replace(/:/g, '');
  const expandedText = useWindowDimensions().fontScale > 1.3;
  const b: Budget = budget ?? {
    target: null,
    known_total: 0,
    remaining: null,
    over: null,
    estimated: false,
    incomplete: false,
  };
  const ratio = b.target
    ? Math.max(0, Math.min(1, b.known_total / b.target))
    : 0;
  const amount = b.remaining === null ? '—' : String(Math.round(b.remaining));
  const status = b.incomplete
    ? '部分营养未知'
    : b.target === null
      ? '未设目标'
      : b.over! > 0
        ? '已超出 ' + Math.round(b.over!) + unit
        : '距今日目标';
  const recorded = `已记录 ${Math.round(b.known_total)} ${unit}`;
  return (
    <View style={[ui.card, styles.card, large ? styles.large : styles.small]}>
      <Surface jade={large} />
      <View style={ui.between}>
        <Text style={[ui.muted, large && styles.label]}>{label}</Text>
        {large && <View style={styles.icon}>{icon}</View>}
      </View>
      {large ? (
        <>
          <View style={styles.ring}>
            <Svg width="100%" height="100%" viewBox="0 0 112 112" aria-hidden>
              <Defs>
                <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
                  <Stop offset="0" stopColor="#49FF9B" />
                  <Stop offset="1" stopColor="#00C46B" />
                </LinearGradient>
              </Defs>
              <Circle
                cx={56}
                cy={56}
                r={49}
                stroke="#00ED8528"
                strokeWidth={5}
                fill="none"
              />
              {ratio > 0 && (
                <Circle
                  cx={56}
                  cy={56}
                  r={49}
                  stroke={`url(#${id})`}
                  strokeWidth={5}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${ratio * 2 * Math.PI * 49} ${2 * Math.PI * 49}`}
                  rotation={-90}
                  origin="56, 56"
                />
              )}
            </Svg>
            {!expandedText && (
              <View style={styles.ringValue}>
                <Text
                  style={[
                    styles.amount,
                    { fontSize: amount.length > 4 ? 24 : 30 },
                  ]}
                >
                  {amount}
                </Text>
                <Text style={styles.unit}>
                  {b.estimated && b.remaining !== null ? '约 · ' : ''}
                  {unit} 剩余
                </Text>
              </View>
            )}
          </View>
          {expandedText && (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={[styles.amount, { fontSize: 30 }]}>{amount}</Text>
              <Text style={styles.unit}>
                {b.estimated && b.remaining !== null ? '约 · ' : ''}
                {unit} 剩余
              </Text>
            </View>
          )}
        </>
      ) : (
        <View style={styles.valueRow}>
          <Text
            style={[styles.amount, { fontSize: amount.length > 3 ? 22 : 27 }]}
          >
            {b.estimated && b.remaining !== null && (
              <Text style={{ fontSize: 10 }}>约 </Text>
            )}
            {amount}
          </Text>
          <Text style={styles.unit}>{unit}</Text>
        </View>
      )}
      {!large && (
        <View style={styles.track}>
          <View
            style={{
              height: 3,
              width: `${ratio * 100}%`,
              backgroundColor: colors.green,
            }}
          />
        </View>
      )}
      <Text
        style={[
          ui.muted,
          styles.status,
          { color: b.over! > 0 ? colors.danger : colors.muted },
        ]}
      >
        {status}
      </Text>
      <Text style={[styles.recorded, large && { textAlign: 'center' }]}>
        {large ? recorded : `已记 ${Math.round(b.known_total)} ${unit}`}
        {large && b.target !== null ? ` / ${b.target}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, overflow: 'hidden' },
  large: {
    padding: 16,
    gap: 6,
    backgroundColor: '#04120B',
    borderColor: '#00ED852E',
  },
  small: { padding: 12, gap: 5, borderRadius: 22 },
  label: { fontSize: 14, color: colors.text, fontWeight: '500' },
  icon: {
    width: 28,
    height: 28,
    backgroundColor: '#00ED8514',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: '100%',
    maxWidth: 104,
    aspectRatio: 1,
    alignSelf: 'center',
    marginVertical: 3,
  },
  ringValue: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  amount: {
    color: colors.green,
    fontWeight: '500',
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.2,
  },
  unit: { color: colors.muted, fontSize: 10, lineHeight: 16 },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginVertical: 2,
  },
  track: {
    height: 3,
    backgroundColor: '#00ED8512',
    borderRadius: 2,
    overflow: 'hidden',
  },
  status: { fontSize: 10, lineHeight: 16, textAlign: 'center' },
  recorded: { color: colors.muted, fontSize: 10, lineHeight: 15 },
});
