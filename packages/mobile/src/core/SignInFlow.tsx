/**
 * The front door: create an account, or sign in.
 *
 * Both paths end in the same email one-time code — no password to choose, no
 * browser round-trip, no deep links. What differs is what happens either side
 * of it: signing up picks a plan and may carry a code, and finishes by binding
 * the account to that plan before the app decides which tabs exist.
 *
 * ── WHY THE CORE KNOWS NOTHING ABOUT PLANS ────────────────────────────────
 *
 * The steps, the cards and the copy live here; what a plan IS, what it costs
 * and where it is stored belong to whichever module declares `signup`. A build
 * whose modules declare none has no Create-account path at all and shows the
 * sign-in form alone, which is right for an app whose accounts are provisioned
 * somewhere else.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import {
  Body, Button, Caption, CardTitle, Input, Screen, Spacer, Title,
} from '../components/primitives';
import { AmbientBackground } from '../components/AmbientBackground';
import { brandLogo, signupProvider } from './registry';
import { getModuleContext } from './context';
import { config } from './config';
import { colors, spacing } from '../theme/tokens';
import { useSession } from './auth/session';
import { humanMessage } from './errors';

type Step = 'welcome' | 'plan' | 'email' | 'code';

export function SignInFlow({ note }: { note?: string }) {
  const { requestCode, verifyCode } = useSession();
  const signup = signupProvider();

  // Without a sign-up contribution there is nothing to choose, so the front
  // door collapses to the form it has always been.
  const [step, setStep] = useState<Step>(() => {
    // Development affordance: open a later step directly, so the plan picker
    // can be inspected without tapping through. .env.development only.
    const start = __DEV__ ? process.env.EXPO_PUBLIC_DEV_SIGNUP_STEP : undefined;
    if (start === 'plan' && signup) return 'plan';
    return signup ? 'welcome' : 'email';
  });
  const [creating, setCreating] = useState(__DEV__ && process.env.EXPO_PUBLIC_DEV_SIGNUP_STEP === 'plan');

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [plans, setPlans] = useState<Array<{ id: string; name: string; blurb: string }>>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [invite, setInvite] = useState<{
    trainer?: { displayName: string } | null; percentOff: number; restrictedToPlanId?: string | null;
  } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'plan' || plans.length || !signup) return;
    let alive = true;
    signup.plans(getModuleContext())
      .then((rows) => { if (alive) setPlans(rows ?? []); })
      .catch(() => { if (alive) setError('We could not load the plans just now.'); });
    return () => { alive = false; };
  }, [step, plans.length, signup]);

  /** Check a code before the member commits, so surprises arrive early. */
  const checkCode = useCallback(async () => {
    const raw = inviteCode.trim();
    setInvite(null);
    setInviteError(null);
    if (!raw || !signup?.validateCode) return;
    try {
      const res = await signup.validateCode(getModuleContext(), raw);
      setInvite(res);
      // A code tied to one plan chooses it, rather than letting the member
      // pick one the last step would then reject.
      if (res.restrictedToPlanId) setPlanId(res.restrictedToPlanId);
    } catch (err) {
      setInviteError(humanMessage(err).text);
    }
  }, [inviteCode, signup]);

  const submitEmail = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestCode(email.trim());
      setStep('code');
    } catch (err) {
      setError(humanMessage(err).text);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const finish = creating && signup && planId
        ? async () => {
            // The account exists by now and the entitlement probes have not
            // run, which is the only safe window to bind the plan: a new
            // member never sees a half-built app with tabs they have not
            // chosen. A failure here is surfaced rather than swallowed — the
            // session is valid either way, and Settings can finish the job.
            await signup.complete(getModuleContext(), {
              planId,
              code: inviteCode.trim() || undefined,
            });
          }
        : undefined;
      await verifyCode(email.trim(), code.trim(), finish);
    } catch (err) {
      setError(humanMessage(err).text);
      setBusy(false);
    }
  };

  const Brand = brandLogo();

  return (
    <Screen scroll={false}>
      <AmbientBackground />
      {/* The front door runs the mesh a step darker than the app proper:
          nothing competes with the form, and the wordmark's halo reads. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <View style={styles.center}>
          <View style={styles.brand}>
            {Brand ? <Brand height={42} /> : <Title>{config.appName}</Title>}
          </View>
          <Spacer size={spacing.sm} />
          {note ? <Caption style={{ textAlign: 'center' }}>{note}</Caption> : null}
          <Spacer />

          {step === 'welcome' ? (
            <View style={styles.form}>
              <Button title="Create account" onPress={() => { setCreating(true); setStep('plan'); }} />
              <Button title="Sign in" variant="ghost" onPress={() => { setCreating(false); setStep('email'); }} />
            </View>
          ) : null}

          {step === 'plan' ? (
            <View style={styles.form}>
              <CardTitle>Choose what you want</CardTitle>
              <Caption>Everything is included free while {config.appName} is in testing.</Caption>
              {plans.map((p) => (
                <Button
                  key={p.id}
                  title={p.name}
                  variant={p.id === planId ? 'primary' : 'secondary'}
                  onPress={() => setPlanId(p.id)}
                />
              ))}
              {planId ? (
                <Caption>{plans.find((p) => p.id === planId)?.blurb}</Caption>
              ) : null}

              {signup?.validateCode ? (
                <>
                  <Input
                    placeholder="Invite or discount code (optional)"
                    value={inviteCode}
                    onChangeText={setInviteCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onBlur={() => void checkCode()}
                  />
                  {invite ? (
                    <Caption style={{ color: colors.coach }}>
                      {invite.trainer
                        ? `You will join as a client of ${invite.trainer.displayName}.`
                        : `${invite.percentOff}% off applied.`}
                    </Caption>
                  ) : null}
                  {inviteError ? <Caption style={{ color: colors.danger }}>{inviteError}</Caption> : null}
                </>
              ) : null}

              <Button title="Continue" onPress={() => setStep('email')} disabled={!planId} />
              <Button title="Back" variant="ghost" onPress={() => setStep('welcome')} />
            </View>
          ) : null}

          {step === 'email' ? (
            <View style={styles.form}>
              <Body style={{ color: colors.textSecondary }}>
                {creating
                  ? 'What email should we use? We will send you a 6-digit code.'
                  : 'Sign in with your email. We will send you a 6-digit code.'}
              </Body>
              <Input
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="Email address"
              />
              <Button title="Send code" onPress={submitEmail} loading={busy} disabled={!email.includes('@')} />
              {signup ? (
                <Button title="Back" variant="ghost" onPress={() => setStep(creating ? 'plan' : 'welcome')} />
              ) : null}
            </View>
          ) : null}

          {step === 'code' ? (
            <View style={styles.form}>
              <Body style={{ color: colors.textSecondary }}>
                Enter the 6-digit code we sent to {email.trim()}.
              </Body>
              <Input
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
              />
              <Button
                title={creating ? 'Create account' : 'Sign in'}
                onPress={submitCode}
                loading={busy}
                disabled={code.trim().length < 6}
              />
              <Button title="Use a different email" variant="ghost" onPress={() => setStep('email')} />
            </View>
          ) : null}

          {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', gap: spacing.sm },
  brand: {
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 1 },
  },
  // Narrow and centred: a full-bleed form on a phone reads as a settings
  // page, not a front door.
  form: { gap: spacing.lg, width: '100%', maxWidth: 300, alignSelf: 'center' },
});
