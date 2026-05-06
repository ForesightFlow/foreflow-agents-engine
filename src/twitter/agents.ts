export type FullAgentName =
  | 'foreflow-ensemble'
  | 'foreflow-debate'
  | 'foreflow-orchestrator'
  | 'foreflow-pipeline'
  | 'foreflow-consensus';

export const FOREFLOW_AGENT_NAMES: ReadonlyArray<FullAgentName> = [
  'foreflow-ensemble',
  'foreflow-debate',
  'foreflow-orchestrator',
  'foreflow-pipeline',
  'foreflow-consensus',
];

export const TWITTER_HANDLES: Record<FullAgentName, string> = {
  'foreflow-ensemble': 'foreflow_ens',
  'foreflow-debate': 'foreflow_deb',
  'foreflow-orchestrator': 'foreflow_orc',
  'foreflow-pipeline': 'foreflow_pip',
  'foreflow-consensus': 'foreflow_con',
};
