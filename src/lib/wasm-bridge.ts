/**
 * WASM Bridge – Consensus analysis (JS fallback)
 *
 * PurpleSky uses Rust WASM for consensus clustering. This build uses a JS-only
 * fallback for now. Add wasm-pack build later for full Polis-style clustering.
 */

import type { ConsensusResult } from '../types'

/** Analyze Polis-like consensus from votes (JS fallback). */
export async function analyzeConsensus(
  votes: Array<{ user_id: string; statement_id: string; value: number }>
): Promise<ConsensusResult> {
  const byStatement = new Map<string, { agree: number; disagree: number; pass: number; voters: Set<string> }>()
  for (const v of votes) {
    let s = byStatement.get(v.statement_id)
    if (!s) {
      s = { agree: 0, disagree: 0, pass: 0, voters: new Set() }
      byStatement.set(v.statement_id, s)
    }
    s.voters.add(v.user_id)
    if (v.value === 1) s.agree++
    else if (v.value === -1) s.disagree++
    else s.pass++
  }

  const statements = Array.from(byStatement.entries()).map(([statementId, s]) => {
    const total = s.agree + s.disagree + s.pass
    const agreeRatio = total > 0 ? s.agree / total : 0
    const divisiveness = total > 0 ? (1 - Math.abs(s.agree - s.disagree) / total) : 0
    return {
      statementId,
      agreeCount: s.agree,
      disagreeCount: s.disagree,
      passCount: s.pass,
      totalVoters: s.voters.size,
      agreementRatio: agreeRatio,
      divisiveness,
    }
  })

  const allVoters = new Set<string>()
  for (const v of votes) allVoters.add(v.user_id)

  return {
    statements,
    totalParticipants: allVoters.size,
    clusterCount: 0,
    clusters: [],
  }
}
