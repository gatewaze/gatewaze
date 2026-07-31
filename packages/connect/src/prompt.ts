import readline from 'node:readline/promises';
import type { DetectedClient } from './types.js';

function rlInterface() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const rl = rlInterface();
  try {
    const suffix = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (answer === '') return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Checkbox-style selection over detected clients: detected clients are
 * pre-ticked; the user can accept the selection or type numbers to change it.
 */
export async function selectClients(clients: DetectedClient[]): Promise<DetectedClient[]> {
  console.log('\nDetected AI clients:\n');
  clients.forEach((c, i) => {
    const box = c.detected ? '[x]' : '[ ]';
    console.log(`  ${i + 1}. ${box} ${c.label}  (${c.detail})`);
  });
  console.log('');

  const rl = rlInterface();
  try {
    const answer = (
      await rl.question(
        'Which should be connected? Enter numbers (e.g. 1,3), "all", or press Enter for all detected: '
      )
    )
      .trim()
      .toLowerCase();

    if (answer === '' ) return clients.filter((c) => c.detected);
    if (answer === 'all' || answer === 'a') return clients;
    if (answer === 'none' || answer === 'n') return [];

    const picked = new Set<number>();
    for (const part of answer.split(/[\s,]+/).filter(Boolean)) {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 1 || n > clients.length) {
        console.log(`Ignoring "${part}" (expected a number between 1 and ${clients.length}).`);
        continue;
      }
      picked.add(n - 1);
    }
    return clients.filter((_, i) => picked.has(i));
  } finally {
    rl.close();
  }
}
