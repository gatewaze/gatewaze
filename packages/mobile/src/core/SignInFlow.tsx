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
import Animated from 'react-native-reanimated';
import { Pressable } from 'react-native';
import {
  Body, Button, Caption, CardTitle, Input, Reveal, Row, Screen, Spacer, Title,
} from '../components/primitives';
import { Icon } from '../components/Icon';
import { usePressScale } from '../components/usePressScale';
import { useTheme, radius } from '../theme/tokens';
import { AmbientBackground } from '../components/AmbientBackground';
import { brandLogo, signupProvider } from './registry';
import { getModuleContext } from './context';
import { config } from './config';
import { colors, spacing } from '../theme/tokens';
import { useSession } from './auth/session';
import { humanMessage } from './errors';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Step = 'welcome' | 'plan' | 'email' | 'code';

/**
 * One plan, as something you pick rather than a button you press.
 *
 * Selection has to be unmistakable at a glance, so it is carried by four
 * things at once — a tinted ground, a full-strength border, a filled check,
 * and the icon coming up to full opacity. One of them alone (the old
 * primary-vs-secondary button) was too quiet to read as "this is the one".
 *
 * The icon and the feature lines come from the server, so what a plan
 * contains is the module's copy rather than this file's knowledge.
 */
function PlanCard({
  plan, selected, onPress,
}: {
  plan: { id: string; name: string; blurb: string; icon?: string; features?: string[]; accent?: string };
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  // Each plan carries its own accent — for HELF, one of the three bars from
  // the E in the wordmark. Falling back to the theme's own accent keeps an
  // unbranded build looking deliberate rather than broken.
  const accent = plan.accent || theme.accent;
  const press = usePressScale(1.02);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        styles.planCard,
        {
          // Selected: the plan's own colour on the border, so the choice is
          // both obvious AND identifies which plan it was.
          borderColor: selected ? accent : theme.controlBorder,
          borderWidth: selected ? 2 : 1,
          backgroundColor: selected ? theme.buttonFill : theme.buttonFillSoft,
        },
        press.style,
      ]}
    >
      <Row style={{ gap: spacing.md, alignItems: 'center' }}>
        {/* The icon wears the plan's colour whether or not it is chosen —
            it is the plan's identity, not its state. */}
        <Icon name={plan.icon || 'star-four-points'} size={26} color={accent} />
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: '700', color: theme.buttonText }}>{plan.name}</Body>
        </View>
        <Icon
          name={selected ? 'check-circle' : 'circle-outline'}
          size={22}
          color={selected ? accent : theme.textMuted}
        />
      </Row>

      {(plan.features ?? []).length ? (
        <View style={{ gap: 4, marginTop: spacing.sm }}>
          {(plan.features ?? []).map((f) => (
            /* The tick sits in a box the width of the plan icon above it, so
               the ticks run down the icon's centre line and the feature text
               starts where the plan name does. Two columns, not a ragged
               left edge — and the gap has to match the header Row's. */
            <Row key={f} style={{ gap: spacing.md, alignItems: 'flex-start' }}>
              <View style={{ width: 26, alignItems: 'center' }}>
                <Icon name="check" size={13} color={accent} />
              </View>
              <Caption style={{ flex: 1, color: theme.textSecondary }}>{f}</Caption>
            </Row>
          ))}
        </View>
      ) : (
        <Caption style={{ marginTop: spacing.xs }}>{plan.blurb}</Caption>
      )}
    </AnimatedPressable>
  );
}

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

  const [plans, setPlans] = useState<Array<{
    id: string; name: string; blurb: string; icon?: string; features?: string[]; accent?: string;
  }>>([]);
  // The code field is hidden until asked for: most people do not have one,
  // and an empty box on the screen invites the question "should I have a code?"
  const [redeeming, setRedeeming] = useState(false);
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
      .then((rows) => {
        if (!alive) return;
        setPlans(rows ?? []);
        // Preselect the first plan the server lists, which is the fullest one
        // (sort_order puts All Access first). Nobody should reach Continue
        // wondering why it is greyed out, and the plan someone changes AWAY
        // from is a better default than no plan at all. A code that restricts
        // the choice overrides this in checkCode().
        setPlanId((current) => current ?? rows?.[0]?.id ?? null);
      })
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
            <View style={styles.wide}>
              <CardTitle style={{ textAlign: 'center' }}>Choose what you want</CardTitle>
              <Caption style={{ textAlign: 'center' }}>
                Everything is included free while {config.appName} is in testing.
              </Caption>
              <Spacer size={spacing.xs} />

              {plans.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  selected={p.id === planId}
                  onPress={() => setPlanId(p.id)}
                />
              ))}

              {signup?.validateCode ? (
                redeeming ? (
                  <Reveal style={{ gap: spacing.sm }}>
                    <Input
                      placeholder="Enter your code"
                      value={inviteCode}
                      onChangeText={setInviteCode}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      autoFocus
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
                  </Reveal>
                ) : (
                  <Button title="Redeem a code" variant="ghost" compact onPress={() => setRedeeming(true)} />
                )
              ) : null}

              <Spacer size={spacing.xs} />
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
  // The picker needs more room than a form: three cards with feature lines.
  wide: { gap: spacing.sm, width: '100%', maxWidth: 340, alignSelf: 'center' },
  planCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
