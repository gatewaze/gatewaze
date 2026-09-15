/**
 * Email one-time-code sign-in (spec-mobile-app.md "Auth"): request a code,
 * type the code, no browser round-trip and no deep links.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Body, Button, Caption, Input, Screen, Spacer, Title } from '../components/primitives';
import { AmbientBackground } from '../components/AmbientBackground';
import { brandLogo } from './registry';
import { config } from './config';
import { colors, spacing } from '../theme/tokens';
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
      {/* Signed-out is still the app: the same mesh every other surface
          sits on, with the wordmark where the plain text title was. */}
      <AmbientBackground />
      {/* The front door runs the mesh a step darker than the app proper:
          nothing competes with the form, and the wordmark's halo reads. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <View style={styles.center}>
          {/* Same halo the header wordmark carries: the shadow follows the
              letterforms' alpha, keeping them legible on the mesh's lighter
              patches. */}
          <View
            style={{
              alignItems: 'center',
              shadowColor: '#000',
              shadowOpacity: 0.6,
              shadowRadius: 7,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            {(() => {
              const Logo = brandLogo();
              return Logo ? <Logo height={42} /> : <Title>{config.appName}</Title>;
            })()}
          </View>
          <Spacer size={spacing.sm} />
          {note ? <Caption style={{ textAlign: 'center' }}>{note}</Caption> : null}
          <Spacer />
          {step === 'email' ? (
            <View style={styles.form}>
              <Body style={{ color: colors.textSecondary }}>
                Sign in with your email. We will send you a 6-digit code.
              </Body>
              <Input
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="Email address"
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
  // Narrow and centred: a full-bleed form on a phone reads as a settings
  // page, not a front door. 300pt also keeps the inputs a comfortable
  // thumb-width on every device.
  form: { gap: spacing.lg, width: '100%', maxWidth: 300, alignSelf: 'center' },
});
