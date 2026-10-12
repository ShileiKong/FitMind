import React, { useId } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

/** Emerald light on deep black, shared by web and the native screens. */
export function Surface({
  ambient = false,
  jade = false,
}: {
  ambient?: boolean;
  jade?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={StyleSheet.absoluteFill}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none" aria-hidden>
        <Defs>
          {ambient ? (
            <RadialGradient id={id} cx="90%" cy="0%" rx="85%" ry="55%">
              <Stop offset="0" stopColor="#00D976" stopOpacity="0.16" />
              <Stop offset="0.5" stopColor="#006638" stopOpacity="0.04" />
              <Stop offset="1" stopColor="#000000" stopOpacity="0" />
            </RadialGradient>
          ) : (
            <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop
                offset="0"
                stopColor={jade ? '#00D66C' : '#FFFFFF'}
                stopOpacity={jade ? 0.12 : 0.014}
              />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
          )}
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
