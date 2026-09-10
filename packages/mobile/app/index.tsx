import React from 'react';
import { useSession } from '../src/core/auth/session';
import { SignInFlow } from '../src/core/SignInFlow';
import { DrawerHost } from '../src/core/DrawerHost';
import { LazyThunk } from '../src/components/LazyThunk';
import { Button, EmptyState, LoadingState, Screen } from '../src/components/primitives';
import { moduleById } from '../src/core/registry';

export default function Index() {
  const { status, refresh } = useSession();

  switch (status.phase) {
    case 'loading':
    case 'bootstrapping':
      return <LoadingState />;
    case 'signedOut':
      return <SignInFlow note={status.note} />;
    case 'blocked': {
      const mod = moduleById(status.moduleId);
      if (mod?.blockedScreen) {
        return <LazyThunk thunk={mod.blockedScreen} props={{ retry: refresh }} />;
      }
      return (
        <Screen scroll={false}>
          <EmptyState
            icon="account-question-outline"
            title="Your account is not set up yet"
            body="Ask the person who invited you to finish setting up your access."
            action={<Button title="Try again" variant="secondary" onPress={() => void refresh()} />}
          />
        </Screen>
      );
    }
    case 'ready':
      return <DrawerHost enabled={status.enabled} />;
  }
}
