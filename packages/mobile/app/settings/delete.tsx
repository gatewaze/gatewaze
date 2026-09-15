import React, { useState } from 'react';
import { Alert } from 'react-native';
import {
  Body,
  Button,
  Caption,
  Card,
  Heading,
  Input,
  Screen,
} from '../../src/components/primitives';
import { allModules, deletionCopyByModule } from '../../src/core/registry';
import { getModuleContext } from '../../src/core/context';
import { useSession } from '../../src/core/auth/session';
import { colors } from '../../src/theme/tokens';

/**
 * Account deletion (App Store requirement). The list of what is deleted is
 * generator-collated from module manifests, so it cannot drift from the
 * built scope. Deletion itself runs through module deleteAccount hooks —
 * per spec, one server-side orchestrating call owned by the family's root
 * module.
 */
export default function DeleteAccount() {
  const { signOut } = useSession();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = deletionCopyByModule();

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const ctx = getModuleContext();
      for (const mod of allModules()) {
        if (mod.deleteAccount) await mod.deleteAccount(ctx);
      }
      Alert.alert('Account deleted', 'Your data has been removed.');
      await signOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed — nothing was removed.');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Heading>This permanently deletes your account</Heading>
      <Body style={{ color: colors.textSecondary }}>
        The following data will be permanently removed. This cannot be undone.
      </Body>
      {Object.entries(copy).map(([moduleId, text]) => (
        <Card key={moduleId}>
          <Caption>{moduleId}</Caption>
          <Body>{text}</Body>
        </Card>
      ))}
      <Input
        label='Type DELETE to confirm'
        value={confirmation}
        onChangeText={setConfirmation}
        autoCapitalize="characters"
      />
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      <Button
        title="Delete my account"
        variant="danger"
        loading={busy}
        disabled={confirmation.trim() !== 'DELETE'}
        onPress={() =>
          Alert.alert('Delete your account?', 'This is permanent.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => void run() },
          ])
        }
      />
    </Screen>
  );
}
