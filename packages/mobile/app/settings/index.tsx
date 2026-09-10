import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import Constants from 'expo-constants';
import { Caption, Card, Heading, ListItem, Screen } from '../../src/components/primitives';
import { LazyThunk } from '../../src/components/LazyThunk';
import { allSettingsSections } from '../../src/core/registry';
import { onOutboxChange, outboxCounts } from '../../src/core/outbox';
import { useSession } from '../../src/core/auth/session';
import { colors } from '../../src/theme/tokens';

export default function Settings() {
  const router = useRouter();
  const { signOut } = useSession();
  const [counts, setCounts] = useState(() => outboxCounts());
  const [deviceLockWarning, setDeviceLockWarning] = useState(false);

  useEffect(() => onOutboxChange(() => setCounts(outboxCounts())), []);

  // Best-effort device-lock check (spec Security): enrolment status is the
  // practical signal; the warning is advice, not a gate.
  useEffect(() => {
    (async () => {
      try {
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        setDeviceLockWarning(hasHardware && !enrolled);
      } catch {
        // Unknown — say nothing rather than nag wrongly.
      }
    })();
  }, []);

  const sections = allSettingsSections();

  return (
    <Screen>
      {deviceLockWarning ? (
        <Card style={{ borderColor: colors.warning }}>
          <Heading>Protect your data</Heading>
          <Caption>
            Your device has no screen lock set. Data stored on this device is only as protected
            as your device lock — set a passcode or biometric in your device settings.
          </Caption>
        </Card>
      ) : null}

      <ListItem
        icon="sync-alert"
        title="Sync status"
        subtitle={
          counts.failed > 0
            ? `${counts.failed} failed, ${counts.pending} waiting`
            : counts.pending > 0
              ? `${counts.pending} waiting to sync`
              : 'All changes synced'
        }
        onPress={() => router.push('/settings/sync')}
      />

      {sections.map((s) => (
        <LazyThunk key={s.moduleId + ':' + s.id} thunk={s.component} />
      ))}

      <ListItem
        icon="stethoscope"
        title="Diagnostics"
        onPress={() => router.push('/settings/diagnostics')}
      />
      <ListItem
        icon="logout"
        title="Sign out"
        onPress={() =>
          Alert.alert('Sign out?', 'Unsynced changes on this device will be discarded.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
          ])
        }
      />
      <ListItem
        icon="delete-forever-outline"
        title="Delete account"
        destructive
        onPress={() => router.push('/settings/delete')}
      />
      <Caption style={{ textAlign: 'center' }}>
        Version {Constants.expoConfig?.version ?? 'dev'}
      </Caption>
    </Screen>
  );
}
