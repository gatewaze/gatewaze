import React, { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { Caption, Card, Heading, Screen } from '../../src/components/primitives';
import { outboxCounts, onOutboxChange } from '../../src/core/outbox';
import { loadPersistedEntitlement, type EntitlementState } from '../../src/core/entitlement';
import { allModules } from '../../src/core/registry';

/**
 * The hidden-ish diagnostics screen (spec "Observability"): the primary
 * debugging tool for "my workout didn't sync" reports from testers.
 */
export default function Diagnostics() {
  const [counts, setCounts] = useState(() => outboxCounts());
  const [entitlement, setEntitlement] = useState<EntitlementState | undefined>();

  useEffect(() => onOutboxChange(() => setCounts(outboxCounts())), []);
  useEffect(() => {
    void loadPersistedEntitlement().then(setEntitlement);
  }, []);

  return (
    <Screen>
      <Card>
        <Heading>Outbox</Heading>
        <Caption>pending: {counts.pending}</Caption>
        <Caption>failed: {counts.failed}</Caption>
      </Card>
      <Card>
        <Heading>Modules</Heading>
        {allModules().map((m) => (
          <Caption key={m.id}>
            {m.id}: {entitlement ? String(entitlement.enabled[m.id] ?? 'unknown') : '…'}
          </Caption>
        ))}
        <Caption>
          last checked:{' '}
          {entitlement ? new Date(entitlement.checkedAt).toLocaleString() : 'never'}
        </Caption>
      </Card>
      <Card>
        <Heading>Build</Heading>
        <Caption>version: {Constants.expoConfig?.version ?? 'dev'}</Caption>
        <Caption>runtime: {Constants.expoConfig?.sdkVersion ?? '?'}</Caption>
      </Card>
    </Screen>
  );
}
