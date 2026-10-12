import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, ui } from '../theme';
import { Surface } from './Surface';
export function Screen({ children }: React.PropsWithChildren) {
  return (
    <SafeAreaView style={ui.page} edges={['top', 'left', 'right']}>
      <Surface ambient />
      <ScrollView
        contentContainerStyle={ui.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Card({ children }: React.PropsWithChildren) {
  return (
    <View style={[ui.card, { overflow: 'hidden' }]}>
      <Surface />
      {children}
    </View>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
}: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        secondary && ui.secondary,
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.75, transform: [{ scale: 0.985 }] },
      ]}
    >
      <Text style={[ui.buttonText, secondary && { color: colors.text }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  numeric = false,
  multiline = false,
  secure = false,
  placeholder = '',
}: any) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={ui.muted}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        multiline={multiline}
        secureTextEntry={secure}
        autoCapitalize="none"
        style={[
          ui.input,
          multiline && { minHeight: 96, textAlignVertical: 'top' },
        ]}
      />
    </View>
  );
}
export function Heading({ title, sub, action }: any) {
  return (
    <View style={ui.between}>
      <View style={{ gap: 6, flex: 1 }}>
        <View style={[ui.row, { gap: 7, marginBottom: 8 }]}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: colors.green,
            }}
          />
          <Text
            style={{
              color: colors.text,
              fontSize: 13,
              fontWeight: '600',
              letterSpacing: 0.4,
            }}
          >
            FitMind
          </Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            你的私人教练
          </Text>
        </View>
        <Text style={ui.title}>{title}</Text>
        {sub && <Text style={ui.muted}>{sub}</Text>}
      </View>
      {action}
    </View>
  );
}
export function Loading() {
  return <ActivityIndicator color={colors.green} style={{ padding: 16 }} />;
}
