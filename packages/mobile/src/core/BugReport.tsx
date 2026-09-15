/**
 * The bug button's report sheet.
 *
 * The flow the operator asked for: tapping the header's bug icon grabs a
 * screenshot of what the member was looking at BEFORE anything opens, then
 * this sheet collects a few words and sends both to the server. The report is POSTed to whatever
 * endpoint the brand's module contributed (see `feedback` in the manifest);
 * what happens to it server-side is that module's business.
 *
 * The screenshot is shown IN the sheet, small. Not decoration: the member is
 * about to send a picture of their screen, possibly with their own health
 * data on it, and they should see exactly what leaves the phone.
 */

import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Constants from 'expo-constants';
import { getModuleContext } from './context';
import { GlassPanel } from '../components/GlassPanel';
import { Body, Button, Caption, CardTitle, Input, Row } from '../components/primitives';
import { useTheme, radius, spacing } from '../theme/tokens';
import { humanMessage } from './errors';

export function BugReportSheet({
  shotBase64,
  route,
  path,
  onClose,
}: {
  /** The module-contributed endpoint the report is POSTed to. */
  path: string;
  /** Captured before the sheet opened; null when the capture failed. */
  shotBase64: string | null;
  route: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await getModuleContext().apiFetch(path, {
        method: 'POST',
        body: {
          message: text.trim(),
          screenshotBase64: shotBase64 ?? undefined,
          appBuild: String(Constants.expoConfig?.ios?.buildNumber ?? ''),
          route,
        },
      });
      setSent(true);
      setTimeout(onClose, 1400);
    } catch (err) {
      setError(humanMessage(err).text);
      setSending(false);
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(150)} style={styles.overlay}>
      {/* Tapping the dimmed screen dismisses, like every sheet on the OS. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={sent ? undefined : onClose} />
      <Animated.View entering={FadeInDown.duration(200)}>
        <GlassPanel radius={radius.lg}>
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            {sent ? (
              <>
                <CardTitle>Sent — thank you</CardTitle>
                <Caption>It goes straight to the people building the app.</Caption>
              </>
            ) : (
              <>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md }}>
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <CardTitle>Report a problem</CardTitle>
                    <Caption>
                      {shotBase64
                        ? 'A screenshot of the screen you were on is attached.'
                        : 'Say what went wrong and where.'}
                    </Caption>
                  </View>
                  {shotBase64 ? (
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${shotBase64}` }}
                      style={[styles.thumb, { borderColor: theme.border }]}
                    />
                  ) : null}
                </Row>
                <Input
                  placeholder="What went wrong?"
                  value={text}
                  onChangeText={setText}
                  multiline
                  numberOfLines={4}
                  style={{ minHeight: 96, textAlignVertical: 'top' }}
                  autoFocus
                />
                {error ? <Body style={{ color: theme.danger }}>{error}</Body> : null}
                <Row style={{ gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Send" onPress={() => void send()} loading={sending} disabled={!text.trim()} />
                  </View>
                  <Button title="Cancel" variant="ghost" onPress={onClose} />
                </Row>
              </>
            )}
          </View>
        </GlassPanel>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
    zIndex: 40,
  },
  thumb: {
    width: 44,
    height: 92,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
});
