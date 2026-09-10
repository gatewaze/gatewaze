import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Row,
  Screen,
} from '../../src/components/primitives';
import {
  discardRow,
  failedRows,
  flush,
  onOutboxChange,
  outboxCounts,
  retryRow,
  type OutboxRow,
} from '../../src/core/outbox';
import { colors, spacing } from '../../src/theme/tokens';

/**
 * Permanently failed writes are a user-facing flow, not a debug curiosity
 * (spec "Offline model"): each failed item shows the server's message and
 * offers retry (fresh attempt budget) or discard (confirmed).
 */
export default function SyncStatus() {
  const [rows, setRows] = useState<OutboxRow[]>(() => failedRows());
  const [counts, setCounts] = useState(() => outboxCounts());

  useEffect(
    () =>
      onOutboxChange(() => {
        setRows(failedRows());
        setCounts(outboxCounts());
      }),
    []
  );

  return (
    <Screen onRefresh={() => void flush()}>
      <Caption>
        {counts.pending > 0
          ? `${counts.pending} change(s) waiting to sync.`
          : 'Nothing waiting to sync.'}
      </Caption>

      {rows.length === 0 ? (
        <EmptyState icon="check-circle-outline" title="No failed changes" />
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <Body>{describeKind(row.kind)}</Body>
            <Caption>{new Date(row.created_at).toLocaleString()}</Caption>
            {row.last_error ? (
              <Caption style={{ color: colors.danger }}>{row.last_error}</Caption>
            ) : null}
            <Row style={{ gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Button title="Retry" variant="secondary" onPress={() => retryRow(row.id)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Discard"
                  variant="danger"
                  onPress={() =>
                    Alert.alert(
                      'Discard this change?',
                      `"${describeKind(row.kind)}" will be permanently discarded and never reach the server.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Discard', style: 'destructive', onPress: () => discardRow(row.id) },
                      ]
                    )
                  }
                />
              </View>
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}

function describeKind(kind: string): string {
  // Kinds are namespaced '<module>:<what>' by convention.
  const what = kind.split(':').pop() ?? kind;
  return what.replace(/[_-]/g, ' ');
}
