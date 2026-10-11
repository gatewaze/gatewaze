import React from 'react';
import { Text, View } from 'react-native';
import { Caption, Card, Heading, Screen } from '../../src/components/primitives';
import { Slider } from '../../src/components/Slider';
import { TEXT_SCALE_OPTIONS, useTextScale } from '../../src/core/textScale';
import { scaled, spacing, type, useTheme } from '../../src/theme/tokens';

export default function TextSize() {
  const theme = useTheme();
  const { scaleId, scale, setScaleId } = useTextScale();
  const step = TEXT_SCALE_OPTIONS.findIndex((o) => o.id === scaleId);
  const option = TEXT_SCALE_OPTIONS[step];

  return (
    <Screen>
      <Card>
        <Heading>Preview</Heading>
        <Text style={[scaled(type.heading, scale), { color: theme.text }]}>
          Today is Day 4 — Push
        </Text>
        <Text style={[scaled(type.body, scale), { color: theme.textSecondary }]}>
          Barbell Incline Bench Press, Machine Shoulder Press, and five more exercises are set up
          and ready to log.
        </Text>
      </Card>

      <Card>
        <Heading>Text size</Heading>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
          <Caption>Small</Caption>
          <Caption>Extra large</Caption>
        </View>
        <Slider
          minimumValue={0}
          maximumValue={TEXT_SCALE_OPTIONS.length - 1}
          step={1}
          value={step}
          onValueChange={(v) => setScaleId(TEXT_SCALE_OPTIONS[Math.round(v)].id)}
        />
        <Caption style={{ textAlign: 'center' }}>{option.label}</Caption>
      </Card>
    </Screen>
  );
}
