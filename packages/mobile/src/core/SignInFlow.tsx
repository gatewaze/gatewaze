/**
 * Email one-time-code sign-in (spec-mobile-app.md "Auth"): request a code,
 * type the code, no browser round-trip and no deep links.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Body, Button, Caption, Input, Screen, Spacer, Title } from '../components/primitives';
import { colors, spacing } from '../theme/tokens';
import { config } from './config';
import { useSession } from './auth/session';

export function SignInFlow({ note }: { note?: string }) {
  const { requestCode, verifyCode } = useSession();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitEmail = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestCode(email.trim());
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email.trim(), code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work');
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <View style={styles.center}>
          <Title>{config.appName}</Title>
          <Spacer size={spacing.sm} />
          {note ? <Caption>{note}</Caption> : null}
          <Spacer />
          {step === 'email' ? (
            <View style={styles.form}>
              <Body style={{ color: colors.textSecondary }}>
                Sign in with your email. We will send you a 6-digit code.
              </Body>
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
              />
              <Button
                title="Send code"
                onPress={submitEmail}
                loading={busy}
                disabled={!email.includes('@')}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Body style={{ color: colors.textSecondary }}>
                Enter the 6-digit code we sent to {email.trim()}.
              </Body>
              <Input
                label="Code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
              />
              <Button
                title="Sign in"
                onPress={submitCode}
                loading={busy}
                disabled={code.trim().length < 6}
              />
              <Button title="Use a different email" variant="ghost" onPress={() => setStep('email')} />
            </View>
          )}
          {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', gap: spacing.sm },
  form: { gap: spacing.lg },
});
